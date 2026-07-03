import {
  constants,
  createPublicKey,
  publicEncrypt,
  randomUUID,
} from "node:crypto";
import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";

const W3S_BASE = "https://api.circle.com/v1/w3s";
const KEY_TTL_MS = 5 * 60 * 1000;
const BLOCKCHAIN = "ARC-TESTNET";
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 1_500;

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
  const response = await fetch(`${W3S_BASE}/config/entity/publicKey`, {
    headers: { Authorization: `Bearer ${requireEnv("CIRCLE_API_KEY")}` },
  });
  if (!response.ok) {
    throw new Error(`entity publicKey ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: { publicKey?: string };
  };
  const publicKey = payload.data?.publicKey;
  if (!publicKey) throw new Error("Circle returned no entity public key.");
  entityKeyPem = publicKey;
  entityKeyFetchedAt = Date.now();
  return publicKey;
}

async function sealEntitySecret(): Promise<string> {
  const publicKey = await entityPublicKey();
  return publicEncrypt(
    {
      key: createPublicKey({ key: publicKey, format: "pem" }),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(requireEnv("CIRCLE_ENTITY_SECRET"), "hex"),
  ).toString("base64");
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${W3S_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv("CIRCLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

export async function w3sCreateWalletSet(name: string): Promise<string> {
  const response = await request<{ data: { walletSet: { id: string } } }>(
    "POST",
    "/developer/walletSets",
    {
      idempotencyKey: randomUUID(),
      entitySecretCiphertext: await sealEntitySecret(),
      name,
    },
  );
  return response.data.walletSet.id;
}

export type MintedWallet = {
  id: string;
  address: Address;
  blockchain: string;
  state: string;
};

export async function w3sMintWallet(args: {
  walletSetId: string;
  blockchain?: string;
  refId?: string;
}): Promise<MintedWallet> {
  const created = await request<{ data: { wallets: Array<{ id: string }> } }>(
    "POST",
    "/developer/wallets",
    {
      idempotencyKey: randomUUID(),
      entitySecretCiphertext: await sealEntitySecret(),
      walletSetId: args.walletSetId,
      blockchains: [args.blockchain ?? BLOCKCHAIN],
      count: 1,
      accountType: "EOA",
      ...(args.refId ? { metadata: [{ refId: args.refId }] } : {}),
    },
  );
  const response = await request<{ data: { wallet: MintedWallet } }>(
    "GET",
    `/wallets/${created.data.wallets[0].id}`,
  );
  return response.data.wallet;
}

type W3STransaction = {
  id: string;
  txHash?: Hex;
  transactionHash?: Hex;
  state?: string;
};

async function transactionHash(transactionId: string): Promise<Hex> {
  for (let index = 0; index < POLL_ATTEMPTS; index += 1) {
    const response = await request<{ data?: { transaction?: W3STransaction } }>(
      "GET",
      `/transactions/${transactionId}`,
    );
    const transaction = response.data?.transaction;
    const hash = transaction?.txHash ?? transaction?.transactionHash;
    if (hash) return hash;
    if (transaction?.state === "FAILED" || transaction?.state === "CANCELLED") {
      throw new Error(`Circle W3S transaction ${transactionId} ${transaction.state}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Circle W3S transaction ${transactionId} did not produce a tx hash.`);
}

export async function w3sExecuteContract(args: {
  walletId: string;
  walletAddress: Address;
  contractAddress: Address;
  abi: Abi;
  functionName: string;
  functionArgs?: readonly unknown[];
}): Promise<Hex> {
  const callData = encodeFunctionData({
    abi: args.abi,
    functionName: args.functionName,
    args: args.functionArgs,
  });
  const response = await request<{ data: { id: string } }>(
    "POST",
    "/developer/transactions/contractExecution",
    {
      idempotencyKey: randomUUID(),
      entitySecretCiphertext: await sealEntitySecret(),
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      blockchain: BLOCKCHAIN,
      contractAddress: args.contractAddress,
      callData,
      feeLevel: "MEDIUM",
    },
  );
  return transactionHash(response.data.id);
}
