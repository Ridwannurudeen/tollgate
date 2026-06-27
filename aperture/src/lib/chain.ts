import { defineChain } from "viem";

export const ARC_CHAIN_ID = 5042002;
export const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;
export const ARC_EXPLORER_URL = "https://testnet.arcscan.app";

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: ARC_EXPLORER_URL },
  },
  testnet: true,
});
