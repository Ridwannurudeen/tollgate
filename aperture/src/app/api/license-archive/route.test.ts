import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  handleLicenseArchive: vi.fn(),
  resolveSharedLink: vi.fn(),
}));

vi.mock("../../../lib/license-archive", () => ({
  handleLicenseArchive: mocks.handleLicenseArchive,
}));

vi.mock("../../../lib/immich", () => ({
  resolveSharedLink: mocks.resolveSharedLink,
}));

function request(body: unknown): Request {
  return new Request(
    "http://aperture.test/aperture/api/license-archive?key=abc123&tollgateAuthorization=signed-token",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/license-archive", () => {
  beforeEach(() => {
    mocks.handleLicenseArchive.mockReset();
    mocks.resolveSharedLink.mockReset();
  });

  it("streams only safe upstream archive headers", async () => {
    mocks.handleLicenseArchive.mockResolvedValueOnce({
      status: 200,
      response: new Response("archive", {
        headers: {
          "content-disposition": 'attachment; filename="archive.zip"',
          "content-type": "application/zip",
          "set-cookie": "immich-secret=session",
          "x-internal-debug": "private",
        },
      }),
    });

    const response = await POST(
      request({ assetIds: ["asset-1"], edited: false }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="archive.zip"',
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-internal-debug")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("wires a server-owned Immich request without caller headers", async () => {
    mocks.handleLicenseArchive.mockResolvedValueOnce({
      status: 403,
      body: { error: "denied" },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("archive"));

    await POST(request({ assetIds: ["asset-1"], edited: false }));
    const deps = mocks.handleLicenseArchive.mock.calls[0]?.[1] as {
      fetchArchive: (
        key: string,
        body: { assetIds: string[]; edited: false },
      ) => Promise<Response>;
    };
    await deps.fetchArchive("abc123", {
      assetIds: ["asset-1"],
      edited: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:2283/api/download/archive?key=abc123",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetIds: ["asset-1"],
          edited: false,
        }),
        cache: "no-store",
        redirect: "error",
      },
    );
    fetchMock.mockRestore();
  });

  it("rejects malformed bodies before archive authorization", async () => {
    const response = await POST(
      request({ assetIds: ["asset-1"], edited: true }),
    );

    expect(response.status).toBe(400);
    expect(mocks.handleLicenseArchive).not.toHaveBeenCalled();
  });
});
