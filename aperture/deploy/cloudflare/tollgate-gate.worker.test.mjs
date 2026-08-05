import { describe, expect, it, vi } from "vitest";
import {
  handleGatedRequest,
  licenseCheckRequest,
  originRequest,
} from "./tollgate-gate.worker.mjs";

const ENV = {
  LICENSE_CHECK_URL: "https://tollgate.example/aperture/api/license-check",
  ORIGIN_URL: "https://immich.example",
  GATED_PATH: "/api/download/archive",
  PAY_PATH: "/aperture/api/license-download",
};

const GATED_URL = "https://gate.example/api/download/archive?key=abc123";

describe("payment gate worker", () => {
  it("forwards the original uri and method to the license check", () => {
    const check = licenseCheckRequest(
      new Request(GATED_URL, { method: "GET" }),
      ENV.LICENSE_CHECK_URL,
    );

    expect(check.method).toBe("GET");
    expect(check.url).toBe(ENV.LICENSE_CHECK_URL);
    expect(check.headers.get("x-original-uri")).toBe(
      "/api/download/archive?key=abc123",
    );
    expect(check.headers.get("x-original-method")).toBe("GET");
  });

  it("omits share headers that the client did not send", () => {
    const check = licenseCheckRequest(
      new Request(GATED_URL),
      ENV.LICENSE_CHECK_URL,
    );

    // Present-but-empty reads as a share credential and would deny every
    // owner-session download.
    expect(check.headers.has("x-original-x-immich-share-key")).toBe(false);
  });

  it("forwards a share header when the client did send one", () => {
    const check = licenseCheckRequest(
      new Request(GATED_URL, { headers: { "x-immich-share-key": "shared" } }),
      ENV.LICENSE_CHECK_URL,
    );

    expect(check.headers.get("x-original-x-immich-share-key")).toBe("shared");
  });

  it("strips the share credential from the origin request", () => {
    const origin = originRequest(
      new Request(GATED_URL, {
        headers: { "x-immich-share-key": "shared", accept: "application/zip" },
      }),
      ENV.ORIGIN_URL,
      ENV.GATED_PATH,
    );

    expect(origin.url).toBe(
      "https://immich.example/api/download/archive?key=abc123",
    );
    expect(origin.headers.get("x-immich-share-key")).toBeNull();
    expect(origin.headers.get("accept")).toBe("application/zip");
  });

  it("answers 402 with the pay link when the check denies", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));

    const response = await handleGatedRequest(
      new Request(GATED_URL),
      ENV,
      fetchImpl,
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "payment required",
      pay: "/aperture/api/license-download",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("proxies to the origin when the check allows", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("zip-bytes", { status: 200 }));

    const response = await handleGatedRequest(
      new Request(GATED_URL),
      ENV,
      fetchImpl,
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0].url).toBe(
      "https://immich.example/api/download/archive?key=abc123",
    );
  });

  it("fails closed when the license check is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const response = await handleGatedRequest(
      new Request(GATED_URL),
      ENV,
      fetchImpl,
    );

    expect(response.status).toBe(502);
    // The origin must not be reached when the gate could not be evaluated.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an unexpected check status", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));

    const response = await handleGatedRequest(
      new Request(GATED_URL),
      ENV,
      fetchImpl,
    );

    expect(response.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
