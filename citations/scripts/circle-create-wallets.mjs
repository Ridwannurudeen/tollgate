/**
 * Provision the Circle W3S wallet for Tollgate's autonomous payer agent — the
 * keyless wallet that signs the agent's x402 citation payments. Idempotent:
 * re-running reuses the wallet if its env vars are already set. Writes the
 * wallet-set id + payer id/address to .env.local.
 *
 * Run:  node --env-file-if-exists=.env.local scripts/circle-create-wallets.mjs
 * Needs: CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET (entity secret registered in the
 *        Circle Console Configurator first).
 *
 * Funding: EIP-3009 is gasless for the payer, so it needs only USDC (no native
 * gas). Fund the printed address with Arc-Testnet USDC at https://faucet.circle.com.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  w3sCreateWalletSet,
  w3sCreateWallet,
  w3sWallet,
} from "./circle-w3s.mjs";

const BLOCKCHAIN = "ARC-TESTNET";
const ENV_PATH = ".env.local";

function readEnvFile() {
  if (!existsSync(ENV_PATH)) return { raw: "", map: new Map() };
  const raw = readFileSync(ENV_PATH, "utf8");
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  return { raw, map };
}

function upsertEnv(updates) {
  const { raw } = readEnvFile();
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && updates[m[1]] !== undefined) {
      seen.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  writeFileSync(
    ENV_PATH,
    out.filter((l, i) => !(l === "" && i === out.length - 1)).join("\n") + "\n",
  );
}

async function ensureWalletSet() {
  if (process.env.CIRCLE_WALLET_SET_ID) {
    console.log("wallet set: reusing configured wallet set");
    return process.env.CIRCLE_WALLET_SET_ID;
  }
  const id = await w3sCreateWalletSet("Tollgate Agents");
  console.log("wallet set: created");
  upsertEnv({ CIRCLE_WALLET_SET_ID: id });
  return id;
}

async function ensureWallet(walletSetId, { idEnv, addrEnv, refId, label }) {
  if (process.env[idEnv] && process.env[addrEnv]) {
    console.log(`${label}: reusing ${process.env[addrEnv]}`);
    return { id: process.env[idEnv], address: process.env[addrEnv] };
  }
  const wallet = await w3sCreateWallet({
    walletSetId,
    blockchain: BLOCKCHAIN,
    refId,
  });
  const info = await w3sWallet(wallet.id);
  console.log(`${label}: created ${info.address}`);
  upsertEnv({ [idEnv]: info.id, [addrEnv]: info.address });
  // Reflect into the live process so a subsequent run in the same invocation sees it.
  process.env[idEnv] = info.id;
  process.env[addrEnv] = info.address;
  await sleep(400); // mirror Circle rate-limit etiquette
  return { id: info.id, address: info.address };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const walletSetId = await ensureWalletSet();

  const payer = await ensureWallet(walletSetId, {
    idEnv: "CIRCLE_PAYER_WALLET_ID",
    addrEnv: "CIRCLE_PAYER_ADDRESS",
    refId: "tollgate-payer",
    label: "payer",
  });

  console.log("\nDone. Next:");
  console.log(
    `  1. Fund the payer with Arc-Testnet USDC: https://faucet.circle.com`,
  );
  console.log(`     payer address: ${payer.address}`);
  console.log(`  2. Verify: npm run prove:w3s-source circle-gateway-nano`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
