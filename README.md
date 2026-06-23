# LeptonWeb

LeptonWeb is a paid knowledge network for AI agents. The hackathon wedge is Tollgate: an answer engine that pays creators per cited source and writes attribution receipts for every answer.

## Scope

- RFB 06 primary: Creator & Publisher Monetization.
- RFB 01 secondary: Autonomous Paying Agents.
- Current query settlement mode: local proof ledger with hash-linked receipts.
- Source access rail: x402-compatible `402 Payment Required` endpoint for every priced source.
- Paid answer rail: `POST /api/paid-query` requires a reader x402 payment before the answer is generated.
- Agent buying policy: every answer records the priced sources considered, the budget used, and the sources bought or skipped.
- Creator onboarding: `POST /api/sources` persists priced sources to `data/sources.json`.
- Receipt explorer: `/receipts/<receiptHash>` renders the evidence behind any payment.
- Answer evidence page: `/answers/<queryId>` renders the query hash, answer hash, source decisions, reader payment, and citation receipts.
- Public evidence pages: `/creators/<wallet>` and `/sources/<sourceId>` expose shareable payout trails.
- Network proof page: `/proof` aggregates payout totals, receipt-chain health, sources, creators, and recent receipts.
- Judge demo page: `/demo` turns the seeded ledger into an ordered proof path for the live walkthrough.
- Next adapter: connect a funded payer wallet / facilitator so receipts move from `x402-verified` to `x402-settled`.

## Run

```bash
npm install
npm run dev
```

## Verify

```bash
npm test
npm run typecheck
npm run build
npm run verify:ledger
npm run prove:x402
npm run prove:paid-query
npm run prove:wallet-source
npm run prove:wallet-paid-query
npm run check:facilitator
npm run check:wallet-funding
npm run seed:judge-demo
npm run create:wallets
npm run wallets:list
```

## Product wedge

1. A creator registers a priced source.
2. A user asks a source-backed question.
3. The agent ranks the source market, enforces a source budget, and skips lower-value or unaffordable sources.
4. Each cited creator receives a payment receipt.
5. The answer, source decisions, citations, amounts, and receipt hashes are visible in the dashboard.
6. `/answers/<queryId>` turns each generated answer into a standalone proof page.
7. Creator and source evidence pages turn that ledger into shareable traction links.
8. `npm run seed:judge-demo` appends a repeatable local-proof answer, x402-verified paid answer, and x402-verified source purchase, then prints the exact proof links.
9. `/demo` turns those proof links into a single ordered judge path.
10. `/proof` gives judges one aggregate network-health page.

The local ledger is intentionally plain JSON at `data/ledger.json` so the first build is inspectable. The creator registry is plain JSON at `data/sources.json`. The x402/Gateway adapter should replace only the payment settlement step, not the attribution model or receipt explorer.

## API surface

- `GET /api/sources` lists default and registered priced sources.
- `POST /api/sources` registers a source with `title`, `creator`, `handle`, `wallet`, `url`, `summary`, `tags`, and `priceAtomicUsdc`.
- `GET /api/sources/<sourceId>` returns an x402 `402 Payment Required` challenge until a valid `PAYMENT-SIGNATURE` is supplied.
- `POST /api/query` runs the paying answer engine and appends citation receipts.
- `POST /api/paid-query` returns an x402 `402 Payment Required` challenge for the reader payment, verifies/settles the signed retry, then appends a reader-paid query and citation receipts linked to the reader payment hash.
- `GET /api/ledger` returns the ledger, creator earnings, and integrity verification.
- `GET /api/receipts/<receiptHash>` returns one receipt and the answer context.
- `GET /api/settlement/status` reports verify-only vs settle-enabled mode without exposing secrets.
- `/answers/<queryId>` renders answer-level evidence by query id, query hash, or answer hash.
- `/creators/<wallet>` renders a creator's earned USDC, source mix, and receipt trail.
- `/sources/<sourceId>` renders source pricing, tags, usage, and receipt trail.
- `/proof` renders the aggregate proof page for judges.
- `/demo` renders the seeded judge walkthrough from the latest local answer, reader-paid answer, and source-purchase evidence.

## x402 source rail

Each source is exposed as a paid resource:

```bash
curl -i http://127.0.0.1:3000/api/sources/circle-gateway-nano
```

Without a `PAYMENT-SIGNATURE` header, the endpoint returns `402` and a `PAYMENT-REQUIRED` header describing the Arc testnet USDC requirement. With a valid x402 payment signature, the route verifies it on Arc; if `FACILITATOR_PRIVATE_KEY` is configured, it attempts settlement and returns a `PAYMENT-RESPONSE` header.

`npm run prove:x402` generates an ephemeral payer, signs the x402 payment, calls the source endpoint, and appends an `x402-verified` receipt to the public ledger. It does not print the generated private key.

`npm run prove:paid-query` generates an ephemeral payer, signs an x402 payment for `/api/paid-query`, and appends a reader-paid answer whose creator allocation receipts include the reader payment hash. It does not print the generated private key.

`npm run check:facilitator` checks Arc RPC connectivity, settlement mode, agent payee, paid-query price, and whether `FACILITATOR_PRIVATE_KEY` is present in the process environment. It never prints the private key.

`npm run check:wallet-funding` checks public Arc testnet balances for the generated wallets, reports the exact funding gaps for settled paid-query/source demos, and exits non-zero when `demo-payer` or `x402-facilitator` cannot run `npm run prove:settled-paid-query`. It never prints private keys.

`npm run create:wallets` creates the local operational wallet set. It writes public funding addresses to `wallets/funding-addresses.json` and DPAPI-encrypted private keys to `wallets/local-keystore.dpapi.json`. The encrypted keystore is ignored by git and decryptable only by the Windows user profile that created it.

`npm run wallets:list` prints the public wallet roles and addresses from the encrypted keystore. It never prints private keys.

`npm run prove:wallet-source` uses the generated `demo-payer` wallet to buy `leptonweb-build-log` through the x402 source rail and append a source-access receipt.

`npm run prove:wallet-paid-query` uses the generated `demo-payer` wallet to pay `/api/paid-query`, then appends the reader-payment evidence and creator citation receipts.

`npm run seed:judge-demo` expects the app to be running at `LEPTONWEB_BASE_URL` or `http://127.0.0.1:3000`. It generates an ephemeral payer, appends one local-proof answer, one x402-verified paid answer, and one x402-verified source purchase, then prints the `/proof`, `/answers/<queryId>`, `/sources/<sourceId>`, and `/receipts/<receiptHash>` URLs to open during the demo. It does not print the generated private key.

To attempt real settlement instead of verify-only signatures, fund `demo-payer` with Arc testnet USDC asset balance and fund `x402-facilitator` with native Arc testnet USDC for gas. Then run:

```bash
npm run check:wallet-funding
```

After the funding preflight is green, run:

```bash
npm run start:settle-server
```

In another terminal:

```powershell
$env:LEPTONWEB_BASE_URL='http://127.0.0.1:3010'
npm run prove:settled-paid-query
```

`npm run verify:ledger` recomputes the receipt hash chain from `data/ledger.json` and exits non-zero if any receipt hash, `previousHash`, or query reference breaks.

## Funding addresses

The current generated Arc testnet funding list is in `wallets/funding-addresses.json`:

- `tollgate-agent-payee`: receives `/api/paid-query` reader payments.
- `x402-facilitator`: settlement facilitator wallet.
- `demo-payer`: wallet to fund for signed x402 demos.
- `creator-primary`: receives paid-source purchases for `leptonweb-build-log`.
- `creator-secondary`: reserve payee for another creator source.
