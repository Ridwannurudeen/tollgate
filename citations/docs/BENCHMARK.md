# Citation decision benchmark

## Reproduce the deterministic run

Run the default offline mode:

    npm run bench

This mode does not load LLM credentials or call the network. It measures the
three deterministic arms and records `full-llm` as unavailable. The runner
writes stable artifacts to:

- `bench/results/benchmark.jsonl`
- `bench/results/summary.json`
- `bench/results/summary.md`

The generated partial artifact contains 150 measured deterministic rows and
50 unmeasured live-arm rows: four policy rows for each of 50 questions.
`npm run bench -- --mode partial` is the equivalent explicit command.

## Operator-required live arm

The live arm is intentionally separate:

    npm run bench -- --mode full-llm

`full-llm` uses `createAgentQueryRecord` with `strictMode: true` and
`serverMode: "judge-strict"`, then uses live model calls for claim extraction
and verification. It requires `LEPTONWEB_LLM_API_KEY` and
`LEPTONWEB_LLM_MODEL`, can incur provider cost, and can access the configured
LLM endpoint and any production external-assist endpoint the agent selects.
Without credentials its 50 rows are marked unavailable. A live planner or
verifier failure is recorded as an error, never replaced by deterministic
replay.

The results below are from a full-llm run executed on the production host on
2026-07-12 with `LEPTONWEB_LLM_MODEL=claude-haiku-4-5-20251001`, after adding
a bounded one-shot repair retry for malformed model JSON (WS6): on a parse
failure, the planner is given the invalid response back plus an explicit
"return ONLY valid JSON" instruction and asked once more before the case is
recorded as an error. This run measured 50 of 50 cases with 0 errors — the
earlier same-day run before WS6 (also captured in this repo's history) missed
15 of 50 cases to malformed JSON with no retry.

## Fixture and method

The eval set has exactly 50 fixed questions: 40 source-covered questions and
10 questions where buying nothing is correct. Candidate pools mix gold,
duplicate, cheap-junk, expensive-good, unverified, and irrelevant roles.

The source corpus is a literal deep-frozen snapshot in
`bench/source-fixtures.ts`, not an import from the mutable runtime catalog.
The frozen snapshot is `ws5-2026-07-11-v1` with hash
`0xe1e398e6814d5fb1f19c89d6bdb3f9d1f7c6b0801aed131514d45cb85bc44c48`.
Every JSONL row includes the complete candidate set, each candidate's role,
frozen source fixture, synthetic provenance, price, verification state, and
selection state.

The deterministic arms use fixture-known claims and spans through the same
WS3 `extractClaims` and `verifyClaims` literal-span validation path. This is a
reproducible policy benchmark, not evidence of live model quality.

Strategies:

- `random`: seeded random ordering under the 6,500 atomic-USDC source budget.
- `cheapest-first`: lowest priced candidates under the same budget.
- `relevance-only`: the existing deterministic `planCitationMarket` policy.
- `full-llm`: strict live planner and verifier, with a bounded one-shot JSON
  repair retry (WS6). Measured 2026-07-12 (50/50 cases, 0 errors).

Metrics:

- Supported claims per $0.01 divides supported claims by spend in 10,000
  atomic-USDC units.
- Unsupported-claim rate is unsupported claims divided by all extracted
  claims.
- Unused-purchase rate is the share of selected sources supporting no verified
  claim; these are refund candidates in the contribution flow.
- Budget violations exceed three sources or 6,500 atomic USDC.
- Abstention is correct when a no-source case buys nothing, or a covered case
  produces at least one supported claim.

Intervals are deterministic 95% percentile bootstrap confidence intervals
from 10,000 seeded question-level resamples.

## Measured results

| strategy       | arm                   | status                     | supported claims / $0.01 |  unsupported-claim rate |    unused-purchase rate |   budget violation rate |     abstention accuracy |
| -------------- | --------------------- | -------------------------- | -----------------------: | ----------------------: | ----------------------: | ----------------------: | ----------------------: |
| random         | deterministic fixture | measured 50/50             |  4.8623 [4.0200, 5.6858] | 0.3467 [0.2467, 0.4467] | 0.7167 [0.6767, 0.7600] | 0.0000 [0.0000, 0.0000] | 0.8000 [0.6800, 0.9000] |
| cheapest-first | deterministic fixture | measured 50/50             |  7.0349 [5.9757, 8.0407] | 0.4667 [0.4000, 0.5467] | 0.7333 [0.7000, 0.7733] | 0.0000 [0.0000, 0.0000] | 0.8000 [0.6800, 0.9000] |
| relevance-only | deterministic fixture | measured 50/50             |  5.3338 [4.4723, 6.1709] | 0.1467 [0.0867, 0.2133] | 0.5733 [0.5000, 0.6400] | 0.0000 [0.0000, 0.0000] | 0.9600 [0.9000, 1.0000] |
| full-llm       | strict live LLM (+repair retry) | measured 50/50 (0 errors) | 19.2327 [14.3510, 24.4914] | 0.2754 [0.2063, 0.3454] | 0.1500 [0.0900, 0.2200] | 0.0000 [0.0000, 0.0000] | 1.0000 [1.0000, 1.0000] |

With WS6's repair retry, the strict live agent now completes all 50 cases:
roughly 3.6x more supported claims per $0.01 than the deterministic
relevance-only policy (19.23 vs 5.33), an unused-purchase rate of 15%
(still well below relevance-only's 57%, though higher than the 7% seen on
the smaller 35-case sample before this run), and perfect abstention. Its
unsupported-claim rate (0.2754) is higher than relevance-only's (0.1467) —
the strict agent is more economically selective, not yet more reliably
grounded on every claim. The previously-uncompleted 15 cases are included in
this run's 50/50 and are visible with their per-case decisions in
`bench/results/benchmark.jsonl`.

These measurements describe this fixed seed-and-synthetic fixture and the
named model only; they must not be presented as general model performance.
