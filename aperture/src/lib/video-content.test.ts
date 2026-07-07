import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIDEO_UPLOAD_MAX_BYTES,
  buildVideoThumbnail,
  probeVideo,
} from "./video-content";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
  buildWatermarkedPreview: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  rm: mocks.rm,
  writeFile: mocks.writeFile,
}));

vi.mock("./link-preview", () => ({
  buildWatermarkedPreview: mocks.buildWatermarkedPreview,
}));

function ffprobeOutput(formatName = "mov,mp4,m4a,3gp,3g2,mj2") {
  return JSON.stringify({
    format: { duration: "2.000000", format_name: formatName },
    streams: [{ codec_type: "video", width: 320, height: 240 }],
  });
}

function completeExec(stdout = "") {
  return (...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") {
      callback(null, stdout, "");
    }
  };
}

function failExec(error: Error & { code?: string }) {
  return (...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") {
      callback(error, "", "");
    }
  };
}

describe("video content", () => {
  beforeEach(() => {
    mocks.execFile.mockReset();
    mocks.readFile.mockReset();
    mocks.rm.mockReset();
    mocks.writeFile.mockReset();
    mocks.buildWatermarkedPreview.mockReset();
    mocks.rm.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(new Uint8Array([4, 5, 6]));
    mocks.buildWatermarkedPreview.mockResolvedValue({
      bytes: new Uint8Array([7, 8, 9]),
      contentType: "image/webp",
    });
  });

  it("probes decodable mp4 video metadata through ffprobe", async () => {
    mocks.execFile.mockImplementation(completeExec(ffprobeOutput()));

    const evidence = await probeVideo(new Uint8Array([1, 2, 3]));

    expect(evidence).toEqual({
      contentType: "video/mp4",
      ext: "mp4",
      durationSeconds: 2,
      width: 320,
      height: 240,
    });
    expect(mocks.execFile).toHaveBeenCalledWith(
      "ffprobe",
      expect.arrayContaining(["-of", "json"]),
      expect.objectContaining({ encoding: "utf8" }),
      expect.any(Function),
    );
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("maps webm and quicktime containers from ffprobe output", async () => {
    mocks.execFile.mockImplementationOnce(completeExec(ffprobeOutput("webm")));
    await expect(probeVideo(new Uint8Array([1]))).resolves.toMatchObject({
      contentType: "video/webm",
      ext: "webm",
    });

    mocks.execFile.mockImplementationOnce(
      completeExec(
        JSON.stringify({
          format: {
            duration: "2.000000",
            format_name: "mov,mp4,m4a,3gp,3g2,mj2",
            tags: { major_brand: "qt  " },
          },
          streams: [{ codec_type: "video", width: 320, height: 240 }],
        }),
      ),
    );
    await expect(probeVideo(new Uint8Array([1]))).resolves.toMatchObject({
      contentType: "video/quicktime",
      ext: "mov",
    });
  });

  it("rejects oversized videos before temp writes or probing", async () => {
    const oversized = {
      byteLength: VIDEO_UPLOAD_MAX_BYTES + 1,
    } as Uint8Array;

    await expect(probeVideo(oversized)).rejects.toMatchObject({ status: 413 });
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("turns missing ffprobe into a clear validation error", async () => {
    const error = new Error("spawn ffprobe ENOENT") as Error & { code: string };
    error.code = "ENOENT";
    mocks.execFile.mockImplementation(failExec(error));

    await expect(probeVideo(new Uint8Array([1]))).rejects.toThrow(
      "ffprobe is not available.",
    );
  });

  it("extracts a thumbnail with ffmpeg fallback and watermarks the frame", async () => {
    mocks.execFile
      .mockImplementationOnce(failExec(new Error("short clip")))
      .mockImplementationOnce(completeExec(""));

    const preview = await buildVideoThumbnail(new Uint8Array([1, 2, 3]));

    expect(mocks.execFile).toHaveBeenNthCalledWith(
      1,
      "ffmpeg",
      expect.arrayContaining(["-ss", "00:00:01"]),
      expect.any(Object),
      expect.any(Function),
    );
    expect(mocks.execFile).toHaveBeenNthCalledWith(
      2,
      "ffmpeg",
      expect.arrayContaining(["-ss", "00:00:00"]),
      expect.any(Object),
      expect.any(Function),
    );
    expect(mocks.buildWatermarkedPreview).toHaveBeenCalledWith(
      new Uint8Array([4, 5, 6]),
    );
    expect(preview).toEqual({
      bytes: new Uint8Array([7, 8, 9]),
      contentType: "image/webp",
    });
    expect(mocks.rm).toHaveBeenCalledTimes(2);
  });
});
