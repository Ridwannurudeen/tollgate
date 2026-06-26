/**
 * Tollgate's thin client for Circle Developer-Controlled Wallets (W3S).
 *
 * Follows Circle's published REST contract for developer-controlled wallets
 * (https://developers.circle.com/w3s) — auth with an API key, and authorize
 * each privileged call by encrypting the entity secret against Circle's per-
 * entity RSA key. Implemented directly on `fetch` + node:crypto so the agent
 * carries no wallet SDK and, more importantly, no private key: Circle custodies
 * the key and we only ever hand it a signing request.
 *
 * Tollgate uses exactly two capabilities here — minting wallets at setup, and
 * producing the EIP-712 signature the x402 "exact" scheme needs at pay time.
 */

import { publicEncrypt, constants, createPublicKey, randomUUID } from "node:crypto";

const W3S_BASE = "https://api.circle.com/v1/w3s";
const KEY_TTL_MS = 5 * 60 * 1000;

let entityKeyPem = null;
let entityKeyFetchedAt = 0;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing`);
  return value;
}

async function entityPublicKey() {
  const age = Date.now() - entityKeyFetchedAt;
  if (entityKeyPem && age < KEY_TTL_MS) return entityKeyPem;
  const res = await fetch(`${W3S_BASE}/config/entity/publicKey`, {
    headers: { Authorization: `Bearer ${requireEnv("CIRCLE_API_KEY")}` },
  });
  if (!res.ok) {
    throw new Error(`entity publicKey ${res.status}: ${await res.text()}`);
  }
  const pem = (await res.json())?.data?.publicKey;
  if (!pem) throw new Error("Circle returned no entity public key");
  entityKeyPem = pem;
  entityKeyFetchedAt = Date.now();
  return pem;
}

// Every privileged call carries a fresh RSA-OAEP(SHA-256) ciphertext of the
// entity secret; the plaintext secret never leaves this process.
async function sealEntitySecret() {
  const pem = await entityPublicKey();
  const sealed = publicEncrypt(
    {
      key: createPublicKey({ key: pem, format: "pem" }),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(requireEnv("CIRCLE_ENTITY_SECRET"), "hex"),
  );
  return sealed.toString("base64");
}

async function request(method, path, body) {
  const res = await fetch(`${W3S_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv("CIRCLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`);
  return JSON.parse(text);
}

/**
 * Serialize an EIP-712 message for Circle's signer. x402 hands us the message
 * without an EIP712Domain type entry, so we rebuild it from whatever domain
 * fields are present (declaration order fixes the domain separator), and emit
 * uint256 fields as decimal strings since JSON has no BigInt.
 */
function encodeEip712(typed) {
  const domainTypes = [
    ["name", "string"],
    ["version", "string"],
    ["chainId", "uint256"],
    ["verifyingContract", "address"],
    ["salt", "bytes32"],
  ];
  const eip712Domain = domainTypes
    .filter(([field]) => typed.domain[field] !== undefined)
    .map(([name, type]) => ({ name, type }));
  return JSON.stringify(
    {
      types: { EIP712Domain: eip712Domain, ...typed.types },
      domain: typed.domain,
      primaryType: typed.primaryType,
      message: typed.message,
    },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );
}

/** Sign EIP-712 typed data with a W3S wallet; returns the 0x signature. */
export async function w3sSignTypedData(walletId, typed, memo) {
  const resp = await request("POST", "/developer/sign/typedData", {
    walletId,
    data: encodeEip712(typed),
    entitySecretCiphertext: await sealEntitySecret(),
    ...(memo ? { memo } : {}),
  });
  return resp.data.signature;
}

// ── Wallet provisioning (setup only) ────────────────────────────────────────

export async function w3sCreateWalletSet(name) {
  const resp = await request("POST", "/developer/walletSets", {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: await sealEntitySecret(),
    name,
  });
  return resp.data.walletSet.id;
}

export async function w3sCreateWallet({ walletSetId, blockchain, refId }) {
  const resp = await request("POST", "/developer/wallets", {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: await sealEntitySecret(),
    walletSetId,
    blockchains: [blockchain],
    count: 1,
    accountType: "EOA",
    ...(refId ? { metadata: [{ refId }] } : {}),
  });
  return resp.data.wallets[0];
}

export async function w3sWallet(walletId) {
  const resp = await request("GET", `/wallets/${walletId}`);
  return resp.data.wallet;
}

// ── Env accessors ───────────────────────────────────────────────────────────

export function payerWalletId() {
  return requireEnv("CIRCLE_PAYER_WALLET_ID");
}

export function payerAddress() {
  return requireEnv("CIRCLE_PAYER_ADDRESS");
}
