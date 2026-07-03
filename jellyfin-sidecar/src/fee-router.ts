import { sha256Hex } from "./hash.js";
import type {
  FeeRouterAdapter,
  FeeRouterSettlementInput,
  SettlementEvidence,
} from "./types.js";

export class DryRunFeeRouterAdapter implements FeeRouterAdapter {
  async settle(input: FeeRouterSettlementInput): Promise<SettlementEvidence> {
    return {
      settlementMode: "dry-run",
      paymentResource: "forum-fee-router:dry-run",
      dryRun: true,
      wallet: input.wallet,
      amountAtomicUsdc: input.amountAtomicUsdc,
      feeRouterSplitId: sha256Hex({
        wallet: input.wallet,
        itemId: input.itemId,
      }).slice(0, 18),
    };
  }
}

export function createFeeRouterAdapter(mode: "dry-run"): FeeRouterAdapter {
  if (mode !== "dry-run") {
    throw new Error("Only the dry-run FeeRouter adapter is available.");
  }
  return new DryRunFeeRouterAdapter();
}
