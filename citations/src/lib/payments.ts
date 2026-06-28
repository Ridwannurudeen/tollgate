import type { Address } from "viem";

const DEFAULT_AGENT_WALLET = "0x5C94b3aBb29c1dFcA24313B9A2D383960Cd69836";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const PAID_QUERY_PRICE_ATOMIC_USDC = 10_000;

export function tollgateAgentWallet(): Address {
  const wallet = process.env.LEPTONWEB_AGENT_WALLET ?? DEFAULT_AGENT_WALLET;
  if (!ADDRESS_PATTERN.test(wallet)) {
    throw new Error("LEPTONWEB_AGENT_WALLET must be a 20-byte EVM address.");
  }
  return wallet as Address;
}
