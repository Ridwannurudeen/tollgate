import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  readLedger: vi.fn(),
  readSources: vi.fn(),
  getCreatorEvidence: vi.fn(),
}));

vi.mock("@/lib/ledger", () => ({
  readLedger: mocks.readLedger,
  getCreatorEvidence: mocks.getCreatorEvidence,
}));

vi.mock("@/lib/catalog", () => ({
  readSources: mocks.readSources,
  publicSource: (source: Record<string, unknown>) => {
    const rest = { ...source };
    delete rest.notifyEmail;
    delete rest.walletId;
    return rest;
  },
}));

function context(wallet: string) {
  return {
    params: Promise.resolve({ wallet }),
  };
}

describe("GET /api/creators/[wallet]/summary", () => {
  beforeEach(() => {
    mocks.readLedger.mockReset();
    mocks.readSources.mockReset();
    mocks.getCreatorEvidence.mockReset();
  });

  it("returns earnings and public sources for a valid wallet", async () => {
    const wallet = "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03";
    mocks.readLedger.mockResolvedValue({ queries: [], receipts: [] });
    mocks.getCreatorEvidence.mockReturnValue({
      sourceCount: 1,
      citationCount: 2,
      earnedAtomicUsdc: 3100,
      sources: [
        {
          sourceId: "source-1",
          title: "Source One",
          creator: "Jane",
          wallet,
          citationCount: 2,
          earnedAtomicUsdc: 3100,
        },
      ],
    });
    mocks.readSources.mockResolvedValue([
      {
        id: "source-1",
        title: "Source One",
        creator: "Jane",
        handle: "@jane",
        wallet,
        url: "https://example.com/source",
        summary: "Paid source.",
        tags: ["ai"],
        priceAtomicUsdc: 1500,
        sourceKind: "external",
        creatorKind: "external",
        verifiedCreator: true,
        notifyEmail: "jane@example.com",
        walletId: "circle-wallet",
        ownershipProof: {
          method: "meta-tag",
          verifiedAt: "2026-07-06T00:00:00.000Z",
        },
      },
    ]);

    const response = await GET(new Request("http://test"), context(wallet));
    const body = (await response.json()) as {
      earnings: Record<string, unknown>;
      sources: Array<Record<string, unknown>>;
    };
    const payload = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
    expect(body.earnings).toEqual({
      sourceCount: 1,
      citationCount: 2,
      earnedAtomicUsdc: 3100,
    });
    expect(body.sources[0].title).toBe("Source One");
    expect(body.sources[0].citationCount).toBe(2);
    expect(body.sources[0].earnedAtomicUsdc).toBe(3100);
    expect(payload).not.toContain("jane@example.com");
    expect(payload).not.toContain("circle-wallet");
    expect(payload).not.toContain("ownershipProof");
  });

  it("returns zero earnings and empty sources for an unknown wallet", async () => {
    const wallet = "0x0000000000000000000000000000000000000001";
    mocks.readLedger.mockResolvedValue({ queries: [], receipts: [] });
    mocks.getCreatorEvidence.mockReturnValue(null);
    mocks.readSources.mockResolvedValue([]);

    const response = await GET(new Request("http://test"), context(wallet));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      wallet,
      earnings: {
        sourceCount: 0,
        citationCount: 0,
        earnedAtomicUsdc: 0,
      },
      sources: [],
    });
  });

  it("rejects malformed wallets", async () => {
    const response = await GET(new Request("http://test"), context("bad"));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid wallet");
    expect(mocks.readLedger).not.toHaveBeenCalled();
  });

  it("matches stored source wallets case-insensitively", async () => {
    const requestWallet = "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03";
    mocks.readLedger.mockResolvedValue({ queries: [], receipts: [] });
    mocks.getCreatorEvidence.mockReturnValue(null);
    mocks.readSources.mockResolvedValue([
      {
        id: "source-1",
        title: "Lowercase Source",
        creator: "Jane",
        handle: "@jane",
        wallet: requestWallet.toLowerCase(),
        url: "https://example.com/source",
        summary: "Paid source.",
        tags: ["ai"],
        priceAtomicUsdc: 1500,
        sourceKind: "external",
        creatorKind: "external",
        verifiedCreator: false,
      },
    ]);

    const response = await GET(
      new Request("http://test"),
      context(requestWallet),
    );
    const body = (await response.json()) as {
      sources: Array<{ title: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].title).toBe("Lowercase Source");
  });
});
