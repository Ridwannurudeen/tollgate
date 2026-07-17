import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LICENSE_AUTHORIZATION_TTL_MS,
  completeLicenseAuthorization,
  createLicenseAuthorization,
  releaseLicenseAuthorization,
  reserveLicenseAuthorization,
} from "./license-authorization";

describe("license authorization", () => {
  const savedSecret = process.env.APERTURE_SESSION_SECRET;
  const scope = {
    sharedLinkKey: "shared-key",
    sharedLinkId: "shared-link-id",
    assetIds: ["asset-b", "asset-a", "asset-a"],
  };
  let tempDirectory: string;
  let dbPath: string;

  beforeEach(async () => {
    process.env.APERTURE_SESSION_SECRET = "license-authorization-secret";
    tempDirectory = await mkdtemp(
      path.join(tmpdir(), "aperture-license-authorization-"),
    );
    dbPath = path.join(tempDirectory, "authorization.db");
  });

  afterEach(async () => {
    if (savedSecret === undefined) {
      delete process.env.APERTURE_SESSION_SECRET;
    } else {
      process.env.APERTURE_SESSION_SECRET = savedSecret;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it("atomically reserves once and persists consumption across database reopen", async () => {
    const expiresAt = 1_000 + LICENSE_AUTHORIZATION_TTL_MS;
    const token = createLicenseAuthorization(scope, {
      nonce: "a".repeat(32),
      now: 1_000,
      expiresAt,
    });

    expect(token).toBeTruthy();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveLicenseAuthorization(
          token ?? "",
          {
            ...scope,
            assetIds: ["asset-a", "asset-b"],
            method: "POST",
          },
          { dbPath, now: 1_000 },
        ),
      ),
    );
    const successful = claims.filter((claim) => claim !== null);

    expect(successful).toEqual([{ nonce: "a".repeat(32), expiresAt }]);
    const claim = successful[0];
    expect(await completeLicenseAuthorization(claim, dbPath)).toBe(true);
    expect(await completeLicenseAuthorization(claim, dbPath)).toBe(false);
    await releaseLicenseAuthorization(claim, dbPath);
    expect(
      await reserveLicenseAuthorization(
        token ?? "",
        { ...scope, method: "POST" },
        { dbPath, now: 1_001 },
      ),
    ).toBeNull();
  });

  it("releases only a reserved claim so the same authorization can retry", async () => {
    const token = createLicenseAuthorization(scope, {
      nonce: "b".repeat(32),
      now: 1_000,
      expiresAt: 10_000,
    });
    const claim = await reserveLicenseAuthorization(
      token ?? "",
      { ...scope, method: "POST" },
      { dbPath, now: 1_000 },
    );

    expect(claim).not.toBeNull();
    if (!claim) throw new Error("Expected a reserved authorization claim");
    await releaseLicenseAuthorization(claim, dbPath);
    expect(await completeLicenseAuthorization(claim, dbPath)).toBe(false);
    expect(
      await reserveLicenseAuthorization(
        token ?? "",
        { ...scope, method: "POST" },
        { dbPath, now: 1_001 },
      ),
    ).toEqual(claim);
  });

  it("binds the key, link, canonical asset set, and POST method", async () => {
    const token = createLicenseAuthorization(scope, {
      nonce: "c".repeat(32),
      now: 1_000,
      expiresAt: 10_000,
    });

    expect(
      await reserveLicenseAuthorization(
        token ?? "",
        { ...scope, sharedLinkKey: "other-key", method: "POST" },
        { dbPath, now: 1_000 },
      ),
    ).toBeNull();
    expect(
      await reserveLicenseAuthorization(
        token ?? "",
        { ...scope, sharedLinkId: "other-link", method: "POST" },
        { dbPath, now: 1_000 },
      ),
    ).toBeNull();
    expect(
      await reserveLicenseAuthorization(
        token ?? "",
        { ...scope, assetIds: ["asset-a"], method: "POST" },
        { dbPath, now: 1_000 },
      ),
    ).toBeNull();
    expect(
      await reserveLicenseAuthorization(
        token ?? "",
        { ...scope, method: "GET" },
        { dbPath, now: 1_000 },
      ),
    ).toBeNull();

    const tampered = `${token?.slice(0, -1)}${token?.endsWith("a") ? "b" : "a"}`;
    expect(
      await reserveLicenseAuthorization(
        tampered,
        { ...scope, method: "POST" },
        { dbPath, now: 1_000 },
      ),
    ).toBeNull();

    expect(
      await reserveLicenseAuthorization(
        token ?? "",
        {
          ...scope,
          assetIds: ["asset-a", "asset-b", "asset-b"],
          method: "POST",
        },
        { dbPath, now: 1_000 },
      ),
    ).toEqual({ nonce: "c".repeat(32), expiresAt: 10_000 });
  });

  it("rejects expired authorizations and safely prunes stale reservations", async () => {
    const staleToken = createLicenseAuthorization(scope, {
      nonce: "d".repeat(32),
      now: 1_000,
      expiresAt: 2_000,
    });
    const staleClaim = await reserveLicenseAuthorization(
      staleToken ?? "",
      { ...scope, method: "POST" },
      { dbPath, now: 1_000 },
    );
    const replacementToken = createLicenseAuthorization(scope, {
      nonce: "d".repeat(32),
      now: 2_001,
      expiresAt: 5_000,
    });
    const replacementClaim = await reserveLicenseAuthorization(
      replacementToken ?? "",
      { ...scope, method: "POST" },
      { dbPath, now: 2_001 },
    );

    expect(staleClaim).toEqual({
      nonce: "d".repeat(32),
      expiresAt: 2_000,
    });
    expect(replacementClaim).toEqual({
      nonce: "d".repeat(32),
      expiresAt: 5_000,
    });
    if (!staleClaim || !replacementClaim) {
      throw new Error("Expected stale and replacement authorization claims");
    }
    expect(await completeLicenseAuthorization(staleClaim, dbPath)).toBe(false);
    expect(await completeLicenseAuthorization(replacementClaim, dbPath)).toBe(
      true,
    );

    const expired = createLicenseAuthorization(scope, {
      nonce: "e".repeat(32),
      now: 1_000,
      expiresAt: 2_000,
    });
    expect(
      await reserveLicenseAuthorization(
        expired ?? "",
        { ...scope, method: "POST" },
        { dbPath, now: 2_000 },
      ),
    ).toBeNull();
  });

  it("rejects invalid scopes and deterministic token options", () => {
    expect(
      createLicenseAuthorization({ ...scope, assetIds: [] }, { now: 1_000 }),
    ).toBeNull();
    expect(
      createLicenseAuthorization(scope, {
        nonce: "not-a-nonce",
        now: 1_000,
      }),
    ).toBeNull();
    expect(
      createLicenseAuthorization(scope, {
        now: 2_000,
        expiresAt: 2_000,
      }),
    ).toBeNull();
  });

  it("fails closed without the session secret", async () => {
    delete process.env.APERTURE_SESSION_SECRET;

    expect(createLicenseAuthorization(scope, { now: 1_000 })).toBeNull();
    expect(
      await reserveLicenseAuthorization(
        "payload.signature",
        { ...scope, method: "POST" },
        { dbPath, now: 1_000 },
      ),
    ).toBeNull();
  });
});
