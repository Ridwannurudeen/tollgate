import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendSource,
  fetchSourceContentExcerpt,
  htmlToText,
  refetchCustomSourceContent,
} from "./catalog";
import type { CreatorSource, SourceRegistrationInput } from "./types";

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
        expect(result.source.contentExcerpt).toBe("paid source");
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
        expect(result.source.contentExcerpt).toBeUndefined();
      });
    } finally {
      restoreFetchEnv(previous);
    }
  });

  it("extracts readable text, decodes entities, and removes script/style blocks", async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      response(`
        <html>
          <head>
            <style>.hidden { display: none; }</style>
            <script>window.evil = true;</script>
          </head>
          <body>
            <h1>Real &amp; useful &#39;source&#39;</h1>
            <p>Alpha&nbsp;&lt;Beta&gt; &quot;Gamma&quot;</p>
          </body>
        </html>
      `),
    );

    const result = await fetchSourceContentExcerpt(
      "https://example.com/article",
    );

    expect(result.contentExcerpt).toBe(
      `Real & useful 'source' Alpha <Beta> "Gamma"`,
    );
    expect(result.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.contentFetchedAt).toBeTruthy();
    expect(result.contentExcerpt).not.toContain("window.evil");
    expect(result.contentExcerpt).not.toContain("display: none");
  });

  it("caps extracted content excerpts at 2000 characters", async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      response(`<main>${"a".repeat(2_100)}</main>`),
    );

    const result = await fetchSourceContentExcerpt(
      "https://example.com/long-article",
    );

    expect(result.contentExcerpt).toHaveLength(2_000);
  });

  it("returns no excerpt for unsupported content types", async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      response("plain text", 200, "text/plain"),
    );

    const result = await fetchSourceContentExcerpt(
      "https://example.com/plain.txt",
    );

    expect(result.contentHash).toBeUndefined();
    expect(result.contentFetchedAt).toBeUndefined();
    expect(result.contentExcerpt).toBeUndefined();
  });

  it("collapses XML text nodes into a readable excerpt", () => {
    expect(
      htmlToText(
        "<rss><channel><title>Feed &amp; title</title><item><description>Post&nbsp;body</description></item></channel></rss>",
      ),
    ).toBe("Feed & title Post body");
  });

  it("backfills existing external sources with fetched content excerpts", async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      response(
        "<article><h1>Backfilled page</h1><p>Real article text.</p></article>",
      ),
    );

    await withTempRegistry(async (filePath) => {
      const existingSource: CreatorSource = {
        id: "existing-source",
        title: "Existing Source",
        creator: "Evidence Lab",
        handle: "@evidence",
        wallet: "0x7777777777777777777777777777777777777777",
        url: "https://example.com/evidence",
        summary: "Existing summary.",
        tags: ["evidence", "registration"],
        priceAtomicUsdc: 1_500,
        sourceKind: "external",
        creatorKind: "external",
        verifiedCreator: false,
      };
      await writeFile(
        filePath,
        `${JSON.stringify([existingSource], null, 2)}\n`,
      );

      const result = await refetchCustomSourceContent({ filePath });
      const updated = JSON.parse(await readFile(filePath, "utf8")) as Array<{
        contentExcerpt?: string;
        contentHash?: string;
        contentFetchedAt?: string;
      }>;

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(updated[0]?.contentExcerpt).toBe(
        "Backfilled page Real article text.",
      );
      expect(updated[0]?.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(updated[0]?.contentFetchedAt).toBeTruthy();
    });
  });
});
