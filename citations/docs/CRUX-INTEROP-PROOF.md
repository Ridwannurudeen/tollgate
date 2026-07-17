# Cross-project interop proof: an external autonomous paying agent buys a Tollgate source

Verified **2026-07-17** against **production** `https://tollgate.gudman.xyz` on Arc testnet chain `5042002`.

This demonstrates that an autonomous *paying* agent (the RFB-01 shape — e.g. Crux, a due-diligence
research agent that buys data sources under a USDC budget) can pay a Tollgate creator source (RFB-06)
using the standard Circle Gateway nanopayment path — with no bespoke integration. RFB-01 buying from
RFB-06 is, mechanically, an RFB-03 agent-to-agent nanopayment on Arc.

## How it was done

A buyer wallet with no server-side role paid a live Tollgate source endpoint using
`@circle-fin/x402-batching`'s `GatewayClient` — the same batching client an autonomous agent uses to
pay any x402 resource. Reproduce with:

```bash
NEXT_PUBLIC_ARC_RPC_URL=<arc-rpc> LEPTONWEB_BASE_URL=https://tollgate.gudman.xyz \
  node scripts/prove-gateway-source.mjs circle-gateway-nano
```

The buyer deposits USDC into Circle Gateway once, then `GatewayClient.pay(<sourceUrl>)` handles the
402 → sign → settle loop.

## What happened

- Target: `https://tollgate.gudman.xyz/api/sources/circle-gateway-nano`
- Payment: HTTP `200`, `settlementMode: "x402-settled"` — a real Gateway settlement, not verify-only
- Amount: `2400` atomic USDC (`0.0024 USDC`) routed to the source's creator ("Circle Developer Notes")
- Gateway transaction id: `a88c1f18-05d0-4c16-a252-bc124e6b1f8a`
- Buyer's Gateway available balance moved `19400 → 17000` atomic USDC (paid exactly `2400`)

## Independent verification (public, no auth)

The resulting receipt is served at:

```
GET https://tollgate.gudman.xyz/api/receipts/<receiptHash>
```

returning `settlementMode: "x402-settled"`, `amountAtomicUsdc: 2400`, `creator: "Circle Developer Notes"`,
`sourceId: "circle-gateway-nano"`, and the Gateway transaction id above. The receipt is part of the
hash-linked ledger surfaced at `https://tollgate.gudman.xyz/proof`.

## Integration note

Tollgate source endpoints advertise the **Gateway-batched** x402 accept (`@circle-fin/x402-batching`),
which is the path autonomous agents already use for Circle Gateway nanopayments. A raw EIP-3009
`exact`-scheme client is not the intended tool for these endpoints; point a `GatewayClient` at them.
