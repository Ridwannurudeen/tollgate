import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ARC_CAIP2 } from "./chain";
import { type Eip712Message, w3sSignTypedData } from "./circle-w3s";

// A paid fetch whose x402 payments are signed by a Circle W3S developer-
// controlled wallet — no local private key. Only signTypedData differs from the
// browser/private-key path; the payment flow is otherwise identical.
export function createW3SPaidFetch(payer: {
  walletId: string;
  address: `0x${string}`;
}): typeof fetch {
  const signer = {
    address: payer.address,
    signTypedData: (message: Eip712Message) =>
      w3sSignTypedData(payer.walletId, message, "Tollgate x402"),
  };
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: ARC_CAIP2, client: new ExactEvmScheme(signer) }],
  });
}
