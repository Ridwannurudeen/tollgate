/**
 * Onboard a creator who brings NO wallet: mint a custodial Circle W3S wallet
 * for them and register it. The photographer supplies only an Immich owner id
 * and a display name; Circle custodies the wallet that accrues their USDC.
 *
 * Run: npm run register:creator -- --owner-id <uuid> --display-name "Jane Lens"
 * Needs: CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET (entity secret registered in the
 *        Circle Console). Optional CIRCLE_WALLET_SET_ID to reuse a wallet set.
 *
 * For creators who already have a wallet, use `npm run register:owner` instead.
 */

import {
  readWalletRegistry,
  upsertWalletRegistryEntry,
  writeWalletRegistry,
} from "../src/lib/registry";
import { w3sCreateWalletSet, w3sMintWallet } from "../src/lib/circle-w3s";

const BLOCKCHAIN = "ARC-TESTNET";

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function requiredFlag(name: string): string {
  const value = readFlag(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const ownerId = requiredFlag("--owner-id");
  const displayName = requiredFlag("--display-name");

  let walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) {
    walletSetId = await w3sCreateWalletSet("Aperture Creators");
    console.log(
      `Created wallet set ${walletSetId} — save it as CIRCLE_WALLET_SET_ID to reuse.`,
    );
  }

  const minted = await w3sMintWallet({
    walletSetId,
    blockchain: BLOCKCHAIN,
    refId: `creator-${ownerId}`,
  });

  const registry = await readWalletRegistry();
  const entry = {
    ownerId,
    displayName,
    wallet: minted.address,
    createdAt: new Date().toISOString(),
    custody: "circle-w3s" as const,
    walletId: minted.id,
  };
  await writeWalletRegistry(upsertWalletRegistryEntry(registry, entry));

  console.log(
    JSON.stringify(
      {
        registered: { ...entry, custody: "circle-w3s" },
        note: "Custodial wallet minted by Circle W3S; the creator brought no wallet.",
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
