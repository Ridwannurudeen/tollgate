import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const keystorePath = new URL(
  "../wallets/local-keystore.dpapi.json",
  import.meta.url,
);

function dpapiUnprotect(secret) {
  const script = [
    "$blob = [Console]::In.ReadToEnd()",
    "$secure = ConvertTo-SecureString $blob",
    "[System.Net.NetworkCredential]::new('', $secure).Password",
  ].join("; ");
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { input: secret, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "DPAPI decryption failed.");
  }
  return result.stdout.trim();
}

async function readKeystore() {
  if (!existsSync(keystorePath)) {
    throw new Error(
      "Wallet keystore missing. Run npm run create:wallets first.",
    );
  }
  return JSON.parse(await readFile(keystorePath, "utf8"));
}

export async function listWallets() {
  const keystore = await readKeystore();
  return keystore.wallets.map(
    ({ encryptedPrivateKeyDpapi: _encryptedPrivateKeyDpapi, ...wallet }) =>
      wallet,
  );
}

export async function loadWallet(roleId) {
  const keystore = await readKeystore();
  const wallet = keystore.wallets.find((candidate) => candidate.id === roleId);
  if (!wallet) {
    throw new Error(`Wallet role not found: ${roleId}`);
  }

  const privateKey = dpapiUnprotect(wallet.encryptedPrivateKeyDpapi);
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Wallet role ${roleId} failed address verification.`);
  }

  return {
    id: wallet.id,
    label: wallet.label,
    purpose: wallet.purpose,
    address: wallet.address,
    privateKey,
    account,
  };
}
