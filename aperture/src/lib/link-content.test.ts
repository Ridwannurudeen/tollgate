import { describe, expect, it } from "vitest";
import {
  LINK_DOWNLOAD_MAX_BYTES,
  fetchImageBytes,
  probeImageSource,
} from "./link-content";

const publicResolve = async () => ["93.184.216.34"];

describe("link image content", () => {
  it("rejects private-IP image URLs through safeFetch", async () => {
    await expect(
      probeImageSource("http://127.0.0.1/photo.jpg"),
    ).rejects.toThrow(/not allowed/);
  });

  it("rejects non-image content types before charging", async () => {
    const fetchImpl = (async () =>
      new Response("html", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    await expect(
      probeImageSource("https://photos.example.com/page", {
        fetchImpl,
        resolveHost: publicResolve,
      }),
    ).rejects.toThrow(/jpeg, png, webp, gif, avif, or tiff/);
  });

  it("captures image content evidence from the first bytes", async () => {
    const fetchImpl = (async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      })) as unknown as typeof fetch;

    const evidence = await probeImageSource(
      "https://photos.example.com/a.png",
      {
        fetchImpl,
        resolveHost: publicResolve,
      },
    );

    expect(evidence.contentType).toBe("image/png");
    expect(evidence.sourceContentHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects streams that exceed the download cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(LINK_DOWNLOAD_MAX_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const fetchImpl = (async () =>
      new Response(stream, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })) as unknown as typeof fetch;

    await expect(
      fetchImageBytes("https://photos.example.com/large.jpg", {
        fetchImpl,
        resolveHost: publicResolve,
      }),
    ).rejects.toThrow(/download cap/);
  });
});
