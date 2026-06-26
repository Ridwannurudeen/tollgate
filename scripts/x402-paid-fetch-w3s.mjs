import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { w3sSignTypedData } from "./circle-w3s.mjs";

const ARC_CAIP2 = "eip155:5042002";

/**
 * Build a paid fetch whose x402 payments are signed by a Circle W3S
 * developer-controlled wallet — no local private key. The signer shape is
 * byte-identical to the private-key path in x402-paid-fetch.mjs; only
 * `signTypedData` differs (W3S REST vs a local viem account).
 */
export function createW3SPaidFetch({ walletId, address }) {
  const signer = {
    address,
    signTypedData: (message) => w3sSignTypedData(walletId, message, "Tollgate x402"),
  };
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: ARC_CAIP2, client: new ExactEvmScheme(signer) }],
  });
}
