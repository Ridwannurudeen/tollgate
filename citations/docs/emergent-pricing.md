# Emergent Pricing Notes

Tollgate's current pricing surface is a small live sample, not a final market model. It is enough to show the useful mechanism: agents can buy the minimum useful citation bundle, creators can price source access in atomic USDC, and every answer can expose who earned what.

## Current Sample

As of June 23, 2026, the local ledger has:

- 19 answer events.
- 45 citation receipts.
- 81,000 atomic USDC routed across citation receipts.
- 1,800 atomic USDC average citation price.
- 1,700 atomic USDC median citation price.
- 900 atomic USDC minimum citation price.
- 2,400 atomic USDC maximum citation price.

Settlement modes in the same ledger:

- 36 `local-proof` receipts.
- 4 `x402-verified` receipts.
- 2 `x402-settled` receipts.
- 3 `forum-routed` receipts.

## Source Demand

The current top earning sources are:

| Source | Creator | Citations | Earned atomic USDC |
|---|---:|---:|---:|
| Gateway Nanopayments Primer | Circle Developer Notes | 12 | 28,800 |
| LeptonWeb Build Log | LeptonWeb Lab | 10 | 17,000 |
| Lepton RFB Notes | Canteen Research | 9 | 16,200 |
| Citation Economics for AI Answers | Indie Researcher | 7 | 8,400 |
| Covenant Account Spend Controls | Forum Protocol | 5 | 7,500 |

This is the first pricing signal: source usage is not flat. The agent repeatedly buys the source that best matches the question and budget, so the source leaderboard becomes a real demand graph.

## Clearing Price Hypothesis

The current median useful citation clears around 1,800 atomic USDC. That is not a universal price; it is the current equilibrium for this source inventory and question mix.

The next experiment is to let creators publish multiple price points:

- cheap summary access,
- full article access,
- premium evidence bundle,
- live API or feed access.

Then the demand engine can run the same question set against different source prices and measure:

- which sources are still selected,
- which sources are skipped,
- how answer quality changes,
- how much total creator revenue moves.

## Demand Engine

`npm run run:demand-engine` defaults to dry-run mode and prints the planned questions and spend cap.

Actual volume requires:

```bash
DEMAND_ENGINE_EXECUTE=1 npm run run:demand-engine
```

The default cap is 15,000 atomic USDC across 3 questions. This guard exists so a live demo can create demand without silently producing unlimited ledger events.

## Why This Matters

Search ranks content by attention. Tollgate ranks source reuse by paid demand.

That gives creators a direct signal:

- if agents cite the source, the creator gets paid;
- if a source is too expensive for its utility, the agent skips it;
- if a source is highly useful, repeated citations make that visible;
- if the answer is disputed, Forum TrackRecord and SlashBond make the agent accountable.

The research claim for the hackathon is simple: the first sustainable AI knowledge market probably looks less like subscription SaaS and more like tiny, accountable, source-level payments.
