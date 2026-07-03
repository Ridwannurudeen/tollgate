# Tollgate Reader MCP

Stdio MCP server that turns any MCP-capable agent into a paid Tollgate reader.

Default production endpoint: `https://tollgate.gudman.xyz`.

## Tools

- `tollgate_ask({ question })`: asks Tollgate and returns the answer, receipt summaries, and proof URLs.
- `tollgate_sources()`: reads the free source registry.

`tollgate_ask` requires `TOLLGATE_READER_PRIVATE_KEY` and calls `/api/paid-query` through x402. `tollgate_sources` is free.

## Install

```bash
npm install -g tollgate-reader-mcp
```

For local development from this repo:

```bash
cd mcp
npm install
npm run build
node dist/server.js
```

## Claude Code

```bash
claude mcp add tollgate \
  --env TOLLGATE_BASE_URL=https://tollgate.gudman.xyz \
  --env TOLLGATE_READER_PRIVATE_KEY=0x... \
  -- npx -y tollgate-reader-mcp
```

## Claude Desktop

```json
{
  "mcpServers": {
    "tollgate": {
      "command": "npx",
      "args": ["-y", "tollgate-reader-mcp"],
      "env": {
        "TOLLGATE_BASE_URL": "https://tollgate.gudman.xyz",
        "TOLLGATE_READER_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## Cursor

Add this to your Cursor MCP config:

```json
{
  "mcpServers": {
    "tollgate": {
      "command": "npx",
      "args": ["-y", "tollgate-reader-mcp"],
      "env": {
        "TOLLGATE_BASE_URL": "https://tollgate.gudman.xyz",
        "TOLLGATE_READER_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## Funding

Use an Arc testnet wallet funded with USDC gas/token balance. Faucet: `https://faucet.circle.com`.

## Publish Name Check

Checked 2026-07-03:

- `npm view @tollgate/mcp` -> E404, unclaimed/unauthorized scoped name.
- `npm view tollgate-mcp` -> published as `1.1.5`, unavailable.
- `npm view tollgate-reader-mcp` -> E404, selected for publish prep.

This package is prepared for npm but not published. Publishing is user-gated.

## Live Proof

Verified 2026-07-03 with the DPAPI `demo-payer` wallet through the MCP `tollgate_ask` tool:

- queryId: `0x0d5e3731a00083a7`
- reader payment: `10000` atomic USDC, `x402-verified`
- payment hash: `0xcbed001c...`
- receipts: `3`, routed to cited creators
- proof URL: `https://tollgate.gudman.xyz/answers/0x0d5e3731a00083a7`
