import { getAddress, isAddress } from "viem";
import {
  readWalletRegistry,
  upsertWalletRegistryEntry,
  writeWalletRegistry,
} from "../src/lib/registry";

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
  const wallet = requiredFlag("--wallet");
  if (!isAddress(wallet)) throw new Error("--wallet must be an EVM address.");

  const registry = await readWalletRegistry();
  const entry = {
    ownerId,
    displayName,
    wallet: getAddress(wallet),
    createdAt: new Date().toISOString(),
    approvalStatus: "operator-approved" as const,
  };
  const nextRegistry = upsertWalletRegistryEntry(registry, entry);
  await writeWalletRegistry(nextRegistry);

  console.log(
    JSON.stringify(
      {
        registered: entry,
        ownerCount: nextRegistry.photographers.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
