import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCitationsSummary } from "./citations-summary";

describe("fetchCitationsSummary", () => {
  const savedBaseUrl = process.env.CITATIONS_BASE_URL;

  beforeEach(() => {
    process.env.CITATIONS_BASE_URL = "https://citations.example";
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    if (savedBaseUrl === undefined) {
      delete process.env.CITATIONS_BASE_URL;
    } else {
      process.env.CITATIONS_BASE_URL = savedBaseUrl;
    }
    vi.unstubAllGlobals();
  });

  it("parses a successful creator summary", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        earnings: {
          sourceCount: 1,
          citationCount: 2,
          earnedAtomicUsdc: 3000,
        },
        sources: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const summary = await fetchCitationsSummary(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    expect(summary?.earnings.earnedAtomicUsdc).toBe(3000);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://citations.example/api/creators/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/summary",
      { cache: "no-store" },
    );
  });

  it("returns null for non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 500 })),
    );

    await expect(
      fetchCitationsSummary("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).resolves.toBeNull();
  });

  it("returns null for network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    await expect(
      fetchCitationsSummary("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).resolves.toBeNull();
  });
});
