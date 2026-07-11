# Benchmark summary

Run mode: partial.
Fixed eval set: 50 questions.
Budget: 6500 atomic USDC.
Fixture: ws5-2026-07-11-v1 (0xe1e398e6814d5fb1f19c89d6bdb3f9d1f7c6b0801aed131514d45cb85bc44c48).
Intervals are deterministic 95% percentile bootstrap CIs from 10,000 question-level resamples.
Supported claims per $0.01 uses 10,000 atomic USDC per cent.

| strategy | arm | status | supported claims / $0.01 | unsupported-claim rate | unused-purchase rate | budget violation rate | abstention accuracy |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| random | deterministic-fixture | measured (50/50; 0 unavailable; 0 errors) | 4.8623 [4.0200, 5.6858] | 0.3467 [0.2467, 0.4467] | 0.7167 [0.6767, 0.7600] | 0.0000 [0.0000, 0.0000] | 0.8000 [0.6800, 0.9000] |
| cheapest-first | deterministic-fixture | measured (50/50; 0 unavailable; 0 errors) | 7.0349 [5.9757, 8.0407] | 0.4667 [0.4000, 0.5467] | 0.7333 [0.7000, 0.7733] | 0.0000 [0.0000, 0.0000] | 0.8000 [0.6800, 0.9000] |
| relevance-only | deterministic-fixture | measured (50/50; 0 unavailable; 0 errors) | 5.3338 [4.4723, 6.1709] | 0.1467 [0.0867, 0.2133] | 0.5733 [0.5000, 0.6400] | 0.0000 [0.0000, 0.0000] | 0.9600 [0.9000, 1.0000] |
| full-llm | live-llm | not-measured (0/50; 50 unavailable; 0 errors) | not measured | not measured | not measured | not measured | not measured |

The full-llm arm is a strict, live operator run. It remains not measured unless full-llm mode is explicitly selected and credentials are present; deterministic fixture execution is never reported under that label.
