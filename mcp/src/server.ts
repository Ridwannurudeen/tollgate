#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { tollgateAsk, tollgateSources } from "./tools.js";

export function createTollgateMcpServer() {
  const server = new McpServer({
    name: "tollgate-reader",
    version: "0.0.0",
  });

  server.registerTool(
    "tollgate_ask",
    {
      title: "Ask Tollgate",
      description:
        "Buy a source-backed Tollgate answer through the paid x402 endpoint. Requires TOLLGATE_READER_PRIVATE_KEY.",
      inputSchema: z.object({
        question: z.string().min(8).max(280),
      }),
    },
    async ({ question }) => {
      const result = await tollgateAsk(question);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                answer: result.answer,
                queryId: result.query.id,
                readerPayment: result.query.readerPayment ?? null,
                receipts: result.receipts.map((receipt) => ({
                  receiptHash: receipt.receiptHash,
                  sourceId: receipt.sourceId,
                  amountAtomicUsdc: receipt.amountAtomicUsdc,
                  settlementMode: receipt.settlementMode,
                })),
                proofUrls: result.proofUrls,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "tollgate_sources",
    {
      title: "List Tollgate Sources",
      description: "List the Tollgate source registry without paying.",
      inputSchema: z.object({}),
    },
    async () => {
      const sources = await tollgateSources();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ sources }, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

async function main() {
  const transport = new StdioServerTransport();
  await createTollgateMcpServer().connect(transport);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
