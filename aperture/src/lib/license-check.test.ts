import { describe, expect, it } from "vitest";
import { evaluateLicenseCheck } from "./license-check";

describe("evaluateLicenseCheck", () => {
  it("allows owner-session archive downloads without a shared-link key", async () => {
    const result = await evaluateLicenseCheck({
      originalUri: "/immich/api/download/archive",
      originalMethod: "POST",
      originalImmichShareKey: null,
      originalImmichShareSlug: null,
    });

    expect(result).toEqual({ allowed: true, status: 204 });
  });

  it.each([
    [
      "a slug query",
      {
        originalUri:
          "/immich/api/download/archive?slug=public-share&tollgateAuthorization=signed-token",
        originalMethod: "POST",
      },
    ],
    [
      "an Immich share-key header",
      {
        originalUri:
          "/immich/api/download/archive?tollgateAuthorization=signed-token",
        originalMethod: "POST",
        originalImmichShareKey: "abc123",
      },
    ],
    [
      "an Immich share-slug header",
      {
        originalUri:
          "/immich/api/download/archive?tollgateAuthorization=signed-token",
        originalMethod: "POST",
        originalImmichShareSlug: "public-share",
      },
    ],
  ])("denies archive requests using %s", async (_label, input) => {
    const result = await evaluateLicenseCheck(input);

    expect(result).toMatchObject({
      allowed: false,
      status: 403,
      body: { error: "payment required" },
    });
  });

  it("denies a shared-link archive without purchase authorization", async () => {
    const result = await evaluateLicenseCheck({
      originalUri: "/immich/api/download/archive?key=abc123",
      originalMethod: "POST",
    });

    expect(result).toMatchObject({
      allowed: false,
      status: 403,
      body: { error: "payment required" },
    });
  });

  it("denies key-based archives even with a legacy authorization token", async () => {
    const result = await evaluateLicenseCheck({
      originalUri:
        "/immich/api/download/archive?key=abc123&tollgateAuthorization=signed-token",
      originalMethod: "POST",
    });

    expect(result).toMatchObject({ allowed: false, status: 403 });
  });

  it("does not treat historical receipts as caller authorization", async () => {
    const result = await evaluateLicenseCheck({
      originalUri: "/immich/api/download/archive?key=abc123",
      originalMethod: "POST",
    });

    expect(result).toMatchObject({
      allowed: false,
      status: 403,
      body: { error: "payment required" },
    });
  });

  it("denies malformed original URIs", async () => {
    const result = await evaluateLicenseCheck({
      originalUri: "http://[invalid",
      originalMethod: "POST",
    });

    expect(result).toMatchObject({ allowed: false, status: 403 });
  });
});
