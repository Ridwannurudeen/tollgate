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
      const proof = await verifyMetaTagSource(source, {
        fetchImpl: async () =>
          new Response(
            `<html><head><meta name="tollgate-verification" content="${token}"></head></html>`,
            { status: 200 },
          ),
        resolveHost: async () => ["93.184.216.34"],
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

  it("keeps private-host verification blocked unless the local E2E flag is enabled", async () => {
    const previousSecret = process.env.TOLLGATE_VERIFY_SECRET;
    const previousAllow = process.env.TOLLGATE_VERIFY_ALLOW_PRIVATE_HOSTS;
    process.env.TOLLGATE_VERIFY_SECRET = "secret";
    delete process.env.TOLLGATE_VERIFY_ALLOW_PRIVATE_HOSTS;
    const localSource = {
      ...source,
      url: "http://p1-custodial-proof.lvh.me:3102/verified",
    };

    try {
      await expect(verifyMetaTagSource(localSource)).rejects.toThrow(
        "resolves to a blocked address",
      );
      process.env.TOLLGATE_VERIFY_ALLOW_PRIVATE_HOSTS = "1";
      await expect(
        verifyMetaTagSource(localSource, {
          fetchImpl: async () =>
            new Response(
              `<meta name="tollgate-verification" content="${verificationToken(
                localSource.id,
              )}">`,
              { status: 200 },
            ),
          resolveHost: async () => ["93.184.216.34"],
        }),
      ).resolves.toMatchObject({ method: "meta-tag" });
    } finally {
      if (previousSecret === undefined) {
        delete process.env.TOLLGATE_VERIFY_SECRET;
      } else {
        process.env.TOLLGATE_VERIFY_SECRET = previousSecret;
      }
      if (previousAllow === undefined) {
        delete process.env.TOLLGATE_VERIFY_ALLOW_PRIVATE_HOSTS;
      } else {
        process.env.TOLLGATE_VERIFY_ALLOW_PRIVATE_HOSTS = previousAllow;
      }
    }
  });
});
