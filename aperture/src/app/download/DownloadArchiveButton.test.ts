import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("DownloadArchiveButton payment wiring", () => {
  it("uses the x402 wallet fetch for live archive purchases", async () => {
    const source = await readFile(
      new URL("./DownloadArchiveButton.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("connectArcWallet");
    expect(source).toContain("makePaidFetch");
    expect(source).toContain("await paidFetch(");
  });
});
