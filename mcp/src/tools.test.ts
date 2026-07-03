import { describe, expect, it, vi } from "vitest";
import { tollgateSources } from "./tools.js";

describe("tollgate MCP tools", () => {
  it("summarizes the free source registry", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sources: [
            {
              id: "source-1",
              title: "Source One",
              creator: "Creator",
              wallet: "0x1111111111111111111111111111111111111111",
              priceAtomicUsdc: 1500,
              verifiedCreator: true,
              probation: false,
              url: "https://example.com/source",
              notifyEmail: "private@example.com",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(tollgateSources(fetcher)).resolves.toEqual([
      {
        id: "source-1",
        title: "Source One",
        creator: "Creator",
        wallet: "0x1111111111111111111111111111111111111111",
        priceAtomicUsdc: 1500,
        verifiedCreator: true,
        probation: false,
        url: "https://example.com/source",
      },
    ]);
  });

  it("rejects malformed registry responses", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));

    await expect(tollgateSources(fetcher)).rejects.toThrow("missing sources");
  });
});
