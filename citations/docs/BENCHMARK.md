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
2026-07-12 with `LEPTONWEB_LLM_MODEL=claude-haiku-4-5-20251001`. The live arm
measured 35 of 50 cases; the other 15 are recorded as errors (the strict
planner rejected malformed model JSON and judge-strict mode rethrows instead
of falling back — those cases are excluded from the live arm's means, never
replayed deterministically).

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
- `full-llm`: strict live planner and verifier; operator-required. Measured
  2026-07-12 (35/50 cases, 15 strict-mode errors).

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
| full-llm       | strict live LLM       | mixed 35/50 (15 errors)    | 17.3451 [11.5812, 23.4340] | 0.2355 [0.1511, 0.3218] | 0.0714 [0.0143, 0.1286] | 0.0000 [0.0000, 0.0000] | 1.0000 [1.0000, 1.0000] |

On the cases it completed, the strict live agent produced roughly 3.3x more
supported claims per $0.01 than the deterministic relevance-only policy
(17.35 vs 5.33) and cut the unused-purchase rate from 57% to 7%, with perfect
abstention. Its unsupported-claim rate (0.2355) sits between relevance-only
(0.1467) and the naive policies. The 15 error cases are visible in
`bench/results/benchmark.jsonl` with the exact strict-mode failure message.

These measurements describe this fixed seed-and-synthetic fixture and the
named model only. The live arm's error cases are excluded from its means, so
its intervals describe completed runs, not overall reliability; they must not
be presented as general model performance.
