import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  buildWordPressProof: vi.fn(),
}));

vi.mock("@/lib/wordpress", () => ({
  buildWordPressProof: mocks.buildWordPressProof,
}));

describe("GET /api/wordpress/proof", () => {
  it("returns the public WordPress proof feed", async () => {
    mocks.buildWordPressProof.mockResolvedValue({
      project: "tollgate-wordpress",
      ledger: { valid: true, wordpressReceiptCount: 1 },
      receipts: [{ receiptHash: "0xreceipt" }],
      queries: [{ id: "wordpress:wp_site:42:reader" }],
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.project).toBe("tollgate-wordpress");
    expect(body.ledger.valid).toBe(true);
    expect(body.receipts).toHaveLength(1);
  });
});
