# Tollgate MCP Server

Unpublished stdio MCP server that turns any MCP-capable agent into a Tollgate reader.

## Tools

- `tollgate_ask({ question })`: asks Tollgate and returns the answer, receipt summaries, and proof URLs.
- `tollgate_sources()`: reads the free source registry.

By default this handoff build calls the local-proof `/api/query` endpoint. A paid x402 adapter can be wired later through the SDK's `paidFetch` surface; this package does not fake paid settlement.

## Local Run

```bash
cd sdk
npm install
npm run build

cd ../mcp
npm install
npm run build
TOLLGATE_BASE_URL=http://127.0.0.1:3000 node dist/server.js
```

## Claude Desktop / Claude Code Config

```json
{
  "mcpServers": {
    "tollgate": {
      "command": "node",
      "args": ["C:/Users/gudma/OneDrive/Desktop/GITHUB-FILES/leptonweb/mcp/dist/server.js"],
      "env": {
        "TOLLGATE_BASE_URL": "http://127.0.0.1:3000"
      }
    }
  }
}
```

Run Tollgate locally from `citations/` before using the server.
