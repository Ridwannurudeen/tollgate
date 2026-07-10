import { ExactEvmScheme, type ClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ARC_CAIP2 } from "../chain.js";

export type CreateX402PaidFetchOptions = {
  signer: ClientEvmSigner;
  fetch?: typeof globalThis.fetch;
};

export function createX402PaidFetch(
  options: CreateX402PaidFetchOptions,
): typeof globalThis.fetch {
  return wrapFetchWithPaymentFromConfig(options.fetch ?? globalThis.fetch, {
    schemes: [
      { network: ARC_CAIP2, client: new ExactEvmScheme(options.signer) },
    ],
  });
}
