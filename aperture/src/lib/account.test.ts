import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountKeyHash,
  findOwnerByAccountKey,
  generateAccountKey,
  signSession,
  verifySession,
} from "./account";
import { writeWalletRegistry } from "./registry";

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
