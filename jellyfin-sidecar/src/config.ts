import path from "node:path";

export type SidecarConfig = {
  port: number;
  registryPath: string;
  ledgerPath: string;
  sessionsPath: string;
  defaultAtomicUsdcPerMinute: number;
  feeRouterMode: "dry-run";
};

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}.`);
  }
  return parsed;
}

function resolvePath(cwd: string, value: string | undefined, fallback: string) {
  return path.resolve(cwd, value ?? fallback);
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): SidecarConfig {
  const feeRouterMode = env.JELLYFIN_FEE_ROUTER_MODE ?? "dry-run";
  if (feeRouterMode !== "dry-run") {
    throw new Error(
      "jellyfin-sidecar only supports JELLYFIN_FEE_ROUTER_MODE=dry-run in Wave 3.1.",
    );
  }

  return {
    port: readPositiveInteger(env.JELLYFIN_SIDECAR_PORT, 4317),
    registryPath: resolvePath(cwd, env.JELLYFIN_REGISTRY_PATH, "data/registry.json"),
    ledgerPath: resolvePath(cwd, env.JELLYFIN_LEDGER_PATH, "data/ledger.json"),
    sessionsPath: resolvePath(cwd, env.JELLYFIN_SESSIONS_PATH, "data/sessions.json"),
    defaultAtomicUsdcPerMinute: readPositiveInteger(
      env.JELLYFIN_USDC_ATOMIC_PER_MINUTE,
      2500,
    ),
    feeRouterMode,
  };
}
