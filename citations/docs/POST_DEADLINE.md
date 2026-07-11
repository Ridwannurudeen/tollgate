# Post-deadline state

Verified from the local Git object database and `git ls-remote origin` on
2026-07-11. This file distinguishes the public remote, committed local roadmap
work, uncommitted WS5 work, and operator-only tasks.

## No submission tag is verified

No local tag is present, and the remote advertised no tag. There is therefore
no verified submission tag or tagged submission commit. Do not infer one from a
branch head, commit date, README statement, or deployment.

## Remote pre-roadmap baseline

`refs/heads/leptonweb-mvp` on `origin` resolves to:

| Commit    | Authored date               | Subject                                                            | Verified role                                                                                              |
| --------- | --------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `507abc7` | `2026-07-10T20:05:47+01:00` | `pay-per-piece: document prerequisites a stranger would hit blind` | Current remote branch head and merge base; pre-roadmap baseline. It is not identified as a submission tag. |

The public deployment also lacks the WS2 proof-pack route as of the same check:
`/api/judge-proof.json` returned HTTP 404.

## Committed local roadmap work

The local `leptonweb-mvp` branch is four commits ahead of the verified remote:

| Workstream | Commit    | Authored date               | Subject                                           |
| ---------- | --------- | --------------------------- | ------------------------------------------------- |
| WS1        | `baa8e3f` | `2026-07-11T21:24:52+01:00` | `citations: add judge-strict agent mode`          |
| WS2        | `da9a3ee` | `2026-07-11T21:35:47+01:00` | `citations: add no-secret judge proof verifier`   |
| WS3        | `8363c50` | `2026-07-11T21:49:55+01:00` | `citations: add proof of useful citation payouts` |
| WS4        | `3e67d4f` | `2026-07-11T22:07:44+01:00` | `citations: anchor signed use intents`            |

These commits are local history, not remote releases or proof of deployment.

## Local-uncommitted WS5

The current worktree contains WS5 presentation and measurement work that is not
committed or remote:

- the fixed benchmark corpus, runner, reproducible output artifacts, and
  `docs/BENCHMARK.md`;
- actor-class mapping and independent-versus-total dashboard presentation;
- the configuration-gated `/api/judge-demo` proxy and failure-path tests;
- custodial downstream-error preservation;
- the landing-page `JudgeDemoPanel` with the exact sponsor-funded disclaimer,
  partial-failure evidence, model/decision/claim/refund views, signed-intent
  evidence, and Arc transaction links;
- an evidence-completion gate that requires strict LLM provenance, the fixed
  five-source pool, buy/skip, supported literal-span claims, refunds, exact
  x402 operator payment, use intent, FeeRouter payout proof, and a positive
  creator claimable-balance delta before returning `stage: "complete"`;
- the README and judge-flow documentation in this presentation pass.

The worktree also contains concurrent uncommitted support changes outside this
document's implementation ownership. They must be reviewed as their own work;
this file does not relabel every dirty path as WS5.

## Operator tasks after local verification

These are deployment or publication actions, not local implementation work:

1. Review the complete dirty worktree, choose the intended commit boundaries,
   and push only after explicit approval.
2. Deploy the intended WS1–WS5 commit to the VPS and set
   `LEPTONWEB_DEPLOY_COMMIT` to that exact commit.
3. Configure `LEPTONWEB_AGENT_MODE=judge-strict`, the verifier model,
   contribution payouts, FeeRouter, and use-intent settings on the deployment.
4. Deploy or verify `UseReceiptRegistry` on Arc testnet and configure its
   address.
5. Fund and rate-limit the sponsored Circle W3S judge wallet; classify its
   payments as operator activity.
6. Refresh committed ledger evidence from the deployed strict path only after
   verifying integrity and transaction receipts.
7. Re-run `npm run judge:verify` against the deployed URL and capture a current
   screenshot/video only after it passes.
8. Set repository description/topics/website and create a submission-state tag
   only if explicitly approved. Until then, continue stating that no submission
   tag is verified.

No deploy, push, release, tag, submission, or video publication is performed by
this local WS5 pass.
