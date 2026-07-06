import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountKeyHash,
  findOwnerByAccountKey,
  findOwnerByEmail,
  generateAccountKey,
  generateLoginToken,
  generateSignupToken,
  maskAccountEmail,
  normalizeAccountEmail,
  redeemLoginToken,
  signSession,
  verifySignupToken,
  verifySession,
} from "./account";
import { readWalletRegistry, writeWalletRegistry } from "./registry";

const wallet = "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03";

async function withTempRegistry(
  run: (filePath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-account-"));
  try {
    await run(path.join(dir, "registry.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function withSessionSecret<T>(secret: string | undefined, run: () => T): T {
  const saved = process.env.APERTURE_SESSION_SECRET;
  if (secret === undefined) {
    delete process.env.APERTURE_SESSION_SECRET;
  } else {
    process.env.APERTURE_SESSION_SECRET = secret;
  }
  try {
    return run();
  } finally {
    if (saved === undefined) {
      delete process.env.APERTURE_SESSION_SECRET;
    } else {
      process.env.APERTURE_SESSION_SECRET = saved;
    }
  }
}

describe("account keys", () => {
  it("generates prefixed keys with at least 256 bits of entropy", () => {
    const key = generateAccountKey();

    expect(key).toMatch(/^aptr_[0-9a-f]{64}$/);
    expect(
      new Set([key, generateAccountKey(), generateAccountKey()]).size,
    ).toBe(3);
  });

  it("finds owners by account key hash without storing plaintext", async () => {
    await withTempRegistry(async (filePath) => {
      const accountKey = "aptr_test-key";
      await writeWalletRegistry(
        {
          photographers: [
            {
              ownerId: "owner-1",
              displayName: "Jane Lens",
              wallet,
              createdAt: "2026-07-06T00:00:00.000Z",
              approvalStatus: "operator-approved",
              accountKeyHash: accountKeyHash(accountKey),
            },
          ],
        },
        filePath,
      );

      const hit = await findOwnerByAccountKey(accountKey, filePath);
      const miss = await findOwnerByAccountKey("aptr_wrong", filePath);

      expect(hit?.ownerId).toBe("owner-1");
      expect(miss).toBeNull();
      expect(hit).not.toHaveProperty("accountKey");
    });
  });
});

describe("email login", () => {
  it("normalizes valid emails and rejects malformed addresses", () => {
    expect(normalizeAccountEmail(" Jane@Example.COM ")).toBe(
      "jane@example.com",
    );
    expect(normalizeAccountEmail("not-an-email")).toBeNull();
    expect(maskAccountEmail("jane@example.com")).toBe("j***@example.com");
  });

  it("finds owners by lowercased account email", async () => {
    await withTempRegistry(async (filePath) => {
      await writeWalletRegistry(
        {
          photographers: [
            {
              ownerId: "owner-1",
              displayName: "Jane Lens",
              wallet,
              createdAt: "2026-07-06T00:00:00.000Z",
              approvalStatus: "operator-approved",
              email: "jane@example.com",
            },
          ],
        },
        filePath,
      );

      const hit = await findOwnerByEmail(" JANE@example.com ", filePath);
      const miss = await findOwnerByEmail("other@example.com", filePath);

      expect(hit?.ownerId).toBe("owner-1");
      expect(miss).toBeNull();
    });
  });

  it("generates and resolves login tokens (reusable within TTL, survives link pre-fetch) without rotating the account key", async () => {
    await withTempRegistry(async (filePath) => {
      const oldHash = accountKeyHash("aptr_old");
      await writeWalletRegistry(
        {
          photographers: [
            {
              ownerId: "owner-1",
              displayName: "Jane Lens",
              wallet,
              createdAt: "2026-07-06T00:00:00.000Z",
              approvalStatus: "operator-approved",
              email: "jane@example.com",
              accountKeyHash: oldHash,
            },
          ],
        },
        filePath,
      );

      const login = await generateLoginToken("owner-1", filePath);
      expect(login?.token).toMatch(/^[0-9a-f]{64}$/);
      expect(login?.hash).toMatch(/^0x[0-9a-f]{64}$/);

      const redeemed = await redeemLoginToken(login?.token ?? "", filePath);
      // Reusable within TTL: a second lookup (e.g. the human's click after a
      // scanner pre-fetched the link) still resolves, and the token is NOT
      // cleared.
      const second = await redeemLoginToken(login?.token ?? "", filePath);
      const read = await readWalletRegistry(filePath);

      expect(redeemed?.ownerId).toBe("owner-1");
      expect(redeemed?.accountKeyHash).toBe(oldHash);
      expect(second?.ownerId).toBe("owner-1");
      expect(read.photographers[0].accountKeyHash).toBe(oldHash);
      expect(read.photographers[0].loginTokenHash).toBe(login?.hash);
      expect(read.photographers[0].loginTokenExpiresAt).toBe(login?.expiresAt);
    });
  });

  it("rejects wrong or expired login tokens", async () => {
    await withTempRegistry(async (filePath) => {
      const token = "a".repeat(64);
      await writeWalletRegistry(
        {
          photographers: [
            {
              ownerId: "owner-1",
              displayName: "Jane Lens",
              wallet,
              createdAt: "2026-07-06T00:00:00.000Z",
              approvalStatus: "operator-approved",
              loginTokenHash: accountKeyHash(token),
              loginTokenExpiresAt: "2026-07-06T00:00:00.000Z",
            },
          ],
        },
        filePath,
      );

      expect(await redeemLoginToken("b".repeat(64), filePath)).toBeNull();
      expect(
        await redeemLoginToken(
          token,
          filePath,
          Date.parse("2026-07-06T00:30:00.000Z"),
        ),
      ).toBeNull();
    });
  });

  it("generates and verifies signed signup tokens", () => {
    withSessionSecret("session-secret", () => {
      const token = generateSignupToken(" Jane@Example.COM ", 1_000);

      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
      expect(verifySignupToken(token ?? "", 1_000)).toBe("jane@example.com");
    });
  });

  it("rejects expired, tampered, malformed, and secretless signup tokens", () => {
    withSessionSecret("session-secret", () => {
      const token = generateSignupToken("jane@example.com", 1_000) ?? "";
      const [payload, signature] = token.split(".");
      const tamperedPayload = Buffer.from(
        JSON.stringify({
          email: "other@example.com",
          exp: 1_000 + 20 * 60 * 1_000,
        }),
        "utf8",
      ).toString("base64url");

      expect(verifySignupToken(token, 1_000 + 20 * 60 * 1_000 + 1)).toBeNull();
      expect(
        verifySignupToken(`${tamperedPayload}.${signature}`, 1_000),
      ).toBeNull();
      expect(verifySignupToken(`${payload}.00`, 1_000)).toBeNull();
      expect(verifySignupToken("not-a-token", 1_000)).toBeNull();
    });

    withSessionSecret(undefined, () => {
      expect(generateSignupToken("jane@example.com", 1_000)).toBeNull();
      expect(verifySignupToken("payload.signature", 1_000)).toBeNull();
    });
  });
});

describe("account sessions", () => {
  it("round-trips a signed session and rejects tampering", () => {
    withSessionSecret("session-secret", () => {
      const cookie = signSession("owner-1");

      expect(cookie).toMatch(/^owner-1\.[0-9a-f]{64}$/);
      expect(verifySession(cookie ?? undefined)).toBe("owner-1");
      expect(verifySession(`${cookie}00`)).toBeNull();
      expect(verifySession(cookie?.replace("owner-1", "owner-2"))).toBeNull();
    });
  });

  it("fails closed when the session secret is missing", () => {
    withSessionSecret(undefined, () => {
      expect(signSession("owner-1")).toBeNull();
      expect(verifySession("owner-1.00")).toBeNull();
    });
  });
});
