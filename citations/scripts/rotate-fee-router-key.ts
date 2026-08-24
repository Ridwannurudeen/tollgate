import type { Hex } from "viem";
import { rotateFeeRouterKeystoreSigner } from "../src/lib/fee-router-key-rotation";

const nextPrivateKey = process.env.LEPTONWEB_FEE_ROUTER_NEXT_PRIVATE_KEY as
  | Hex
  | undefined;
if (!nextPrivateKey) {
  throw new Error("LEPTONWEB_FEE_ROUTER_NEXT_PRIVATE_KEY is required.");
}

const result = await rotateFeeRouterKeystoreSigner(nextPrivateKey);
console.log(
  JSON.stringify({
    outgoingAddress: result.outgoingAddress,
    incomingAddress: result.incomingAddress,
    revokedSpenders: result.revokedSpenders,
  }),
);
