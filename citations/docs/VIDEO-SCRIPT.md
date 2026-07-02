# Tollgate - <3 min demo video script

**Format:** screen recording + voiceover. Target 2:45. Lead with the creator problem, not crypto. Show live product and proof pages, not slides.
**Tabs to pre-open:** `tollgate.gudman.xyz`, `tollgate.gudman.xyz/answers/0xe7c1a7397fdbb323`, `tollgate.gudman.xyz/creators/0x5389688243328c26a92b301faEEAb5fbf9AFf105`, `tollgate.gudman.xyz/aperture`, `peertube-plugin-tollgate/README.md`, `testnet.arcscan.app`.

---

### 0:00-0:15 - The problem
**Show:** a creator article, a photo, and a video download surface.
**Say:** "Creators do not get paid for how their work is actually used. A writer earns nothing when an AI cites their article. A photographer earns nothing when someone downloads their photo. A video creator earns nothing when a bot pulls their file. The payment was always too small to collect, so the default became subscriptions or nothing."

### 0:15-0:35 - The redesigned homepage
**Show:** `tollgate.gudman.xyz` hero, the "Register your work" CTA, the creator-first navigation, dollar-formatted stats, and the Live stat card for citation payments made and verifiable on-chain.
**Say:** "Tollgate turns that tiny unit of use into a real market. A creator can register work, a reader can buy an answer, and the page shows live citation payments that are already verifiable on Arc."

### 0:35-1:15 - Paid answer + agent trace
**Show:** ask a paid question live if safe. If not, open `tollgate.gudman.xyz/answers/0xe7c1a7397fdbb323`, the answer that cites qdee, CitePay, and Rising Technology.
**Say:** "Here is the core product: an autonomous answer agent. It appraises candidate sources, allocates a tiny budget, buys the sources it needs, drafts the answer, critiques unsupported claims, and reflects before finalizing."
**Show:** the appraise -> allocate -> draft -> critique -> reflect trace, then the reader-payment and receipt evidence.
**Say:** "The answer is not just text. It is bound to the sources it paid for, the reader payment, and the creator payout receipts."

### 1:15-1:50 - Traction: external creators paid
**Show:** `/creators/0x5389688243328c26a92b301faEEAb5fbf9AFf105`, then one Arcscan transaction such as `0xa03809...748e6` or `0xc5074b...16509f`.
**Say:** "The traction story is not seed data. Three independent external creators onboarded through a markdown guide their own agents could execute: CitePay Markets, qdee, and Rising Technology. They registered verified sources, got cited by the live agent, got paid in USDC on-chain, and two of them claimed balances unaided."
**Show:** creator cards or proof rows for CitePay, qdee, and Rising Technology.
**Say:** "That is the differentiator: creators are already getting paid, and the next step is turning those same external teams into paying readers."

### 1:50-2:20 - Three integrations, one settlement core
**Show:** `tollgate.gudman.xyz/aperture` proof surface, then `peertube-plugin-tollgate/README.md` and the PeerTube payout proof tx `0x1448f4...bf19`.
**Say:** "The same settlement core attaches to three real creator communities. Citations pays writers when an AI answer cites them. Aperture pays photographers when shared Immich photos are downloaded. The PeerTube plugin pays video creators per download, with the payout proven on Arc."
**Show:** `/core` or proof cards tying x402, Gateway, USDC, and FeeRouter together.
**Say:** "One rail, three surfaces: feeds, photos, and video."

### 2:20-2:45 - Close
**Show:** settlement status, FeeRouter address, one Arcscan success page, then the live URL.
**Say:** "Under the hood, Tollgate uses x402 for per-request payment, Circle Gateway for gas-free batched settlement, USDC on Arc, and FeeRouter contracts to split every creator payment by the fraction. Tiny reuse becomes a real payment, and every claim is provable on-chain."

---

## Capture checklist
- Keep the final cut under 2:45.
- Do one live action on camera if possible: a paid question, an Aperture download proof, or a PeerTube plugin payout proof walkthrough.
- If the live query is risky, use `tollgate.gudman.xyz/answers/0xe7c1a7397fdbb323`.
- Show at least one external creator page and one Arcscan success transaction.
- Keep crypto jargon to the final settlement segment; before that, speak in creator/user language.
