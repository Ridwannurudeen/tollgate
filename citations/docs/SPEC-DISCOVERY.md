# Tollgate Discovery Declaration

Tollgate can discover creator-owned sources from either a JSON declaration at
`/.well-known/tollgate.json` or a homepage meta tag.

Discovery only registers sources. New sources stay probationary until the owner
verifies them from the source page with a meta tag, DNS TXT record, or wallet
signature.

## tollgate.json

Serve this file at `https://your-site.example/.well-known/tollgate.json`:

```json
{
  "version": "1",
  "wallet": "0x7777777777777777777777777777777777777777",
  "defaultPriceAtomicUsdc": 1500,
  "sources": [
    {
      "url": "https://your-site.example/research/agent-payments",
      "priceAtomicUsdc": 2200,
      "title": "Agent Payments, Explained",
      "summary": "A practical guide to x402, citations, and USDC payouts.",
      "tags": ["agents", "payments", "x402"]
    }
  ]
}
```

Fields:

- `version`: must be `"1"`.
- `wallet`: EVM wallet that receives payouts.
- `defaultPriceAtomicUsdc`: fallback price per citation in atomic USDC.
- `sources`: list of source URLs. Relative URLs are resolved against your site.
- `priceAtomicUsdc`: optional per-source override.
- `title`, `summary`, `tags`: optional metadata that helps the answer agent
  decide when to cite the source.

## Meta Tag

For a single-page declaration, add this tag to your page:

```html
<meta
  name="tollgate"
  content="wallet=0x7777777777777777777777777777777777777777; price=1500"
/>
```

The `wallet` value must be a 20-byte EVM address. The `price` value is atomic
USDC, so `1500` means `$0.0015` per citation.

## Register

Paste your site URL into the discovery form on `/register`. Tollgate first
checks `/.well-known/tollgate.json`; if it is not found, it checks the homepage
for the meta tag.
