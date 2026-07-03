# Tollgate Discovery Spec

Tollgate discovery lets any publisher declare that a URL can be paid and cited by AI readers.

## Well-Known Declaration

Publish at:

```text
/.well-known/tollgate.json
```

Shape:

```json
{
  "version": "1",
  "wallet": "0x7777777777777777777777777777777777777777",
  "defaultPriceAtomicUsdc": 1500,
  "sources": [
    {
      "url": "https://publisher.example/research",
      "priceAtomicUsdc": 2200,
      "title": "Research note",
      "summary": "Short description used for source selection.",
      "tags": ["agents", "payments"]
    }
  ]
}
```

Rules:

- `wallet` is a 20-byte EVM address.
- Prices are integer atomic USDC units, 6 decimals.
- `sources[].url` may be relative to the publisher origin.
- If `sources` is omitted or empty, the publisher URL itself is the source.
- Discovered sources start unverified and on probation until ownership verification clears them.

## Meta-Tag Declaration

For a single page, publishers may add:

```html
<meta name="tollgate" content="wallet=0x7777777777777777777777777777777777777777; price=1500">
```

The crawler treats the page URL as the declared source.

## Crawler

Dry run:

```bash
node scripts/discover-sources.mjs https://publisher.example
```

Write to the local Citations registry:

```bash
node scripts/discover-sources.mjs --write https://publisher.example
```

Local/private fixture sites require:

```bash
node scripts/discover-sources.mjs --allow-local http://127.0.0.1:8080
```

The crawler deduplicates by normalized host/path URL and slugified title before writing.
