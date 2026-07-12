# Judge verification

Run the no-secret verifier against any deployment that exposes the proof pack:

```bash
npm run judge:verify -- --url https://target.example
```

It needs no wallet, API key, or signing secret. A missing proof route or any
integrity/on-chain mismatch is a failure, not a skipped check.

## Deployment status

The current public deployment reports commit `4e6edd2`. On 2026-07-12,
`https://tollgate.gudman.xyz/`, `/proof`, and `/api/judge-proof.json` returned
HTTP 200, and the proof pack reported a valid ledger. That deployment contains
the WS8 anchor-before-payment path. PayGate remains opt-in and undeployed until
an operator deploys the contract and sets `LEPTONWEB_PAYGATE_ADDRESS`.

## 90-second flow

1. **0–10 seconds:** open the landing page and find **Verified judge
   demonstration**. Confirm the disclosure reads exactly **“sponsor-funded
   judge activity — excluded from traction”**.
2. **10–20 seconds:** click **Run the verified judge demonstration** once. No
   login, browser wallet, or judge-supplied secret is required.
3. **20–60 seconds:** watch the returned stage and check. A successful run must
   name the model and show the source market's buy and skip decisions. A failed
   or partial run must remain failed; do not rerun it to manufacture a clean
   recording.
4. **60–80 seconds:** inspect the claim-support rows and refund summary. The
   panel distinguishes supported spans, missing support, unused-source refunds,
   and any refunded reader payment.
5. **80–90 seconds:** inspect the EIP-712 intent digest, claim-support root,
   creator FeeRouter balance delta, Arc anchor transaction, reader-payment
   transaction, and FeeRouter transaction links. Open the full answer page when
   a query ID was returned.

## Completion gate

An upstream 2xx is necessary but not sufficient. `/api/judge-demo` marks
`stage: "complete"` only when all fourteen checks pass:

1. `query.agentMode` is `llm`.
2. `query.agentServerMode` is `judge-strict`.
3. `query.sourceDecisions` contains exactly the fixed five-source pool.
4. `query.sourceDecisions` includes at least one buy.
5. `query.sourceDecisions` includes at least one skip.
6. `query.claimSupport` includes a supported claim with a literal span from the
   fixed pool.
7. `query.refundSummary.refundedCount` is at least one.
8. `query.readerPayment.settlementMode` is `x402-settled`.
9. `query.readerPayment.transaction` is present.
10. `query.readerPayment.actorClass` is `operator`.
11. `query.useIntent.digest` is present.
12. `query.useIntent.anchorTx` is present.
13. At least one returned receipt has `feeRouterPayTx`.
14. `creatorBalances` covers the fixed pool and includes an internally
    consistent positive delta for a source with a FeeRouter payout.

If any check fails, the route returns HTTP 502 with a precise `stage`, `check`,
and error while retaining the complete upstream body. A settled payment is not
discarded or relabeled as complete merely because the paid route returned 201.
Missing evidence is rendered as missing; the UI does not infer or fabricate it.

## Partial-failure semantics

The custodial proxy forwards downstream structured fields instead of reducing
the response to one error string. `/api/judge-demo` preserves any downstream
stage string and forwards returned `readerPayment`, `query`, `receipts`, and
other evidence on non-2xx responses.

| Stage                               | Meaning                                                                                                                                                     | Evidence that can remain visible                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `configuration`                     | Judge-strict mode, FeeRouter, use-intent anchoring, or the registry address is not configured. The sponsored payment route is not called.                   | Fixed question and configuration error.                                                                                      |
| `sponsorship`                       | The sponsored wallet route, balance guard, rate limit, or its transport failed before a more precise downstream stage was returned.                         | Any structured body returned by the sponsored route.                                                                         |
| `appraise`                          | Strict model source appraisal failed.                                                                                                                       | Settled reader-payment evidence and refund evidence when the refund completed.                                               |
| `draft`                             | Strict grounded-answer drafting failed.                                                                                                                     | Reader payment/refund plus any partial query field returned by the API.                                                      |
| `critique`                          | Strict self-critique failed.                                                                                                                                | The same structured payment/query evidence returned downstream.                                                              |
| `reflect`                           | Strict reflection failed.                                                                                                                                   | The same structured payment/query evidence returned downstream.                                                              |
| `escalate`                          | Strict external-assist merge failed.                                                                                                                        | The same structured payment/query evidence returned downstream.                                                              |
| `agent-mode`                        | A paid result did not record `agentMode: "llm"`.                                                                                                            | Full returned settlement body plus check `query.agentMode=llm`.                                                              |
| `agent-server-mode`                 | A paid result did not record judge-strict server mode.                                                                                                      | Full returned settlement body plus check `query.agentServerMode=judge-strict`.                                               |
| `source-decisions`                  | The result did not cover exactly the fixed five-source pool, or lacked either a buy or a skip.                                                              | The returned query and its available decisions, receipts, and ledger.                                                        |
| `claim-verification`                | Claim verification failed downstream or no supported literal span from the fixed pool was returned.                                                         | Reader payment, partial/full query, receipts, and ledger when returned.                                                      |
| `source-refund`                     | The completed paid result did not record at least one unused-source refund.                                                                                 | Full returned settlement body and refund summary.                                                                            |
| `reader-payment`                    | The result was not an exact x402 settlement or lacked the reader-payment transaction required by the completion gate.                                       | Query, receipts, ledger, and any payment fields that were returned.                                                          |
| `configuration` + actor-class check | The paid result was not classified as operator activity, indicating that `CIRCLE_PAYER_ADDRESS` did not match the verified sponsored payer.                 | The full paid result remains visible with check `query.readerPayment.actorClass=operator`.                                   |
| `reader-refund`                     | A required reader refund itself failed.                                                                                                                     | Current reader payment plus `priorFailure`, which names the original stage and message.                                      |
| `use-intent-signing`                | Intent preparation failed or a completion result lacked its digest.                                                                                         | Paid query and settlement evidence returned before the intent requirement failed.                                            |
| `use-intent-anchoring`              | Intent anchoring failed before creator routing began, or a completion result lacked `anchorTx`.                                                             | Paid reader-payment evidence and the prepared query, or the incomplete completion evidence.                                  |
| `pay-gate-settlement`               | PayGate preparation or submission failed. A reverted outer call rolls back its inner anchor and every creator payment; no PayGate ledger record is written. | Paid reader-payment evidence and the prepared query; prerequisite approval or split-creation transactions can already exist. |
| `fee-router-settlement`             | FeeRouter settlement failed while use-intent anchoring was disabled, or no returned receipt had `feeRouterPayTx`.                                           | Paid query, receipts, ledger, and any transaction evidence returned.                                                         |
| `fee-router-settlement-post-anchor` | The intent anchor confirmed, then FeeRouter routing failed. Because routing is sequential, zero or more creator payouts may have settled.                   | The query retains `useIntent.anchorTx`; completed partial payout evidence is not inferred when routing throws.               |
| `creator-balance`                   | The pre/post FeeRouter reads failed, the fixed pool was incomplete, or no routed creator had a verified positive claimable-balance delta.                   | Settled query and receipts plus the pre-settlement balances when the post-settlement read failed.                            |
| `client-transport`                  | The browser itself could not reach `/api/judge-demo`; this label is local to the panel.                                                                     | Browser error only, because no API body arrived.                                                                             |
| `complete`                          | The sponsored paid route returned success and all fourteen completion checks passed.                                                                        | Model, buy/skip decisions, claim support, refunds, intent, creator balance change, receipts, ledger, and Arc links.          |

