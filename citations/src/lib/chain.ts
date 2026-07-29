import { defineChain } from "viem";

// Env values are read through literal `process.env.NEXT_PUBLIC_*` access so
// Next.js can inline them into client bundles; a dynamic lookup would not be.
function parsePositiveInt(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseAddress(
  raw: string | undefined,
  name: string,
  fallback: `0x${string}`,
): `0x${string}` {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} must be a 20-byte hex address.`);
  }
  return value as `0x${string}`;
}

export const ARC_CHAIN_ID = parsePositiveInt(
  process.env.NEXT_PUBLIC_ARC_CHAIN_ID,
  "NEXT_PUBLIC_ARC_CHAIN_ID",
  5042002,
);

export const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";

export const ARC_CAIP2 = `eip155:${ARC_CHAIN_ID}` as const;

export const ARC_USDC = parseAddress(
  process.env.NEXT_PUBLIC_ARC_USDC,
  "NEXT_PUBLIC_ARC_USDC",
  "0x3600000000000000000000000000000000000000",
);
export const USDC_DECIMALS = 6;
export const ARC_GATEWAY_WALLET = parseAddress(
  process.env.NEXT_PUBLIC_ARC_GATEWAY_WALLET,
  "NEXT_PUBLIC_ARC_GATEWAY_WALLET",
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
);
export const ARC_GATEWAY_API_URL =
  process.env.NEXT_PUBLIC_ARC_GATEWAY_API_URL ??
  "https://gateway-api-testnet.circle.com";

export const ARC_CHAIN_NAME =
  process.env.NEXT_PUBLIC_ARC_CHAIN_NAME ?? "Arc Testnet";
export const ARC_EXPLORER_URL =
  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";
export const ARC_IS_TESTNET = process.env.NEXT_PUBLIC_ARC_IS_TESTNET !== "0";

export const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: ARC_CHAIN_NAME,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: ARC_EXPLORER_URL },
  },
  testnet: ARC_IS_TESTNET,
});
