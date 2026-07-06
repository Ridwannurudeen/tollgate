import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LinkRegistryError,
  publicLink,
  readLinks,
  registerLink,
} from "./link-registry";

describe("link registry", () => {
  it("registers a link and strips the source URL from public projections", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-links-"));
    const filePath = path.join(dir, "links.json");
    try {
      const link = await registerLink(
        {
          id: "link-1",
          title: "Photo",
          ownerId: "link-owner",
          sourceUrl: "https://EXAMPLE.com/photo.jpg#tracking",
          contentType: "image/jpeg",
          sourceContentHash: `0x${"1".repeat(64)}`,
          createdAt: "2026-07-06T00:00:00.000Z",
        },
        filePath,
      );
      const registry = await readLinks(filePath);
      const projected = publicLink(link) as Record<string, unknown>;

      expect(registry.links).toHaveLength(1);
      expect(registry.links[0].sourceUrl).toBe("https://example.com/photo.jpg");
      expect(projected.sourceUrl).toBeUndefined();
      expect(projected.sourceContentHash).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate normalized source URLs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-links-"));
    const filePath = path.join(dir, "links.json");
    try {
      await registerLink(
        {
          title: "Photo",
          ownerId: "owner-1",
          sourceUrl: "https://example.com/photo.jpg#one",
        },
        filePath,
      );

      await expect(
        registerLink(
          {
            title: "Photo Two",
            ownerId: "owner-2",
            sourceUrl: "https://example.com/photo.jpg#two",
          },
          filePath,
        ),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
