import type { Address } from "viem";

const DEFAULT_AGENT_WALLET = "0x5C94b3aBb29c1dFcA24313B9A2D383960Cd69836";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

// x402 must quote a price before the answer exists, so this is the ceiling the
// reader authorises; the reader is then charged for what the answer actually
// delivered and the remainder is refunded on-chain.
export const PAID_QUERY_PRICE_ATOMIC_USDC = 10_000;
export const DEFAULT_CLAIM_PRICE_ATOMIC_USDC = 1_000;

export function claimPriceAtomicUsdc(): number {
  const value = Number(process.env.LEPTONWEB_CLAIM_PRICE_ATOMIC);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_CLAIM_PRICE_ATOMIC_USDC;
}

export type ClaimSettlement = {
  chargeAtomicUsdc: number;
  refundAtomicUsdc: number;
};

// Prices the answer by the claims it actually supported. The charge never
// falls below what creators were already paid for this answer — that USDC has
// left the agent wallet, so refunding past it would settle at a loss.
export function claimSettlement(input: {
  supportedClaimCount: number;
  creatorPayoutAtomicUsdc: number;
  quotedAtomicUsdc: number;
  claimPriceAtomicUsdc: number;
}): ClaimSettlement {
  const byClaims =
    Math.max(0, input.supportedClaimCount) *
    Math.max(0, input.claimPriceAtomicUsdc);
  const floor = Math.max(0, input.creatorPayoutAtomicUsdc);
  const quoted = Math.max(0, input.quotedAtomicUsdc);
  const chargeAtomicUsdc = Math.min(quoted, Math.max(byClaims, floor));
  return {
    chargeAtomicUsdc,
    refundAtomicUsdc: quoted - chargeAtomicUsdc,
  };
}

export function tollgateAgentWallet(): Address {
  const wallet = process.env.LEPTONWEB_AGENT_WALLET ?? DEFAULT_AGENT_WALLET;
  if (!ADDRESS_PATTERN.test(wallet)) {
    throw new Error("LEPTONWEB_AGENT_WALLET must be a 20-byte EVM address.");
  }
  return wallet as Address;
}
