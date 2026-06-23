# Tollgate — Codex Build Handoff (A → Z)

**Target:** win the grand prize at the **Lepton Agents Hackathon** (Canteen × Circle × Arc).
**Product:** Tollgate — an autonomous answer agent that pays creators per cited source in real USDC on Arc, governed by an on-chain spend covenant, with on-chain proof of reuse, running as a live self-sustaining citation market.
**Repo:** `C:\Users\gudma\OneDrive\Desktop\GITHUB-FILES\leptonweb` (Next.js 15 / React 19 / TS).
**Forum (your own deployed Arc substrate):** `C:\Users\gudma\forum`.

> This note is the single source of truth for the build. Read it fully before writing code. Where a fact is marked **⚠ VERIFY FIRST**, confirm it against the actual source before relying on it — do not assume.

---

## 0. House rules (non-negotiable)

- **Verify first, never assume.** Read the file / check the lockfile / run the command before writing or editing. Confirm every signature, address, and version against source.
- **No Claude/Anthropic attribution** anywhere — no code comments, no commit messages, no `Co-Authored-By`. Ever.
- **Never submit anything** (the hackathon form, public release, package publish) without explicit user approval. Building/committing is fine; submitting is not.
- **Run tests after every change.** `npm test` + `npm run typecheck` must stay green. For bug fixes, write a failing test first.
- **Match existing style.** Mirror the patterns already in `src/lib` (small pure functions, explicit types, no `any`, atomic file writes via tmp+rename, no speculative abstraction).
- **Minimal diffs.** Every changed line must trace to this plan. No drive-by refactors, no unrequested features.
- **Secrets never touch the tree.** See §8 before any commit or public push.

---

## 1. Hackathon facts (the scoring target)

- **Dates:** Jun 15 → **Jun 29, 2026**. Today is **Jun 23** → ~6 working days. Async judging, no live demo day.
- **Grand prizes:** 1st **$10k**, 2nd $7.5k×2, 3rd $5k×3.
- **Submission:** public GitHub repo (required) + **<3-min video** (required) + live URL (encouraged) + traction answers (how many users, what problem). Submit early/often. Form: `forms.gle/SMqLaw2pMGDe58LFA` (approval-gated — do NOT submit without the user).
- **Judging weights:** Agentic Sophistication **30%** ("full autonomy beats meaningful agency beats AI-flavored automation"), Traction **30%** ("payments actually flowing in test USDC; creators getting paid and readers paying"), Circle tool usage **20%**, Innovation **20%**.
- **Helpers:** **TestMint** `testmint.myproceeds.xyz` — up to $10k testnet USDC via x402 (use to fund payer + bond). **1Claw** `1claw.dev` — agent secrets mgmt (code `LEPTON26`), optional.
- **Reference repos to study:** `circlefin/arc-nanopayments` (LangChain paying agent + x402 seller endpoints + Gateway batching — the canonical pattern), `the-canteen-dev/circle-agent`.
- **CLIs:** ARC CLI `uv tool install git+https://github.com/the-canteen-dev/ARC-cli`; Circle CLI `npm install -g @circle-fin/cli` (needs Node ≥20.18.2 — we have v24).

