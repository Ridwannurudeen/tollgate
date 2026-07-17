import { describe, expect, it, vi } from "vitest";
import {
  handleLicenseArchive,
  type LicenseArchiveDeps,
} from "./license-archive";

const claim = { nonce: "a".repeat(32), expiresAt: 10_000 };

function deps(
  overrides: Partial<LicenseArchiveDeps> = {},
): LicenseArchiveDeps {
  return {
    resolveSharedLink: async () => ({
      id: "share-1",
      key: "abc123",
      type: "INDIVIDUAL",
      allowDownload: true,
      assets: [
        {
          id: "asset-1",
          ownerId: "owner-1",
          originalFileName: "photo.png",
        },
      ],
    }),
    reserveAuthorization: async () => claim,
    completeAuthorization: async () => true,
    releaseAuthorization: async () => undefined,
    fetchArchive: async () =>
      new Response("archive", {
        status: 200,
        headers: { "content-type": "application/zip" },
      }),
    ...overrides,
  };
}

describe("license archive proxy", () => {
  it("rejects a caller body that does not match the complete current link", async () => {
    const reserveAuthorization = vi.fn();
    const fetchArchive = vi.fn();
    const result = await handleLicenseArchive(
      {
        sharedLinkKey: "abc123",
        authorization: "signed-token",
        method: "POST",
        assetIds: ["other-asset"],
        edited: false,
      },
      deps({ reserveAuthorization, fetchArchive }),
    );

    expect(result).toMatchObject({ status: 400 });
    expect(reserveAuthorization).not.toHaveBeenCalled();
    expect(fetchArchive).not.toHaveBeenCalled();
  });

  it("reserves the full current snapshot and sends only the server-owned body", async () => {
    const reserveAuthorization = vi.fn(async () => claim);
    const fetchArchive = vi.fn(async () => new Response("archive"));
    const result = await handleLicenseArchive(
      {
        sharedLinkKey: "abc123",
        authorization: "signed-token",
        method: "POST",
        assetIds: ["asset-1"],
        edited: false,
      },
      deps({ reserveAuthorization, fetchArchive }),
    );

    expect(result.status).toBe(200);
    expect(reserveAuthorization).toHaveBeenCalledWith(
      "signed-token",
      {
        sharedLinkKey: "abc123",
        sharedLinkId: "share-1",
        assetIds: ["asset-1"],
        method: "POST",
      },
    );
    expect(fetchArchive).toHaveBeenCalledWith("abc123", {
      assetIds: ["asset-1"],
      edited: false,
    });
  });

  it("releases a reserved authorization after an upstream rejection", async () => {
    const completeAuthorization = vi.fn();
    const releaseAuthorization = vi.fn(async () => undefined);
    const result = await handleLicenseArchive(
      {
        sharedLinkKey: "abc123",
        authorization: "signed-token",
        method: "POST",
        assetIds: ["asset-1"],
        edited: false,
      },
      deps({
        completeAuthorization,
        releaseAuthorization,
        fetchArchive: async () => new Response("denied", { status: 403 }),
      }),
    );

    expect(result).toMatchObject({ status: 502 });
    expect(releaseAuthorization).toHaveBeenCalledWith(claim);
    expect(completeAuthorization).not.toHaveBeenCalled();
  });

  it("completes the one-use authorization before exposing the stream", async () => {
    const completeAuthorization = vi.fn(async () => true);
    const result = await handleLicenseArchive(
      {
        sharedLinkKey: "abc123",
        authorization: "signed-token",
        method: "POST",
        assetIds: ["asset-1"],
        edited: false,
      },
      deps({ completeAuthorization }),
    );

    expect(result.status).toBe(200);
    expect(completeAuthorization).toHaveBeenCalledWith(claim);
    expect("response" in result && await result.response.text()).toBe(
      "archive",
    );
  });

  it("fails closed when the link changes or the token was already used", async () => {
    const fetchArchive = vi.fn();
    const result = await handleLicenseArchive(
      {
        sharedLinkKey: "abc123",
        authorization: "signed-token",
        method: "POST",
        assetIds: ["asset-1"],
        edited: false,
      },
      deps({
        reserveAuthorization: async () => null,
        fetchArchive,
      }),
    );

    expect(result).toMatchObject({ status: 403 });
    expect(fetchArchive).not.toHaveBeenCalled();
  });
});
