import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  appendSource: vi.fn(),
  assertSourceRegistrationRateLimit: vi.fn(),
}));

vi.mock("@/lib/catalog", () => {
  class SourceRegistryError extends Error {
    constructor(
      message: string,
      public readonly status = 400,
    ) {
      super(message);
    }
  }

  return {
    SourceRegistryError,
    appendSource: mocks.appendSource,
    publicSource: <T>(source: T) => source,
    readSources: vi.fn(),
  };
});

vi.mock("@/lib/rate-limit", () => ({
  assertSourceRegistrationRateLimit: mocks.assertSourceRegistrationRateLimit,
  requestIp: (headers: Headers) =>
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "local",
}));

describe("POST /api/sources", () => {
  beforeEach(() => {
    mocks.appendSource.mockReset();
    mocks.assertSourceRegistrationRateLimit.mockReset();
  });

  it("does not expose Circle request details in registration errors", async () => {
    mocks.appendSource.mockRejectedValue(
      new Error(
        "Circle request /wallets/private-circle-wallet-id failed: upstream-secret-body",
      ),
    );
    const request = new NextRequest("https://tollgate.test/api/sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.10",
      },
      body: JSON.stringify({ title: "Source One" }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Source registration failed." });
    expect(JSON.stringify(body)).not.toContain("private-circle-wallet-id");
    expect(JSON.stringify(body)).not.toContain("upstream-secret-body");
  });
});
