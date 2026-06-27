import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";

const ARC_CAIP2 = "eip155:5042002";

export function createPaidFetch(account) {
  const signer = {
    address: account.address,
    signTypedData: (message) => account.signTypedData(message),
  };
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: ARC_CAIP2, client: new ExactEvmScheme(signer) }],
  });
}
