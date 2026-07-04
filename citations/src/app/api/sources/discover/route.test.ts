import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRegistrationInput } from "@/lib/types";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  appendSource: vi.fn(),
  safeFetch: vi.fn(),
}));

vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: mocks.safeFetch,
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
  };
});

function request(url: string, ip: string): NextRequest {
  return new NextRequest("http://tollgate.test/api/sources/discover", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ url }),
  });
}

function response(
  body: string,
  status = 200,
  contentType = "application/json",
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

function sourceFromInput(input: SourceRegistrationInput) {
  return {
    id: String(input.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
    title: input.title,
    creator: input.creator,
    handle: input.handle,
    wallet: input.wallet,
    url: input.url,
    summary: input.summary,
    tags: Array.isArray(input.tags) ? input.tags : [],
    priceAtomicUsdc: Number(input.priceAtomicUsdc),
    sourceKind: "external",
    creatorKind: "external",
    verifiedCreator: false,
    custody: "self",
    probation: true,
    origin: input.origin,
  };
}

const declaration = {
  version: "1",
  wallet: "0x7777777777777777777777777777777777777777",
  defaultPriceAtomicUsdc: 1500,
  sources: [
    {
      url: "/research",
      priceAtomicUsdc: 2200,
      title: "Research",
      summary: "Source-backed AI payment notes.",
      tags: ["agents"],
    },
  ],
};

describe("POST /api/sources/discover", () => {
  beforeEach(() => {
    mocks.appendSource.mockReset();
    mocks.safeFetch.mockReset();
    mocks.appendSource.mockImplementation(
      async (input: SourceRegistrationInput) => ({
        source: sourceFromInput(input),
        sources: [sourceFromInput(input)],
      }),
    );
  });

  it("discovers and registers a valid tollgate.json declaration", async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      response(JSON.stringify(declaration)),
    );

    const result = await POST(
      request("https://publisher.example", "198.51.100.10"),
    );
    const body = await result.json();

    expect(result.status).toBe(201);
    expect(mocks.safeFetch).toHaveBeenCalledWith(
      new URL("https://publisher.example/.well-known/tollgate.json"),
      expect.objectContaining({
        headers: { accept: "application/json" },
      }),
    );
    expect(mocks.appendSource).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Research",
        url: "https://publisher.example/research",
        origin: "discovered",
      }),
    );
    expect(body.count).toBe(1);
    expect(body.registered[0]).toMatchObject({
      title: "Research",
      probation: true,
      origin: "discovered",
    });
    expect(body.note).toMatch(/probationary/);
  });

  it("falls back to the homepage meta tag", async () => {
    mocks.safeFetch
      .mockResolvedValueOnce(response("not found", 404, "text/plain"))
      .mockResolvedValueOnce(
        response(
          `<meta name="tollgate" content="wallet=0x8888888888888888888888888888888888888888; price=1700">`,
          200,
          "text/html",
        ),
      );

    const result = await POST(
      request("https://writer.example/post", "198.51.100.11"),
    );
    const body = await result.json();

    expect(result.status).toBe(201);
    expect(mocks.safeFetch).toHaveBeenCalledTimes(2);
    expect(mocks.appendSource).toHaveBeenCalledWith(
      expect.objectContaining({
        creator: "writer.example",
        priceAtomicUsdc: 1700,
        url: "https://writer.example/post",
        origin: "discovered",
      }),
    );
    expect(body.count).toBe(1);
  });

  it("returns 404 when no declaration is found", async () => {
    mocks.safeFetch
      .mockResolvedValueOnce(response("not found", 404, "text/plain"))
      .mockResolvedValueOnce(response("<html></html>", 200, "text/html"));

    const result = await POST(
      request("https://empty.example", "198.51.100.12"),
    );
    const body = await result.json();

    expect(result.status).toBe(404);
    expect(body.error).toBe(
      "no tollgate.json or <meta name=tollgate> found at this URL",
    );
    expect(mocks.appendSource).not.toHaveBeenCalled();
  });

  it("rejects blocked fetch targets without leaking the internal reason", async () => {
    // Both the .well-known and the HTML-fallback fetch are blocked. The
    // endpoint must NOT surface safeFetch's distinct error strings (which would
    // be an SSRF reconnaissance oracle) — it returns the generic not-found.
    mocks.safeFetch.mockRejectedValue(
      new Error("fetch target resolves to a blocked address."),
    );

    const result = await POST(
      request("http://127.0.0.1:3000", "198.51.100.13"),
    );
    const body = await result.json();

    expect(result.status).toBe(404);
    expect(body.error).toBe(
      "no tollgate.json or <meta name=tollgate> found at this URL",
    );
    expect(body.error).not.toContain("blocked address");
    expect(mocks.appendSource).not.toHaveBeenCalled();
  });

  it("caps over-large declarations to 20 registration attempts", async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      response(
        JSON.stringify({
          ...declaration,
          sources: Array.from({ length: 25 }, (_, index) => ({
            url: `/source-${index}`,
            title: `Source ${index}`,
          })),
        }),
      ),
    );

    const result = await POST(
      request("https://large.example", "198.51.100.14"),
    );
    const body = await result.json();

    expect(result.status).toBe(201);
    expect(mocks.appendSource).toHaveBeenCalledTimes(20);
    expect(body.count).toBe(20);
  });

  it("rate-limits discovery attempts after 10 requests per hour per IP", async () => {
    mocks.safeFetch.mockImplementation(async () =>
      response(JSON.stringify(declaration)),
    );

    for (let index = 0; index < 10; index += 1) {
      const result = await POST(
        request("https://limited.example", "198.51.100.15"),
      );
      expect(result.status).toBe(201);
    }

    const result = await POST(
      request("https://limited.example", "198.51.100.15"),
    );
    const body = await result.json();

    expect(result.status).toBe(429);
    expect(body.error).toBe(
      "Too many site discovery attempts. Wait an hour and retry.",
    );
  });
});