If the API returns no stage, the judge route labels the sponsored boundary as
`sponsorship`; the panel states that no more precise stage was returned. A
reader refund is not assumed merely because a run failed: it is shown only when
`readerPayment.refund` is present. When refunding a prior failure also fails,
the panel renders both the current `reader-refund` stage and the returned
`priorFailure` stage/message.

## No-secret verifier

After the target deployment exposes `/api/judge-proof.json`, run:

```bash
npm run judge:verify -- --url https://target.example
```

For a local server:

```bash
npm run judge:verify -- --url http://localhost:3000
```

The command fetches `/api/judge-proof.json`, `/api/ledger`, and `/api/sources`;
recomputes the receipt hash chain and decision trace hashes; cross-checks proof
counts; verifies a settled reader payment and FeeRouter payout on Arc; checks
FeeRouter bytecode; and, when present, recomputes and verifies the EIP-712 use
intent and anchor receipt. For the latest paid WS8 query, it requires the
confirmed anchor to precede every FeeRouter payout by canonical block and
transaction index. For every PayGate record, it instead requires one successful
outer transaction whose calldata, Registry anchor event, `PaidWithIntent`
event, and complete FeeRouter `Routed` event multiset match the stored intent
and creator receipts. It reads each referenced FeeRouter split and matches its
recipient/BPS layout to the ledger wallet or contributor list. It also checks
the historical PayGate address's bytecode and immutable Registry, FeeRouter,
USDC, and authorized-payer wiring. It requires no API key, wallet, or signing
secret.

Any missing endpoint, count mismatch, tampered hash, absent bytecode, failed
receipt, signer mismatch, anchor mismatch, or invalid anchor/payout relationship
is a verifier failure.

## PayGate guarantee and boundary

When `LEPTONWEB_PAYGATE_ADDRESS` is unset, settlement keeps the deployed WS8
sequence: confirm the Registry anchor first, then submit FeeRouter payouts. When
it is set, the application records `useIntent.payGate: true`, the historical
PayGate address, and one transaction hash for the inner anchor and every routed
creator payment. Unsetting the variable restores WS8 without making old PayGate
records unverifiable.

PayGate enforces these properties for every call routed through it:

- the Registry accepts the same signed, unexpired, unused EIP-712 intent;
- the positive aggregate payment total does not exceed the intent's
  `maxSpendAtomicUsdc`;
- the anchor, USDC pull, and every FeeRouter call succeed or revert together;
- only the immutable authorized payer can submit through PayGate, preventing a
  third party from pairing a copied signature with attacker-selected PayGate
  payments.

The boundary is intentionally narrower than a global payment firewall. The
signed intent caps the total but does not commit to split IDs or per-split
amounts, so the authorized payer still chooses the recipient breakdown. The
authorized wallet can also call the permissionless FeeRouter directly or change
its allowances, and the intent signer can sign a higher cap. PayGate therefore
proves that a recorded PayGate transaction obeyed its signed cap; it does not
prove that a compromised signer or payer wallet could never bypass the gate.
The Registry's standalone `anchor()` remains permissionless: a third party that
sees a pending signature can submit that exact intent directly, consume its
nonce, and make the later PayGate call revert. This is a settlement
denial-of-service; it cannot redirect or overspend the authorized payer's funds.
First-use payer approval and split creation are prerequisite transactions, and
track-record publication may be a later transaction. If filtering leaves no
positive creator payout, the application uses the normal standalone WS8 anchor
because PayGate rejects an empty payment batch.

## Manual proof links

- Live application: `https://tollgate.gudman.xyz/`
- Live proof surface: `https://tollgate.gudman.xyz/proof`
- Arc explorer: `https://testnet.arcscan.app`
- Machine proof route after deployment: `/api/judge-proof.json`
- Full answer evidence after a run: `/answers/<queryId>`

See [POST_DEADLINE.md](POST_DEADLINE.md) for the verified remote/local boundary.
