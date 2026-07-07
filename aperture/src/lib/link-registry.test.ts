import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  markLinkPreviewGenerated,
  listPublicLinks,
  publicLink,
  readLinks,
  readLinksByOwner,
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
          description: "A rainy evening street scene in Lagos.",
          ownerId: "link-owner",
          sourceUrl: "https://EXAMPLE.com/photo.jpg#tracking",
          contentType: "image/jpeg",
          sourceContentHash: `0x${"1".repeat(64)}`,
          hasPreview: true,
          createdAt: "2026-07-06T00:00:00.000Z",
        },
        filePath,
      );
      const registry = await readLinks(filePath);
      const projected = publicLink(link) as Record<string, unknown>;

      expect(registry.links).toHaveLength(1);
      expect(registry.links[0].sourceUrl).toBe("https://example.com/photo.jpg");
      expect(registry.links[0].description).toBe(
        "A rainy evening street scene in Lagos.",
      );
      expect(registry.links[0].hasPreview).toBe(true);
      expect(projected.description).toBe(
        "A rainy evening street scene in Lagos.",
      );
      expect(projected.hasPreview).toBe(true);
      expect(projected.sourceUrl).toBeUndefined();
      expect(projected.sourceContentHash).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("registers an uploaded original without a source URL", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-links-"));
    const filePath = path.join(dir, "links.json");
    try {
      const link = await registerLink(
        {
          id: "upload-1",
          title: "Uploaded Photo",
          ownerId: "link-owner",
          sourceKind: "upload",
          originalContentType: "image/png",
          sourceContentHash: `0x${"4".repeat(64)}`,
          hasPreview: true,
          createdAt: "2026-07-06T00:00:00.000Z",
        },
        filePath,
      );
      const projected = publicLink(link) as Record<string, unknown>;

      expect(link.sourceKind).toBe("upload");
      expect(link.sourceUrl).toBeUndefined();
      expect(link.originalContentType).toBe("image/png");
      expect(projected.sourceUrl).toBeUndefined();
      expect(projected.sourceContentHash).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("registers an uploaded video and exposes only public media metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-links-"));
    const filePath = path.join(dir, "links.json");
    try {
      const link = await registerLink(
        {
          id: "video-1",
          title: "Uploaded Video",
          ownerId: "link-owner",
          mediaKind: "video",
          sourceKind: "upload",
          originalContentType: "video/mp4",
          sourceContentHash: `0x${"5".repeat(64)}`,
          hasPreview: true,
          createdAt: "2026-07-06T00:00:00.000Z",
        },
        filePath,
      );
      const projected = publicLink(link) as Record<string, unknown>;

      expect(link.mediaKind).toBe("video");
      expect(link.sourceKind).toBe("upload");
      expect(projected.mediaKind).toBe("video");
      expect(projected.sourceUrl).toBeUndefined();
      expect(projected.sourceContentHash).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects URL-based video records", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-links-"));
    const filePath = path.join(dir, "links.json");
    try {
      await expect(
        registerLink(
          {
            id: "video-url",
            title: "Hosted Video",
            ownerId: "link-owner",
            mediaKind: "video",
            sourceUrl: "https://example.com/video.mp4",
          },
          filePath,
        ),
      ).rejects.toThrow("video links must be uploaded files.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters corrupt links with non-string descriptions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-links-"));
    const filePath = path.join(dir, "links.json");
    try {
      await writeFile(
        filePath,
        JSON.stringify({
          links: [
            {
              id: "valid",
              title: "Valid Photo",
              description: "Plain public description.",
              ownerId: "owner-1",
              sourceUrl: "https://example.com/valid.jpg",
              priceAtomicUsdc: 2500,
              createdAt: "2026-07-06T00:00:00.000Z",
            },
            {
              id: "invalid",
              title: "Invalid Photo",
              description: { text: "not allowed" },
              ownerId: "owner-1",
              sourceUrl: "https://example.com/invalid.jpg",
              priceAtomicUsdc: 2500,
              createdAt: "2026-07-06T00:00:00.000Z",
            },
          ],
        }),
        "utf8",
      );

      const registry = await readLinks(filePath);

      expect(registry.links.map((link) => link.id)).toEqual(["valid"]);
      expect(registry.links[0].description).toBe("Plain public description.");
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

  it("marks a registered link as having a generated preview", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-links-"));
    const filePath = path.join(dir, "links.json");
    try {
      const link = await registerLink(
        {
          id: "link-1",
          title: "Photo",
          ownerId: "owner-1",
          sourceUrl: "https://example.com/photo.jpg",
        },
        filePath,
      );

      const updated = await markLinkPreviewGenerated(link.id, filePath);
      const registry = await readLinks(filePath);

      expect(updated.hasPreview).toBe(true);
      expect(registry.links[0].hasPreview).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters links by owner and lists newest public projections", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-links-"));
    const filePath = path.join(dir, "links.json");
    try {
      await registerLink(
        {
          id: "old",
          title: "Old Photo",
          ownerId: "owner-1",
          sourceUrl: "https://example.com/old.jpg",
          sourceContentHash: `0x${"2".repeat(64)}`,
          createdAt: "2026-07-05T00:00:00.000Z",
        },
        filePath,
      );
      await registerLink(
        {
          id: "new",
          title: "New Photo",
          ownerId: "owner-2",
          sourceUrl: "https://example.com/new.jpg",
          sourceContentHash: `0x${"3".repeat(64)}`,
          createdAt: "2026-07-06T00:00:00.000Z",
        },
        filePath,
      );

      const ownerLinks = await readLinksByOwner("owner-1", filePath);
      const publicLinks = (await listPublicLinks(filePath)) as Array<
        Record<string, unknown>
      >;

      expect(ownerLinks.map((link) => link.id)).toEqual(["old"]);
      expect(publicLinks.map((link) => link.id)).toEqual(["new", "old"]);
      expect(publicLinks[0].sourceUrl).toBeUndefined();
      expect(publicLinks[0].sourceContentHash).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
