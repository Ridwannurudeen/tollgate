import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";
import { generatePrivateKey } from "viem/accounts";

const roles = [
  {
    id: "tollgate-agent-payee",
    label: "Tollgate agent payee",
    purpose: "Receives reader payments from /api/paid-query.",
  },
  {
    id: "x402-facilitator",
    label: "x402 facilitator",
    purpose:
      "Signs/verifies settlement attempts when FACILITATOR_PRIVATE_KEY is configured.",
  },
  {
    id: "demo-payer",
    label: "Demo payer",
    purpose: "Funds and signs x402 paid-query/source-purchase demos.",
  },
  {
    id: "creator-primary",
    label: "Creator primary",
    purpose:
      "Receives paid-source purchases for the primary demo creator source.",
  },
  {
    id: "creator-secondary",
    label: "Creator secondary",
    purpose: "Reserve creator payee for a second onboarded source.",
  },
];

const walletsDir = new URL("../wallets/", import.meta.url);
const privatePath = new URL("local-keystore.dpapi.json", walletsDir);
const publicPath = new URL("funding-addresses.json", walletsDir);
const sourcesPath = new URL("../data/sources.json", import.meta.url);

function dpapiProtect(secret) {
  const script = [
    "$plain = [Console]::In.ReadToEnd()",
    "$secure = ConvertTo-SecureString $plain -AsPlainText -Force",
    "ConvertFrom-SecureString $secure",
  ].join("; ");
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { input: secret, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "DPAPI encryption failed.");
  }
  return result.stdout.trim();
}

async function updateDemoSourceWallet(address) {
  if (!existsSync(sourcesPath)) return;
  const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
  if (!Array.isArray(sources)) return;
  let changed = false;
  const nextSources = sources.map((source) => {
    if (source?.id !== "leptonweb-build-log") return source;
    changed = source.wallet !== address;
    return { ...source, wallet: address };
  });
  if (changed) {
    await writeFile(
      sourcesPath,
      `${JSON.stringify(nextSources, null, 2)}\n`,
      "utf8",
    );
  }
}

if (existsSync(privatePath) && !process.argv.includes("--force")) {
  throw new Error(
    "Wallet keystore already exists. Re-run with --force only if you intend to replace these wallets.",
  );
}

await mkdir(walletsDir, { recursive: true });

const createdAt = new Date().toISOString();
const generated = roles.map((role) => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    ...role,
    address: account.address,
    encryptedPrivateKeyDpapi: dpapiProtect(privateKey),
  };
});

const publicWallets = generated.map(
  ({ encryptedPrivateKeyDpapi: _encryptedPrivateKeyDpapi, ...wallet }) =>
    wallet,
);

await writeFile(
  privatePath,
  `${JSON.stringify(
    {
      warning:
        "DPAPI-encrypted private keys. Decryptable only by the Windows user profile that created them. Do not commit this file.",
      createdAt,
      wallets: generated,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await writeFile(
  publicPath,
  `${JSON.stringify(
    {
      createdAt,
      chain: "Arc testnet",
      chainId: 5042002,
      wallets: publicWallets,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const creatorPrimary = publicWallets.find(
  (wallet) => wallet.id === "creator-primary",
);
if (creatorPrimary) {
  await updateDemoSourceWallet(creatorPrimary.address);
}

console.log(JSON.stringify({ createdAt, wallets: publicWallets }, null, 2));
