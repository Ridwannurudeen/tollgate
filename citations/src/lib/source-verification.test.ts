import { describe, expect, it } from "vitest";
import {
  verificationToken,
  verifyDnsTxtSource,
  verifyMetaTagSource,
} from "./source-verification";
import type { CreatorSource } from "./types";

const source: CreatorSource = {
  id: "verified-web-source",
  title: "Verified Web Source",
  creator: "Verifier",
  handle: "@verifier",
  wallet: "0x1111111111111111111111111111111111111111",
  url: "https://example.com/verified",
  summary: "A source verified through meta tag or DNS.",
  tags: ["verification"],
  priceAtomicUsdc: 1000,
  sourceKind: "external",
  creatorKind: "external",
  verifiedCreator: false,
};

describe("wallet-free source verification", () => {
  it("accepts a matching meta tag", async () => {
    const previous = process.env.TOLLGATE_VERIFY_SECRET;
    process.env.TOLLGATE_VERIFY_SECRET = "secret";
    const token = verificationToken(source.id);

    try {
      const proof = await verifyMetaTagSource(source, async () => {
        return new Response(
          `<html><head><meta name="tollgate-verification" content="${token}"></head></html>`,
          { status: 200 },
        );
      });

      expect(proof.method).toBe("meta-tag");
      expect(proof.signatureHash).toMatch(/^0x[0-9a-f]{64}$/);
    } finally {
      if (previous === undefined) {
        delete process.env.TOLLGATE_VERIFY_SECRET;
      } else {
        process.env.TOLLGATE_VERIFY_SECRET = previous;
      }
    }
  });

  it("accepts a matching DNS TXT record", async () => {
    const previous = process.env.TOLLGATE_VERIFY_SECRET;
    process.env.TOLLGATE_VERIFY_SECRET = "secret";
    const token = verificationToken(source.id);

    try {
      const proof = await verifyDnsTxtSource(source, async () => [
        [`tollgate-verify=${token}`],
      ]);

      expect(proof.method).toBe("dns-txt");
    } finally {
      if (previous === undefined) {
        delete process.env.TOLLGATE_VERIFY_SECRET;
      } else {
        process.env.TOLLGATE_VERIFY_SECRET = previous;
      }
    }
  });
});
