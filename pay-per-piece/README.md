# tollgate-pay-per-piece

TypeScript SDK for routing per-piece creator payments through the Tollgate FeeRouter on Arc testnet.

The default import contains the chain constants, FeeRouter reads and writes, nonce reservation, and a storage-independent split registry interface. Node file storage and x402 support are separate entry points.

## Before you start

- **This targets Arc testnet only.** Chain ID, RPC default, and the USDC token address are all Arc-testnet constants (`src/chain.ts`). There is no mainnet path today.
- **`FEE_ROUTER_ADDRESS` (`src/fee-router-contract.ts`) is Tollgate's own deployed FeeRouter contract on Arc testnet — you don't deploy your own.** You're routing payments through shared, Tollgate-operated infrastructure, not standing up independent settlement infra. Splits are namespaced by creator address, so this is safe to share across integrators, but it does mean your payouts depend on that contract staying live and unmodified.
- **You need a funded payer wallet before any of this works**: a private key holding some Arc testnet USDC (covers both the payment amount and gas — Arc gas is paid in USDC). Get testnet USDC from `https://faucet.circle.com`. Nothing in the code below will succeed against an empty wallet.
- **The `@x402/evm`/`@x402/fetch` peer dependencies are pinned to exact versions** (`2.17.0`) in `package.json`. If your app already depends on different versions of these for its own x402 handling, you'll get a peer conflict — check before installing.

## Install

```bash
npm install tollgate-pay-per-piece
```

Or use it from this repo without publishing a new version:

```bash
cd pay-per-piece
npm install
npm run build
```

```bash
cd ../your-app
npm install --install-links ../pay-per-piece
```

## Route a per-piece payment

```js
import path from "node:path";
import {
  createFeeRouterPublicClient,
  createFeeRouterSigner,
  ensureCreatorSplit,
  payViaSplit,
} from "tollgate-pay-per-piece";
import { createFileSplitRegistryStore } from "tollgate-pay-per-piece/stores/file";

const privateKey = process.env.PAYER_PRIVATE_KEY;
const recipient = process.env.CREATOR_ADDRESS;
if (!privateKey || !recipient) throw new Error("Payer and creator are required.");

const publicClient = createFeeRouterPublicClient();
const signer = createFeeRouterSigner(privateKey);
const store = createFileSplitRegistryStore(
  path.join(process.cwd(), "data", "fee-router-splits.json"),
);
const split = await ensureCreatorSplit(
  store,
  "article-store",
  recipient,
  [recipient],
  [10_000],
  signer,
  publicClient,
);
const payment = await payViaSplit(
  signer,
  BigInt(split.splitId),
  1_000n,
  publicClient,
);

console.log(payment.txHash);
```

`payViaSplit` checks the payer's ERC-20 USDC balance and allowance, submits an approval when needed, waits for successful receipts, and validates the mined `Routed` event before returning. The current approval policy grants the larger of the payment amount or a 10,000-USDC standing allowance, matching the proven settlement path; use a dedicated capped testnet payer and treat that allowance as an explicit security boundary.

## Split registry storage

The core package accepts any store with this interface:

```ts
type SplitRegistryStore = {
  read(): Promise<FeeRouterSplitRegistry>;
  write(registry: FeeRouterSplitRegistry): Promise<void>;
};
```

The Node-only `createFileSplitRegistryStore(path)` implementation lives at `tollgate-pay-per-piece/stores/file`. It writes a temporary sibling and renames it over the target so readers never observe partial JSON. The registry, nonce, and same-payer payment locks are process-local; run one process per payer account or supply external coordination when multiple workers share a payer.

## Optional x402 paid fetch

Install the optional peers only when an x402 client is needed:

```bash
npm install @x402/evm@2.17.0 @x402/fetch@2.17.0
```

```js
import { createX402PaidFetch } from "tollgate-pay-per-piece/adapters/x402";

async function fetchPaidResource(x402Signer) {
  const paidFetch = createX402PaidFetch({ signer: x402Signer });
  return paidFetch("https://example.com/paid-resource");
}
```

The `x402Signer` argument must use the upstream `ClientEvmSigner` shape: an address plus `signTypedData`. It is not the SDK's `FeeRouterSigner`. Browser wallets, KMS-backed signers, and Circle W3S signers can supply that shape without adding provider credentials to the core package.

## Toy paywall

The worked example is a local-only Node HTTP app. It creates or reuses one creator split, routes one 1,000-atomic-USDC testnet payment, and reveals the static article only after the payment receipt and `Routed` event validate.

```bash
cd examples/toy-paywall
npm install
npm test
npm start
```

Set `TOY_PAYWALL_PRIVATE_KEY` to a dedicated throwaway Arc testnet payer and `TOY_PAYWALL_RECIPIENT_ADDRESS` to the test recipient before posting to `/unlock`. Fund the payer with enough Arc testnet USDC for gas and the article price; Arc exposes that balance through the native 18-decimal view and the `ARC_USDC` 6-decimal contract view. Do not use a production key or expose this toy server publicly.

The server fails closed after any ambiguous settlement error. Check the chain state and restart it before retrying so a mined payment is never submitted twice. See the [recorded Arc testnet proof](examples/toy-paywall/LIVE-PROOF.md) for the fresh-key acceptance run.

## Verification

```bash
npm test
npm run typecheck
npm run build
```