**Why this design scores:** it's the host's own published "Prior Art #1" (content that earns every time it's cited) and the Distribution Bootstrap's "LLM Crawler Citation-Toll Layer," built end-to-end with real on-chain settlement and emergent volume. It composes the user's own live Arc infra (Forum) — un-replicable in the window.

---

## 2. Verified current state

### June 23 closeout update

- Automatic TrackRecord publishing is now in the runtime settlement path. A fresh `/api/query` call on the gateway-enabled server published TrackRecordV2 seq `2`, tx `0xe51a5d44e31cfb6afff5f6307a2e78a9bf2cbcb2ba49c2b14d903f964d9a113e`, record hash `0xff9b90778f8e89554d0117b05df33bf10b1b6bcbf55ed94982b101ff59aff723`.
- Circle Gateway batching is implemented with `@circle-fin/x402-batching`. `npm run start:gateway-server` starts the Gateway/TrackRecord runtime; `npm run prove:gateway-source` deposited `0.05` USDC into Gateway and bought `circle-gateway-nano`, producing receipt `0xe0f5d2d3af8926360e6506e96711afca7ef509540325d73ae1b82807dbe86f12` with Gateway transaction id `dd6856ac-fbf0-4723-b439-6e20f84dbee2`.
- A fresh SlashBond demo contract was deployed at `0x174b10e4892bb66433babb0df41ab6d7a3333029`, bonded with `1000` atomic USDC, and slashed by `1` atomic USDC in tx `0x764d76e205ab01b2200bd3ed0d729171e45cf0813d96968cd5b3f81f9d7e85c4`. The UI reads `data/slashbond-demo.json`.
- `/demo` now surfaces TrackRecord, CovenantVault, SlashBond demo slash, and Gateway-settled source proof directly.
- ARC CLI is installed as `arc-canteen` via `uv tool install git+https://github.com/the-canteen-dev/ARC-cli`; Windows Application Control blocks the generated exe shim, but the installed Typer app works through `"$env:APPDATA\uv\tools\arc-canteen\Scripts\python.exe" -c "from arc_canteen.cli import app; app()" -- --help`. Circle CLI is installed as `circle.ps1`, version `0.0.6`.
- TestMint `https://testmint.myproceeds.xyz` is live. Verified client flow: pay mainnet Base USDC via x402, POST `/api/transfer`, choose `destinationChain: "arc-testnet"`, then stream the mint tx via `/api/tx-stream?token=<deliveryToken>`. No TestMint purchase was submitted.
- Latest local verification: `npm run typecheck`, `npm test -- --run`, `npm run build`, and `npm run verify:ledger` pass. Ledger after live proofs: 19 queries, 45 receipts, latest hash `0xe0f5d2d3af8926360e6506e96711afca7ef509540325d73ae1b82807dbe86f12`.

### leptonweb (verified this session)
- Node **v24.15.0**, npm **11.12.1**.
- Deps: `next@^15.5.4`, `react@19`, `viem@^2.52`, `@x402/core@2.13.0` + `@x402/evm` + `@x402/fetch` (present in `node_modules/@x402`, working). Dev: `vitest@3.2`, `typescript@^5.7`.
- **Tests 14/14 pass**, `tsc --noEmit` clean, `npm run verify:ledger` ok (15 queries / 35 receipts, chain intact). Ledger settlement modes: 30 `local-proof`, 4 `x402-verified`, 1 `x402-settled`.
- **Git: branch `leptonweb-mvp` has ZERO commits; everything is untracked.** First action is a clean baseline commit (after secret scan).
- **No LLM dependency exists** — `src/lib/engine.ts` is deterministic keyword scoring. This is the #1 scoring gap to close.

### Key existing files (read before touching)
- `src/lib/engine.ts` — source selection + answer synthesis (deterministic; to be made agentic).
- `src/lib/catalog.ts` — `DEFAULT_CREATOR_SOURCES` (seeded; to be replaced by live RSSHub market) + `data/sources.json` registry.
- `src/lib/ledger.ts` — hash-linked receipt chain (`appendSettlement`, `createReceipts`, `verifyLedgerIntegrity`).
- `src/lib/payments.ts` — `tollgateAgentWallet()`, `PAID_QUERY_PRICE_ATOMIC_USDC=1000`. Default agent wallet `0x5C94b3aBb29c1dFcA24313B9A2D383960Cd69836`.
- `src/lib/settlement.ts` — `settleQuestion` / `settlePaidQuestion`.
- `src/lib/x402-server.ts` / `x402-client.ts` — x402 verify/settle on Arc (EIP-3009).
- `src/lib/chain.ts` — Arc config: chainId **5042002**, RPC `https://rpc.testnet.arc.network`, USDC `0x3600000000000000000000000000000000000000`, `USDC_DECIMALS=6`, explorer `https://testnet.arcscan.app`. ⚠ NOTE: `arcTestnet.nativeCurrency.decimals` is set to **18** while USDC atomic uses 6 — confirm which is correct for gas vs. asset math before settlement work.
- App routes: `src/app/api/{query,paid-query,sources,sources/[sourceId],ledger,receipts/[hash],settlement/status}`, pages `/answers/[queryId]`, `/creators/[wallet]`, `/sources/[sourceId]`, `/proof`, `/demo`.
- Scripts: `scripts/*.mjs` (verify-ledger, prove-x402-source, prove-paid-query, seed-judge-demo, check-facilitator, check-wallet-funding, create-wallets, wallet-keystore…).

---

## 3. Forum — your live Arc substrate (verified)

Local clone `C:\Users\gudma\forum`. Deployment manifest: `forum/deployments/arc-testnet.json`. TS SDK: `forum/sdk-ts/src` (`ForumClient`, `CovenantVaultClient`, `SlashBondClient`, `RiskKernelClient`, `TrackRecordV2Client`, `FeeDistributorClient`, `IndexerClient`, ABIs).

**Contracts verified LIVE on Arc (`eth_getCode` returned bytecode):**

| Contract | Address | Role in Tollgate |
|---|---|---|
| `FeeRouterV1` | `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59` | Per-answer creator payouts (splits) |
| `SlashBondV1_1` | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` | Agent reputation collateral + slashing |
| `TrackRecordV2` | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` | On-chain signed attribution log |
| `CovenantVaultFactory` | `0xc9bbafd02d22dd75a9f043f50f126ac2fe22ca26` | Budget-bounded agent account (self-serve) |

**Other manifest addresses (Arc testnet, chainId 5042002, USDC `0x3600…0000`):**
`CovenantVaultFactoryV2` `0x4766e3c506a5ff543d12f672ed5f167fabe26fe0` (bond-gated, deploys V3) · `RiskKernelV3` `0x554cdad3cac1f640b39816193310166afc2bde06` · `RiskKernelV2` `0x0af356f280af1d8b7a43f0746c581614feec4055` · `SlashBond` `0x66040fd1aea2c09dde83252114532b6cb9941482` · `FeeDistributor` `0x0574257629e8221d560cf4aace0f3cd7226be2a0` · deployer `0x13585c6004fbA9D7D49219a6435B68348fD30770`.
**Circle on Arc (from manifest, source docs.arc.io):** Gateway wallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, Gateway minter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`, EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`, CCTP v2 TokenMessenger `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`.

**Verified contract interfaces:**
- `FeeRouterV1`: `createSplit(address[] recipients, uint16[] bps) → splitId` (event `SplitCreated`); `pay(uint256 splitId, uint256 amount)` (event `Routed`); `claim() → amount` (pull; event `Claimed`); `splitAt(splitId)`, `splitCount()`. ⚠ **No SDK client and no exported ABI** — extract ABI from Forum foundry artifacts (`forum/out/FeeRouterV1.sol/FeeRouterV1.json`; run `forge build` in `forum/` if `out/` absent) and call via viem.
- `SlashBond`: `bond(amount)`, `requestUnbond(amount)`, `cancelUnbond()`, `claimUnbond()`, `slash(amount, bytes32 reason)` (**onlyAttestor**), `bondBalance()`, `totalSlashed()`. `SlashBondClient` wraps `bond/bondBalance/totalSlashed/requestUnbond`. ⚠ Attestor of the deployed bond is the deployer/RiskKernel — confirm who can call `slash` and decide: drive via deployer key, or deploy a fresh bond with our dispute-resolver as attestor.
- `TrackRecordV2`: `registerBot(botId, kind, signer)`, `publish(botId, record, signature)` (EIP-712 signed), `recordCount`, `recordAt`, `lastSeq`, `lastRecordHash`, `domainSeparator`, `signer`, `structHash`, `digest`. Full client wrapper exists. This is a sequence-numbered on-chain hash chain.
- `CovenantVault*`: `mandate()`, `state()`, `snapshot()`, `deposit`, `withdraw`, `pullCredit`, `returnCapital`, `sharesOf`. ⚠ **Yield/trading-shaped** (mandate fields: `budgetUsdc`, `maxDrawdownBps`, `perfFeeBps`, NAV high-water-mark). Use as **budget/bond envelope only** unless reading full `CovenantVault.sol` proves the spend path fits citation payments. Not load-bearing for the floor.

---

## 4. Architecture (what to build)

```
Buyer (human or agent)
  │ asks question + funds budget (TestMint USDC)
  ▼
Tollgate Agent  ── operates under Forum Covenant budget + posts SlashBond ──┐
  │ 1. pull live candidate sources from RSSHub (real author URLs)           │
  │ 2. REASON (LLM): which to buy / skip / how to allocate, given budget    │  reputation
  │ 3. pay citation toll per source via x402 (settled USDC)                 │  at stake
  │ 4. ground answer ONLY in bought content                                 │
  ▼                                                                          │
Creator payouts → FeeRouterV1.createSplit + pay  (creators claim())  ◄──────┘
On-chain proof  → TrackRecordV2.publish (signed answer+citations record)
Off-chain proof → existing data/ledger.json hash chain (keep, link to on-chain)
Settlement      → batched via Circle Gateway
  ▼
Public proof UI (/proof, /demo, /answers/[id]) → arcscan tx links + bond state
Self-driving demand engine → buyer agents loop → continuous live on-chain volume
x402-Cite → open spec + SDK so other crawlers/creators adopt the toll
```

**Rubric mapping:** agentic = real reasoning loop under enforceable covenant; traction = real RSSHub creators paid + open A2A endpoint + self-driving volume; Circle = x402 + USDC + Gateway + Wallets + Contracts (via Forum); innovation = Prior Art #1 + #8 + research note on emergent pricing.

---

## 5. Build plan — rungs (each independently submittable; climb in order)

> Ship and commit at each rung. Submit-ready by Rung 2; everything above compounds the score.

### Rung 0 — Baseline & rails (Day 1)
1. **Secret scan** of the working tree (see §8), then **first git commit** of current leptonweb on `leptonweb-mvp`.
2. Install ARC CLI + Circle CLI; clone/study `circlefin/arc-nanopayments` for the Gateway batching + paying-agent pattern. **⚠ VERIFY** the actual Gateway batch call flow before §Rung 3 settlement work.
3. **TestMint**: fund the agent payer wallet + (later) the bond. **⚠ VERIFY** TestMint works for Arc and which wallet/format it expects.
4. Add `src/lib/forum.ts` (see §6) — a thin, typed Forum client wired to the real manifest addresses; no behavior yet, just read methods + a liveness self-test script `scripts/check-forum.mjs` (eth_getCode + `FeeRouterV1.splitCount()` + `TrackRecordV2.recordCount(botId)`).
**DoD:** repo committed; CLIs installed; one real value read from each Forum contract on Arc.

### Rung 1 — Floor: real agent + real creators + real settlement (Days 1–2) — MUST LAND
1. **Autonomous agent core** `src/lib/agent.ts`: an LLM reasoning loop that takes (question, candidate sources, budget) and returns `{ decisions: SourceDecision[], boughtSourceIds, answer, rationale }`. Keep `engine.ts` ranking as a cheap pre-filter + deterministic fallback when no API key / on error. Populate the existing `SourceDecision`/`AgentBudget` shapes from the model output. ⚠ Decide LLM provider + key handling; rate-limit the public path so an LLM-in-loop endpoint can't be drained.
2. **Live creator market** `src/lib/sources/rsshub.ts`: fetch real RSSHub feed items → `CreatorSource` (real `author.url`). Curated opt-in **wallet registry** `data/creator-registry.json` mapping author → wallet (this is the moat; seed with a handful of real opted-in creators recruited from Canteen/Arc Discord). Make this the default market; keep seeded catalog only as fallback.
3. **Real settlement**: route per-citation payouts through `FeeRouterV1` (`createSplit` → `pay` → creator `claim`); flip ledger receipts to reflect on-chain tx hashes (extend `PaymentReceipt`/`ReceiptEvidence` with `chainTxHash`, `feeRouterSplitId`). Prove one end-to-end `pay→claim` on Arc with an arcscan link.
**DoD:** ask a question → agent reasons → real RSSHub creator paid real USDC on Arc → arcscan link in the receipt. Tests green.

### Rung 2 — On-chain proof + self-driving traction (Day 3)
1. **On-chain attribution**: `registerBot` once; per answer `TrackRecordV2.publish` a signed record anchoring `{queryHash, answerHash, citations}`. Link the on-chain `recordAt`/`lastRecordHash` from `/answers/[id]` and `/proof`.
2. **Self-driving demand engine** `scripts/demand-engine.mjs`: a loop of buyer agents asking real questions and paying via the public endpoint, generating continuous on-chain volume during the judging window. Log volume metrics for the submission form. **⚠** add spend caps + a kill switch; never run unbounded.
3. **Proof UI**: upgrade `/proof` + `/demo` to show live arcscan tx links, creator payout totals, on-chain record count, and (Rung 4) bond state. Build for a judge clicking around alone.
**DoD:** live network producing verifiable on-chain volume; `/proof` shows it with arcscan links.

### Rung 3 — Covenant budget envelope (Day 4)
- Give the agent a Forum **Covenant Account** via `CovenantVaultFactory.createVault(mandate)` as the enforceable budget envelope (FactoryV2 enforces bond ≥ budget). Use **Circle Wallets** for agent + creator wallets. ⚠ Confirm the vault spend semantics fit before making it load-bearing; otherwise keep it as budget-attestation + bond gate and keep payouts on FeeRouter.
**DoD:** agent's spend is provably bounded on-chain.

### Rung 4 — Reputation at stake (Day 5)
- Agent posts a `SlashBond`; a disputed/low-quality citation triggers `slash(amount, reason)` via the attestor; surface `bondBalance`/`totalSlashed` in `/proof`. ⚠ Resolve attestor control (§3). This is Prior Art #8 + RFB 3.
**DoD:** a demonstrated slash on a bad citation, visible on-chain.

### Rung 5 — Standard + research (Day 6)
- `x402-Cite`: a short spec (`docs/x402-cite.md`) for the citation-toll header/receipt + a tiny reference client package. Write `docs/emergent-pricing.md` analyzing the demand-engine data (clearing price of a citation). Repositions Tollgate as infrastructure (RFB 5) + research insight (innovation).
**DoD:** spec + SDK + research note committed.

### Submit (Jun 28 → iterate to 29)
- Deploy live to VPS (`tollgate.gudman.xyz`, same nginx+TLS pattern as other `*.gudman.xyz` apps). Record <3-min video. Prepare repo README for a cold reviewer. **Get user approval, then submit.** Resubmit as volume grows.

---

## 6. `src/lib/forum.ts` — integration contract (to implement)

A thin wrapper over the local `forum/sdk-ts` + a viem-built `FeeRouterV1` instance. Suggested surface (confirm signatures against the SDK/ABIs first):

```ts
// Reads addresses from forum/deployments/arc-testnet.json (vendored or imported).
export async function payCitationSplit(
  recipients: `0x${string}`[], bps: number[], amountAtomicUsdc: bigint
): Promise<{ splitId: bigint; routedTx: `0x${string}` }>;        // createSplit (once/cache) + approve + pay

export async function publishAttestation(
  botId: `0x${string}`, record: TrackRecordV2Record, signature: `0x${string}`
): Promise<{ tx: `0x${string}`; seq: number }>;                  // TrackRecordV2.publish

export async function bondStatus(): Promise<{ balance: bigint; totalSlashed: bigint }>; // SlashBondClient
export async function postBond(amount: bigint): Promise<`0x${string}`>;
export async function slashBond(amount: bigint, reason: `0x${string}`): Promise<`0x${string}`>; // attestor only
```

Integration notes: TrackRecordV2 publish needs EIP-712 signing — reuse `TrackRecordV2Client.structHash/digest` from the SDK rather than re-deriving. FeeRouter ABI must come from foundry artifacts. Cache split IDs per creator-set to avoid re-creating splits each answer.

---

## 7. Open items to resolve BEFORE the dependent rung (⚠ VERIFY FIRST)

1. **Gateway batching call flow** — read `circlefin/arc-nanopayments`; confirm exact wallet/minter usage before Rung 3 settlement batching.
2. **TestMint on Arc** — confirm it dispenses Arc testnet USDC and the request format.
3. **FeeRouter ABI** — present in `forum/out/`? If not, `forge build` in `forum/`.
4. **SlashBond attestor** — who can `slash`; pick the driver path (Rung 4).
5. **CovenantVault spend fit** — read full `CovenantVault.sol`; keep as envelope if it doesn't model citation spend (Rung 3).
6. **LLM provider + key** — choose model + secure key handling + endpoint rate limiting (Rung 1).
7. **USDC decimals discrepancy** in `chain.ts` (native 18 vs asset 6) — confirm before any amount math.
8. **`forum/sdk-ts` consumption** — build it (`npm run build` in `forum/sdk-ts`) and import the dist, or path-link; it is NOT published to npm.

---

## 8. Security (do before any commit/public push)

- `arc-grant-submission` memory flags a **live `gho_` GitHub token + Canteen token in plaintext at `~/.arc-canteen/config.yaml`**, and deployer keys at `~/.forum-keys/`. **Rotate the `gho_` token** and confirm none of these paths or any `.key`/`.env`/keystore can enter a commit. Verify `.gitignore` covers `wallets/`, `*.dpapi.json`, `.env*`, keys. Scan the tree (`git status`, grep for `0x`-prefixed 64-hex, `gho_`, `sk-`, `PRIVATE_KEY`) before the Rung 0 commit.
- The public repo must contain **no private keys**. Demo wallets only; fund via TestMint.

---

## 9. Definition of done (grand-prize bar)

- A judge opens the live URL and sees the network **actively settling** real testnet USDC to real creators, with **arcscan links** on every payout and on-chain `TrackRecordV2` records.
- The agent **reasons** (model-driven buy/skip/allocate with rationale), bounded by an on-chain covenant, with reputation **at stake** (bond + a shown slash).
- Repo is clean, committed, secret-free, tests green; README orients a cold reviewer; <3-min video recorded.
- Traction numbers (users onboarded, citations settled, volume) ready for the form.
- **User approves before submission.**

## 10. Command reference

```bash
# leptonweb
npm install && npm run dev
npm test && npm run typecheck && npm run build
npm run verify:ledger
node scripts/check-forum.mjs          # (to create) Forum liveness

# forum SDK
cd C:/Users/gudma/forum/sdk-ts && npm install && npm run build
cd C:/Users/gudma/forum && forge build   # if out/ ABIs missing

# tooling
uv tool install git+https://github.com/the-canteen-dev/ARC-cli
npm install -g @circle-fin/cli
```

**Arc:** chainId `5042002` · RPC `https://rpc.testnet.arc.network` · USDC `0x3600000000000000000000000000000000000000` · explorer `https://testnet.arcscan.app`.
