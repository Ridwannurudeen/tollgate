/**
 * Minimal Circle Developer-Controlled Wallets (W3S) client — just enough to
 * MINT a custodial wallet for a creator at onboarding, so a photographer brings
 * only an identity and Circle custodies the wallet that accrues their USDC.
 *
 * Follows Circle's published REST contract (https://developers.circle.com/w3s):
 * an API key plus a per-request RSA-encrypted entity secret. Implemented on
 * fetch + node:crypto, no Circle SDK.
 */

import {
  publicEncrypt,
  constants,
  createPublicKey,
  randomUUID,
} from "node:crypto";

const W3S_BASE = "https://api.circle.com/v1/w3s";
const KEY_TTL_MS = 5 * 60 * 1000;

let entityKeyPem: string | null = null;
let entityKeyFetchedAt = 0;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing`);
  return value;
}

async function entityPublicKey(): Promise<string> {
  if (entityKeyPem && Date.now() - entityKeyFetchedAt < KEY_TTL_MS) {
    return entityKeyPem;
  }
  const res = await fetch(`${W3S_BASE}/config/entity/publicKey`, {
    headers: { Authorization: `Bearer ${requireEnv("CIRCLE_API_KEY")}` },
  });
  if (!res.ok)
    throw new Error(`entity publicKey ${res.status}: ${await res.text()}`);
  const pem = ((await res.json()) as { data?: { publicKey?: string } })?.data
    ?.publicKey;
  if (!pem) throw new Error("Circle returned no entity public key");
  entityKeyPem = pem;
  entityKeyFetchedAt = Date.now();
  return pem;
}

async function sealEntitySecret(): Promise<string> {
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

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
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
  return JSON.parse(text) as T;
}

export async function w3sCreateWalletSet(name: string): Promise<string> {
  const resp = await request<{ data: { walletSet: { id: string } } }>(
    "POST",
    "/developer/walletSets",
    {
      idempotencyKey: randomUUID(),
      entitySecretCiphertext: await sealEntitySecret(),
      name,
    },
  );
  return resp.data.walletSet.id;
}

export type MintedWallet = {
  id: string;
  address: `0x${string}`;
  blockchain: string;
  state: string;
};

export async function w3sMintWallet(args: {
  walletSetId: string;
  blockchain: string;
  refId?: string;
}): Promise<MintedWallet> {
  const created = await request<{ data: { wallets: Array<{ id: string }> } }>(
    "POST",
    "/developer/wallets",
    {
      idempotencyKey: randomUUID(),
      entitySecretCiphertext: await sealEntitySecret(),
      walletSetId: args.walletSetId,
      blockchains: [args.blockchain],
      count: 1,
      accountType: "EOA",
      ...(args.refId ? { metadata: [{ refId: args.refId }] } : {}),
    },
  );
  const resp = await request<{ data: { wallet: MintedWallet } }>(
    "GET",
    `/wallets/${created.data.wallets[0].id}`,
  );
  return resp.data.wallet;
}
