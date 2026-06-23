import { defineChain } from "viem";

export const ARC_CHAIN_ID = 5042002;

export const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";

export const ARC_CAIP2 = `eip155:${ARC_CHAIN_ID}` as const;

export const ARC_USDC = "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;
export const ARC_GATEWAY_WALLET =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const ARC_GATEWAY_API_URL = "https://gateway-api-testnet.circle.com";

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});
