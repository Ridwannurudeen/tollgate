import { getAddress, isAddress, verifyMessage, type Address } from "viem";
import { normalizeAccountEmail } from "./account";
import { w3sMintWallet } from "./circle-w3s";
import { sha256Hex } from "./hash";
import {
  findWalletForOwner,
  readWalletRegistry,
  upsertWalletRegistryEntry,
  withRegistryWriteLock,
  writeWalletRegistry,
} from "./registry";
import type { OwnershipProof, WalletRegistryEntry } from "./types";

const BLOCKCHAIN = "ARC-TESTNET";
const OWNERSHIP_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

export type RegisterCreatorInput = {
  ownerId: string;
  displayName: string;
  /** If provided, the creator self-custodies. If omitted, we mint a custodial W3S wallet. */
  wallet?: string;
  /** Required only for the custodial (mint) path; falls back to CIRCLE_WALLET_SET_ID. */
  walletSetId?: string;
  /** Optional proof of wallet control: a signature over the ownership message. */
  ownershipSignature?: string;
  /** Timestamp that was signed; required when ownershipSignature is provided. */
  ownershipTimestamp?: string;
  /** Registry file path override (tests); defaults to data/registry.json. */
  filePath?: string;
  /** Hash of the one-time account key; plaintext is never persisted. */
  accountKeyHash?: `0x${string}`;
  /** Optional email login address, stored lowercased. */
  email?: string;
};

export function buildOwnerOwnershipMessage({
  ownerId,
  wallet,
  timestamp,
}: {
  ownerId: string;
  wallet: Address;
  timestamp: string;
}): string {
  return [
    "Aperture owner ownership",
    `ownerId:${ownerId}`,
    `wallet:${wallet}`,
    `timestamp:${timestamp}`,
  ].join("\n");
}

async function ownershipProofFromInput(
  input: RegisterCreatorInput,
  ownerId: string,
  wallet: Address,
): Promise<OwnershipProof | undefined> {
  const { ownershipSignature: signature, ownershipTimestamp: timestamp } =
    input;
  if (signature === undefined && timestamp === undefined) return undefined;
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error("ownershipSignature must be a hex string.");
  }
  if (typeof timestamp !== "string" || timestamp.trim().length === 0) {
    throw new Error("ownershipTimestamp is required.");
  }

  const valid = await verifyMessage({
    address: wallet,
    message: buildOwnerOwnershipMessage({
      ownerId,
      wallet,
      timestamp: timestamp.trim(),
    }),
    signature: signature as `0x${string}`,
  });
  if (!valid) {
    throw new Error("ownershipSignature did not recover the owner wallet.");
  }

  // Reject stale or future-dated proofs so a leaked signature cannot be
  // replayed to claim ownership long after it was signed.
  const signedAt = new Date(timestamp.trim()).getTime();
  if (Number.isNaN(signedAt)) {
    throw new Error("ownershipTimestamp is not a valid date.");
  }
  const ageMs = Date.now() - signedAt;
  if (
    ageMs > OWNERSHIP_FRESHNESS_WINDOW_MS ||
    ageMs < -OWNERSHIP_FRESHNESS_WINDOW_MS
  ) {
    throw new Error("ownershipTimestamp is outside the freshness window.");
  }

  return {
    method: "wallet-signature",
    signer: wallet,
    signatureHash: sha256Hex(signature),
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Register a photographer. Self-custody when they bring a wallet; otherwise mint
 * a Circle-custodied wallet so they bring only an identity. Shared by the web
 * route and the CLI so both paths persist identical entries.
 */
export async function registerCreator(
  input: RegisterCreatorInput,
): Promise<WalletRegistryEntry> {
  const ownerId = input.ownerId?.trim();
  const displayName = input.displayName?.trim();
  if (!ownerId || !displayName) {
    throw new Error("ownerId and displayName are required.");
  }
  const email = input.email?.trim()
    ? normalizeAccountEmail(input.email)
    : undefined;
  if (input.email?.trim() && !email) {
    throw new Error("email must be a valid address.");
  }

  return withRegistryWriteLock(async () => {
    const registry = await readWalletRegistry(input.filePath);
    if (findWalletForOwner(registry, ownerId)) {
      throw new Error("ownerId already registered.");
    }
    if (
      email &&
      registry.photographers.some((candidate) => candidate.email === email)
    ) {
      throw new Error("email already registered.");
    }

    let entry: WalletRegistryEntry;
    if (input.wallet) {
      if (!isAddress(input.wallet)) {
        throw new Error("wallet must be a valid EVM address.");
      }
      const wallet = getAddress(input.wallet);
      const ownershipProof = await ownershipProofFromInput(
        input,
        ownerId,
        wallet,
      );
      entry = {
        ownerId,
        displayName,
        wallet,
        createdAt: new Date().toISOString(),
        approvalStatus: ownershipProof ? "wallet-signed" : "pending",
        custody: "self",
        ...(ownershipProof ? { ownershipProof } : {}),
      };
    } else {
      const walletSetId = input.walletSetId ?? process.env.CIRCLE_WALLET_SET_ID;
      if (!walletSetId) {
        throw new Error(
          "Custodial onboarding needs CIRCLE_WALLET_SET_ID (run create:circle-wallets first) — or provide a wallet.",
        );
      }
      const minted = await w3sMintWallet({
        walletSetId,
        blockchain: BLOCKCHAIN,
        refId: `creator-${ownerId}`,
      });
      entry = {
        ownerId,
        displayName,
        wallet: minted.address,
        createdAt: new Date().toISOString(),
        approvalStatus: "operator-approved",
        custody: "circle-w3s",
        walletId: minted.id,
      };
    }

    const finalEntry: WalletRegistryEntry = {
      ...entry,
      ...(input.accountKeyHash ? { accountKeyHash: input.accountKeyHash } : {}),
      ...(email ? { email } : {}),
    };
    await writeWalletRegistry(
      upsertWalletRegistryEntry(registry, finalEntry),
      input.filePath,
    );
    return finalEntry;
  });
}
