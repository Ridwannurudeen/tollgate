import path from "node:path";
import type { Address, Hex } from "viem";

export type FeeRouterMode = "dry-run" | "live";

export type SidecarConfig = {
  port: number;
  registryPath: string;
  operatorsPath: string;
  ledgerPath: string;
  sessionsPath: string;
  publicWebhookUrl: string;
  registrationSecret?: string;
  jellyfinServerUrl?: string;
  jellyfinApiKey?: string;
  defaultAtomicUsdcPerMinute: number;
  maxAtomicUsdcPerEvent: number;
  maxDailyAtomicUsdc: number;
  feeRouterMode: FeeRouterMode;
  feeRouterPrivateKey?: Hex;
  feeRouterRpcUrl: string;
  feeRouterChainId: number;
  feeRouterUsdcAddress: Address;
  feeRouterAddress: Address;
  feeRouterSplitRegistryPath: string;
};

const DEFAULT_ARC_RPC_URL = "https://rpc.testnet.arc.network";
const DEFAULT_ARC_CHAIN_ID = 5042002;
const DEFAULT_ARC_USDC =
  "0x3600000000000000000000000000000000000000" as Address;
const DEFAULT_FEE_ROUTER =
  "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59" as Address;

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}.`);
  }
  return parsed;
}

function resolvePath(cwd: string, value: string | undefined, fallback: string) {
  return path.resolve(cwd, value ?? fallback);
}

function readAddress(value: string | undefined, fallback: Address): Address {
  const address = value ?? fallback;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`Expected an EVM address, got ${address}.`);
  }
  return address as Address;
}

function readHex(value: string | undefined): Hex | undefined {
  if (!value) return undefined;
  if (!/^0x[a-fA-F0-9]+$/.test(value)) {
    throw new Error("Expected a 0x-prefixed hex private key.");
  }
  return value as Hex;
}

function readJellyfinServerUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "JELLYFIN_SERVER_URL must be an HTTP(S) URL without credentials.",
    );
  }
  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.toString();
}

function readJellyfinApiKey(value: string | undefined): string | undefined {
  const apiKey = value?.trim();
  if (!apiKey) return undefined;
  if (!/^[A-Za-z0-9._~-]{8,256}$/.test(apiKey)) {
    throw new Error("JELLYFIN_API_KEY is invalid.");
  }
  return apiKey;
}

function normalizeFeeRouterMode(value: string | undefined): FeeRouterMode {
  if (!value || value === "dry-run") return "dry-run";
  if (value === "live" || value === "forum-routed") return "live";
  throw new Error(
    "JELLYFIN_FEE_ROUTER_MODE must be dry-run, live, or forum-routed.",
  );
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): SidecarConfig {
  const feeRouterMode = normalizeFeeRouterMode(env.JELLYFIN_FEE_ROUTER_MODE);
  const feeRouterPrivateKey = readHex(env.JELLYFIN_FEE_ROUTER_PRIVATE_KEY);
  if (feeRouterMode === "live" && !feeRouterPrivateKey) {
    throw new Error(
      "JELLYFIN_FEE_ROUTER_PRIVATE_KEY is required when JELLYFIN_FEE_ROUTER_MODE=live.",
    );
  }
  const jellyfinServerUrl = readJellyfinServerUrl(env.JELLYFIN_SERVER_URL);
  const jellyfinApiKey = readJellyfinApiKey(env.JELLYFIN_API_KEY);
  if (feeRouterMode === "live" && !jellyfinServerUrl) {
    throw new Error(
      "JELLYFIN_SERVER_URL is required when JELLYFIN_FEE_ROUTER_MODE=live.",
    );
  }
  if (feeRouterMode === "live" && !jellyfinApiKey) {
    throw new Error(
      "JELLYFIN_API_KEY is required when JELLYFIN_FEE_ROUTER_MODE=live.",
    );
  }
  if (feeRouterMode === "live") {
    throw new Error(
      "Jellyfin live FeeRouter settlement is disabled until durable pre-payment journaling and reconciliation are implemented.",
    );
  }

  return {
    port: readPositiveInteger(env.JELLYFIN_SIDECAR_PORT, 4317),
    registryPath: resolvePath(
      cwd,
      env.JELLYFIN_REGISTRY_PATH,
      "data/registry.json",
    ),
    operatorsPath: resolvePath(
      cwd,
      env.JELLYFIN_OPERATORS_PATH,
      "data/operators.json",
    ),
    ledgerPath: resolvePath(cwd, env.JELLYFIN_LEDGER_PATH, "data/ledger.json"),
    sessionsPath: resolvePath(
      cwd,
      env.JELLYFIN_SESSIONS_PATH,
      "data/sessions.json",
    ),
    defaultAtomicUsdcPerMinute: readPositiveInteger(
      env.JELLYFIN_USDC_ATOMIC_PER_MINUTE,
      2500,
    ),
    maxAtomicUsdcPerEvent: readPositiveInteger(
      env.JELLYFIN_MAX_ATOMIC_USDC_PER_EVENT,
      1_000_000,
    ),
    maxDailyAtomicUsdc: readPositiveInteger(
      env.JELLYFIN_MAX_DAILY_ATOMIC_USDC,
      10_000_000,
    ),
    publicWebhookUrl:
      env.JELLYFIN_PUBLIC_WEBHOOK_URL ??
      "https://tollgate.gudman.xyz/jellyfin/api/webhooks/jellyfin",
    registrationSecret:
      env.JELLYFIN_REGISTRATION_SECRET?.trim() || undefined,
    jellyfinServerUrl,
    jellyfinApiKey,
    feeRouterMode,
    feeRouterPrivateKey,
    feeRouterRpcUrl:
      env.JELLYFIN_ARC_RPC_URL ??
      env.NEXT_PUBLIC_ARC_RPC_URL ??
      DEFAULT_ARC_RPC_URL,
    feeRouterChainId: readPositiveInteger(
      env.JELLYFIN_ARC_CHAIN_ID,
      DEFAULT_ARC_CHAIN_ID,
    ),
    feeRouterUsdcAddress: readAddress(
      env.JELLYFIN_USDC_ADDRESS,
      DEFAULT_ARC_USDC,
    ),
    feeRouterAddress: readAddress(
      env.JELLYFIN_FEE_ROUTER_ADDRESS,
      DEFAULT_FEE_ROUTER,
    ),
    feeRouterSplitRegistryPath: resolvePath(
      cwd,
      env.JELLYFIN_FEE_ROUTER_SPLIT_REGISTRY_PATH,
      "data/fee-router-splits.json",
    ),
  };
}
