import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LINK_DOWNLOAD_MAX_BYTES } from "../../../../lib/link-content";
import { VIDEO_UPLOAD_MAX_BYTES } from "../../../../lib/video-content";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  handleLinkUploadRegistration: vi.fn(),
  getSessionOwner: vi.fn(),
  signSession: vi.fn(),
}));

vi.mock("../../../../lib/link-registration", () => ({
  handleLinkUploadRegistration: mocks.handleLinkUploadRegistration,
}));

vi.mock("../../../../lib/account", () => ({
  SESSION_COOKIE_NAME: "aperture_session",
  getSessionOwner: mocks.getSessionOwner,
  signSession: mocks.signSession,
  sessionCookieOptions: () => ({
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/aperture",
    maxAge: 2592000,
  }),
}));

vi.mock("../../../../lib/link-registry", () => ({
  LinkRegistryError: class LinkRegistryError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  },
}));

function uploadRequest(ip: string, fields: Record<string, string> = {}) {
  const body = new FormData();
  body.set(
    "file",
    new File(
      [new Uint8Array([1, 2, 3])],
      fields.mediaKind === "video" ? "clip.mp4" : "photo.png",
      {
        type: fields.mediaKind === "video" ? "video/mp4" : "image/png",
      },
    ),
  );
  body.set("title", fields.title ?? "Photo");
  body.set("displayName", fields.displayName ?? "Jane Lens");
  body.set("email", fields.email ?? "jane@example.com");
  if (fields.mediaKind) body.set("mediaKind", fields.mediaKind);
  return new NextRequest("http://aperture.test/aperture/api/links/upload", {
    method: "POST",
    headers: { "x-real-ip": ip },
    body,
  });
}

function fileWithSize(size: number, type: string): File {
  const file = new File([new Uint8Array([1])], "oversized.bin", { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function requestWithFormData(ip: string, body: FormData): NextRequest {
  return {
    headers: new Headers({ "x-real-ip": ip }),
    formData: async () => body,
  } as unknown as NextRequest;
}

describe("POST /api/links/upload", () => {
  beforeEach(() => {
    mocks.handleLinkUploadRegistration.mockReset();
    mocks.getSessionOwner.mockReset();
    mocks.signSession.mockReset();
    mocks.getSessionOwner.mockResolvedValue(null);
    mocks.signSession.mockReturnValue("owner-1.signature");
  });

  it("sets a session cookie after first-time upload account creation", async () => {
    mocks.handleLinkUploadRegistration.mockResolvedValue({
      accountKey: "aptr_key",
      link: { id: "upload-1", title: "Photo", priceAtomicUsdc: 2500 },
      registered: {
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        approvalStatus: "operator-approved",
      },
      shareUrl: "https://tollgate.gudman.xyz/aperture/link/upload-1",
    });

    const response = await POST(uploadRequest("198.51.100.211"));

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("aperture_session=");
    expect(mocks.signSession).toHaveBeenCalledWith("owner-1");
    expect(mocks.handleLinkUploadRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        fileBytes: expect.any(Uint8Array),
        mediaKind: "photo",
        title: "Photo",
        displayName: "Jane Lens",
        email: "jane@example.com",
      }),
      expect.not.objectContaining({ sessionOwnerId: expect.any(String) }),
    );
  });

  it("reuses an existing session owner and strips email", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "existing-owner",
      displayName: "Existing Lens",
    });
    mocks.handleLinkUploadRegistration.mockResolvedValue({
      link: { id: "upload-2", title: "Photo", priceAtomicUsdc: 2500 },
      registered: {
        ownerId: "existing-owner",
        displayName: "Existing Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        approvalStatus: "operator-approved",
      },
      shareUrl: "https://tollgate.gudman.xyz/aperture/link/upload-2",
    });

    const response = await POST(
      uploadRequest("198.51.100.212", { email: "ignored@example.com" }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.handleLinkUploadRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ email: undefined }),
      expect.objectContaining({ sessionOwnerId: "existing-owner" }),
    );
  });

  it("passes video uploads with the video media kind", async () => {
    mocks.handleLinkUploadRegistration.mockResolvedValue({
      accountKey: "aptr_key",
      link: {
        id: "video-1",
        title: "Clip",
        mediaKind: "video",
        priceAtomicUsdc: 2500,
      },
      registered: {
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        approvalStatus: "operator-approved",
      },
      shareUrl: "https://tollgate.gudman.xyz/aperture/link/video-1",
    });

    const response = await POST(
      uploadRequest("198.51.100.215", {
        title: "Clip",
        mediaKind: "video",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.handleLinkUploadRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        fileBytes: expect.any(Uint8Array),
        mediaKind: "video",
        title: "Clip",
      }),
      expect.any(Object),
    );
  });

  it("rejects invalid media kinds before registration", async () => {
    const response = await POST(
      uploadRequest("198.51.100.216", { mediaKind: "audio" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "mediaKind must be photo or video.",
    });
    expect(mocks.handleLinkUploadRegistration).not.toHaveBeenCalled();
  });

  it("returns a video-specific validation error when the multipart file is missing", async () => {
    const body = new FormData();
    body.set("title", "Video");
    body.set("mediaKind", "video");
    const response = await POST(
      new NextRequest("http://aperture.test/aperture/api/links/upload", {
        method: "POST",
        headers: { "x-real-ip": "198.51.100.217" },
        body,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "video file is required." });
    expect(mocks.handleLinkUploadRegistration).not.toHaveBeenCalled();
  });

  it("returns a validation error when the multipart file is missing", async () => {
    const body = new FormData();
    body.set("title", "Photo");
    const response = await POST(
      new NextRequest("http://aperture.test/aperture/api/links/upload", {
        method: "POST",
        headers: { "x-real-ip": "198.51.100.213" },
        body,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "image file is required." });
    expect(mocks.handleLinkUploadRegistration).not.toHaveBeenCalled();
  });

  it("rejects multipart files larger than the download cap", async () => {
    const body = new FormData();
    body.set(
      "file",
      new File([new Uint8Array(LINK_DOWNLOAD_MAX_BYTES + 1)], "large.png", {
        type: "image/png",
      }),
    );
    body.set("title", "Large Photo");
    body.set("displayName", "Jane Lens");

    const response = await POST(
      new NextRequest("http://aperture.test/aperture/api/links/upload", {
        method: "POST",
        headers: { "x-real-ip": "198.51.100.214" },
        body,
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "photo is larger than the 25 MB upload cap.",
    });
    expect(mocks.handleLinkUploadRegistration).not.toHaveBeenCalled();
  });

  it("rejects video files larger than the video upload cap", async () => {
    const body = new FormData();
    body.set(
      "file",
      fileWithSize(VIDEO_UPLOAD_MAX_BYTES + 1, "video/mp4"),
    );
    body.set("mediaKind", "video");
    body.set("title", "Large Video");
    body.set("displayName", "Jane Lens");

    const response = await POST(
      requestWithFormData("198.51.100.218", body),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "video is larger than the 100 MB upload cap.",
    });
    expect(mocks.handleLinkUploadRegistration).not.toHaveBeenCalled();
  });
});
