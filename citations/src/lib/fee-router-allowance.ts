// Exact-amount approvals fall back to ~0 after each payment, so concurrent
// payouts can race a tiny allowance and revert. Every caller instead writes the
// same bounded ceiling, preserving headroom while limiting each spender.
const DEFAULT_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC = 1_000_000n;
const MAX_UINT256 = (1n << 256n) - 1n;

export function feeRouterAllowanceCeiling(): bigint {
  const raw = process.env.LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC?.trim();
  if (!raw) return DEFAULT_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      "LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC must be a positive uint256 integer.",
    );
  }
  const value = BigInt(raw);
  if (value <= 0n || value > MAX_UINT256) {
    throw new Error(
      "LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC must be a positive uint256 integer.",
    );
  }
  return value;
}

export function feeRouterAllowanceTarget(requiredAmount: bigint): bigint {
  const ceiling = feeRouterAllowanceCeiling();
  if (requiredAmount > ceiling) {
    throw new Error(
      `Payment of ${requiredAmount.toString()} atomic USDC exceeds the FeeRouter allowance ceiling of ${ceiling.toString()}.`,
    );
  }
  return ceiling;
}
