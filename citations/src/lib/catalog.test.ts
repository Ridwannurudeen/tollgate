import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendSource } from "./catalog";
import type { SourceRegistrationInput } from "./types";

const mocks = vi.hoisted(() => ({
  readRsshubSources: vi.fn(),
  safeFetch: vi.fn(),
}));

vi.mock("./safe-fetch", () => ({
  safeFetch: mocks.safeFetch,
}));

vi.mock("./sources/rsshub", () => ({
  readRsshubSources: mocks.readRsshubSources,
}));

const sourceInput: SourceRegistrationInput = {
  title: "Evidence Registration Source",
  creator: "Evidence Lab",
  handle: "@evidence",
  wallet: "0x7777777777777777777777777777777777777777",
  url: "https://example.com/evidence",
  summary: "Registered source used to test content hashing at registration.",
  tags: ["evidence", "registration"],
  priceAtomicUsdc: 1_500,
};

function response(
  body: string,
  status = 200,
  contentType = "text/html",
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

function restoreFetchEnv(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.TOLLGATE_REGISTRATION_FETCH;
  } else {
    process.env.TOLLGATE_REGISTRATION_FETCH = previous;
  }
}

async function withTempRegistry<T>(
  test: (filePath: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-sources-"));
  try {
    return await test(path.join(dir, "sources.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("appendSource registration content evidence", () => {
  beforeEach(() => {
    mocks.readRsshubSources.mockReset();
    mocks.readRsshubSources.mockResolvedValue([]);
    mocks.safeFetch.mockReset();
  });

  it("fetches and stores content evidence by default", async () => {
    const previous = process.env.TOLLGATE_REGISTRATION_FETCH;
    delete process.env.TOLLGATE_REGISTRATION_FETCH;
    mocks.safeFetch.mockResolvedValueOnce(
      response("<html><body>paid source</body></html>"),
    );

    try {
      await withTempRegistry(async (filePath) => {
        const result = await appendSource(sourceInput, filePath);

        expect(mocks.safeFetch).toHaveBeenCalledWith(
          new URL("https://example.com/evidence"),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(result.source.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(result.source.contentFetchedAt).toBeTruthy();
      });
    } finally {
      restoreFetchEnv(previous);
    }
  });

  it("skips content evidence when registration fetch is explicitly disabled", async () => {
    const previous = process.env.TOLLGATE_REGISTRATION_FETCH;
    process.env.TOLLGATE_REGISTRATION_FETCH = "0";

    try {
      await withTempRegistry(async (filePath) => {
        const result = await appendSource(sourceInput, filePath);

        expect(mocks.safeFetch).not.toHaveBeenCalled();
        expect(result.source.contentHash).toBeUndefined();
        expect(result.source.contentFetchedAt).toBeUndefined();
      });
    } finally {
      restoreFetchEnv(previous);
    }
  });

  it("keeps registration working when content evidence cannot be fetched", async () => {
    const previous = process.env.TOLLGATE_REGISTRATION_FETCH;
    delete process.env.TOLLGATE_REGISTRATION_FETCH;
    mocks.safeFetch.mockRejectedValueOnce(new Error("blocked"));

    try {
      await withTempRegistry(async (filePath) => {
        const result = await appendSource(sourceInput, filePath);

        expect(result.source.id).toBe("evidence-registration-source");
        expect(result.source.contentHash).toBeUndefined();
        expect(result.source.contentFetchedAt).toBeUndefined();
      });
    } finally {
      restoreFetchEnv(previous);
    }
  });

  it("omits content evidence for non-HTML responses", async () => {
    const previous = process.env.TOLLGATE_REGISTRATION_FETCH;
    delete process.env.TOLLGATE_REGISTRATION_FETCH;
    mocks.safeFetch.mockResolvedValueOnce(
      response("{}", 200, "application/json"),
    );

    try {
      await withTempRegistry(async (filePath) => {
        const result = await appendSource(sourceInput, filePath);

        expect(result.source.contentHash).toBeUndefined();
        expect(result.source.contentFetchedAt).toBeUndefined();
      });
    } finally {
      restoreFetchEnv(previous);
    }
  });
});
