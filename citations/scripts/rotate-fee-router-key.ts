import type { Hex } from "viem";
import { rotateFeeRouterKeystoreSigner } from "../src/lib/fee-router-key-rotation";
import { assertFeeRouterServiceStopped } from "../src/lib/fee-router-rotation-offline";

const nextPrivateKey = process.env.LEPTONWEB_FEE_ROUTER_NEXT_PRIVATE_KEY as
  | Hex
  | undefined;
if (!nextPrivateKey) {
  throw new Error("LEPTONWEB_FEE_ROUTER_NEXT_PRIVATE_KEY is required.");
}

await assertFeeRouterServiceStopped(
  process.env.LEPTONWEB_INTERNAL_ORIGIN ?? "http://127.0.0.1:3091",
);
const result = await rotateFeeRouterKeystoreSigner(nextPrivateKey);
console.log(
  JSON.stringify({
    status: "allowances-revoked-activation-required",
    outgoingAddress: result.outgoingAddress,
    incomingAddress: result.incomingAddress,
    revokedSpenders: result.revokedSpenders,
    requiredAction:
      "Replace LEPTONWEB_FEE_ROUTER_PRIVATE_KEY with the incoming key, remove LEPTONWEB_FEE_ROUTER_NEXT_PRIVATE_KEY, then restart.",
  }),
);
