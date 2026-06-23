# Tollgate — Creator Onboarding

Tollgate is an AI answer engine that **pays creators when their work is cited.** You register a source (one piece of your content) once. From then on, whenever Tollgate's agent uses it to answer a question, it pays your wallet in USDC on Arc, and writes an on-chain receipt proving the citation.

This guide is written so a person *or their AI agent* can complete onboarding end to end. There are two parts: **(1) Register your source** and **(2) Claim your earnings.**

---

## 0. What you need

- **An Arc testnet wallet you control the private key for** (you'll need the key to claim earnings). An EVM address: `0x` + 40 hex chars.
- **One real link to your content** — a blog post, article, video, repo, podcast episode, profile, etc. It must be a real, reachable `https://` (or `http://`) URL. Your work has to exist somewhere; that's what gets cited and paid for.
- That's it. No website, no RSS feed, no signup required.

**Network facts (Arc testnet):**
| | |
|---|---|
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| USDC token | `0x3600000000000000000000000000000000000000` (6 decimals) |
| FeeRouter (pays creators) | `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59` |
| Explorer | `https://testnet.arcscan.app` |
| Tollgate base URL | `https://tollgate.gudman.xyz` |

> Amounts are in **atomic USDC** (6 decimals): `1000000` = $1.00, `1000` = $0.001, `1` = $0.000001. Prices this small are the whole point — Tollgate settles per-citation nanopayments.

---

## 1. Register your source

Send one HTTP `POST` to `https://tollgate.gudman.xyz/api/sources` with a JSON body. No auth is required on testnet.

### Fields

| Field | Required | Rules (validated server-side) |
|---|---|---|
| `creator` | yes | Your display name. ≤ 72 chars. |
| `handle` | yes | Your handle. ≤ 48 chars. A leading `@` is added if you omit it. |
| `wallet` | yes | Your Arc address. Must match `0x` + 40 hex chars. **This is where you get paid — use an address you hold the key to.** |
| `url` | yes | A link to one real piece of your content. Must be a valid `http`/`https` URL. ≤ 260 chars. |
| `title` | yes | Title of the piece. ≤ 96 chars. |
| `summary` | yes | One line on what it covers (helps the agent decide when to cite it). ≤ 340 chars. |
| `tags` | recommended | Topics, as an array or comma-separated string. Each tag is lowercased and stripped to `a-z 0-9 -`, must be ≥ 2 chars; up to 8 tags. |
| `priceAtomicUsdc` | recommended | Integer, `1` … `1000000`. Your price per citation in atomic USDC. A reasonable start is `800`–`2400` ($0.0008–$0.0024). Defaults are applied if omitted. |
| `id` | optional | A slug. If omitted, it's derived from `title`. Must be unique. |

### curl

```bash
curl -sS -X POST "https://tollgate.gudman.xyz/api/sources" \
  -H "Content-Type: application/json" \
  -d '{
    "creator": "Ada Rivera",
    "handle": "@adawrites",
    "wallet": "0xYourArcAddress0000000000000000000000000",
    "url": "https://adawrites.substack.com/p/agent-payments-explained",
    "title": "Agent Payments, Explained",
    "summary": "A plain-English walkthrough of how autonomous agents pay per API call and per citation.",
    "tags": ["agents", "payments", "x402"],
    "priceAtomicUsdc": 1500
  }'
```

### JavaScript (for an agent)

```js
const res = await fetch("https://tollgate.gudman.xyz/api/sources", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    creator: "Ada Rivera",
    handle: "@adawrites",
    wallet: "0xYourArcAddress0000000000000000000000000",
    url: "https://adawrites.substack.com/p/agent-payments-explained",
    title: "Agent Payments, Explained",
    summary: "A plain-English walkthrough of how autonomous agents pay per API call and per citation.",
    tags: ["agents", "payments", "x402"],
    priceAtomicUsdc: 1500,
  }),
});
const data = await res.json();
console.log(res.status, data);
```

### Responses
- **`201 Created`** → `{ "source": {…}, "sources": [...] }`. Registration succeeded; `source.id` is your source id — save it.
- **`409 Conflict`** → `{ "error": "source id already exists." }`. Pick a different `id` (or `title`).
- **`400 Bad Request`** → `{ "error": "<reason>" }`. A field failed validation; fix it and retry (e.g. wallet not 40-hex, url not http/https, summary too long).

### Confirm you're live in the market

```bash
curl -sS "https://tollgate.gudman.xyz/api/sources" | grep -o "\"id\":\"your-source-id\""
```
Or open `https://tollgate.gudman.xyz/sources/<your-source-id>` in a browser.

You can register more than one source — repeat with different `url`/`title`.

---

## 2. How (and when) you get paid

1. A user asks Tollgate a question.
2. The agent ranks the available sources on relevance and its budget, and **buys the ones it cites.** Higher relevance + a fair price = more likely to be cited.
3. For each citation, Tollgate calls `pay()` on the FeeRouter (`0xeff9…bf59`) on Arc, allocating your price to your wallet. A receipt and an on-chain attribution record are written.
4. Your earnings accumulate in the FeeRouter as **claimable** USDC until you withdraw them.

**There is nothing you need to do to receive citations** — just be registered with a clear `summary` and `tags`. Payment only happens when your work is actually cited (no citation, no charge — this is honest, usage-based monetization).

### Check your earnings
- Browser: `https://tollgate.gudman.xyz/creators/<your-wallet>` and `https://tollgate.gudman.xyz/sources/<your-source-id>`.
- On-chain (read-only), `totalClaimableOf(yourWallet)` on the FeeRouter:

```bash
# cast (Foundry). Returns your claimable balance in atomic USDC.
cast call 0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59 \
  "totalClaimableOf(address)(uint256)" 0xYourArcAddress... \
  --rpc-url https://rpc.testnet.arc.network
```

### Claim (withdraw) your earnings
Payouts use a **pull pattern**: you withdraw by calling `claim()` on the FeeRouter from your own wallet. `claim()` takes no arguments and sweeps everything claimable across all splits to you.

```bash
# Requires the private key for your creator wallet.
# Your wallet needs a tiny USDC balance for gas (Arc gas is paid in USDC).
cast send 0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59 \
  "claim()(uint256)" \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key $YOUR_CREATOR_KEY
```

Verify the resulting transaction on `https://testnet.arcscan.app`.

> Need testnet USDC for gas? The hackathon's faucet is **TestMint** (`https://testmint.myproceeds.xyz`). A few cents of USDC covers many claims.

---

## 3. Tips for getting cited

- Write a **specific, keyword-rich `summary`** — it's what the agent matches against questions.
- Use **accurate `tags`** for your topic.
- Price **fairly**: the agent enforces a per-answer budget and skips overpriced or low-relevance sources. Sub-cent prices (a few hundred to a couple thousand atomic USDC) get bought most often.
- Register your **best, most-citable** work — explainers, references, and data hold up better than ephemeral posts.

---

## Quick checklist
- [ ] Arc wallet ready (you hold the private key)
- [ ] One real `https://` content link
- [ ] `POST /api/sources` returned `201`
- [ ] Source visible at `/sources/<id>`
- [ ] (Later) check `/creators/<wallet>`, then `claim()` to withdraw

Questions or a failed registration? Send the `error` message you got back — it names the exact field to fix.
