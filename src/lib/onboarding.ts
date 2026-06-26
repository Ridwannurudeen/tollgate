import { getAddress, isAddress } from "viem";
import { w3sMintWallet } from "./circle-w3s";
import {
  readWalletRegistry,
  upsertWalletRegistryEntry,
  writeWalletRegistry,
} from "./registry";
import type { WalletRegistryEntry } from "./types";

const BLOCKCHAIN = "ARC-TESTNET";

export type RegisterCreatorInput = {
  ownerId: string;
  displayName: string;
  /** If provided, the creator self-custodies. If omitted, we mint a custodial W3S wallet. */
  wallet?: string;
  /** Required only for the custodial (mint) path; falls back to CIRCLE_WALLET_SET_ID. */
  walletSetId?: string;
  /** Registry file path override (tests); defaults to data/registry.json. */
  filePath?: string;
};

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

  let entry: WalletRegistryEntry;
  if (input.wallet) {
    if (!isAddress(input.wallet)) {
      throw new Error("wallet must be a valid EVM address.");
    }
    entry = {
      ownerId,
      displayName,
      wallet: getAddress(input.wallet),
      createdAt: new Date().toISOString(),
      custody: "self",
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
      custody: "circle-w3s",
      walletId: minted.id,
    };
  }

  const registry = await readWalletRegistry(input.filePath);
  await writeWalletRegistry(
    upsertWalletRegistryEntry(registry, entry),
    input.filePath,
  );
  return entry;
}
