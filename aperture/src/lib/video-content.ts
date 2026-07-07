import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LinkRegistryError } from "./link-registry";
import type { LinkOriginalExtension } from "./link-originals";
import { buildWatermarkedPreview, type LinkPreview } from "./link-preview";

const execFileAsync = promisify(execFile);

export const VIDEO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

type VideoProbeOutput = {
  format?: {
    duration?: string;
    format_name?: string;
    tags?: {
      major_brand?: string;
    };
  };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
  }>;
};

type ExecFileResult =
  | string
  | Buffer
  | {
      stdout: string | Buffer;
    };

type VideoType = {
  contentType: string;
  ext: Extract<LinkOriginalExtension, "mp4" | "webm" | "mov">;
};

export type VideoEvidence = VideoType & {
  durationSeconds: number;
  width: number;
  height: number;
};

function assertVideoUploadSize(bytes: Uint8Array): void {
  if (bytes.byteLength > VIDEO_UPLOAD_MAX_BYTES) {
    throw new LinkRegistryError(
      "video is larger than the 100 MB upload cap.",
      413,
    );
  }
}

function tempVideoPath(suffix: string): string {
  return path.join(
    os.tmpdir(),
    `aperture-video-${process.pid}-${randomUUID()}${suffix}`,
  );
}

function commandFailure(command: "ffmpeg" | "ffprobe", error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  ) {
    return `${command} is not available.`;
  }
  return command === "ffprobe"
    ? "file is not a supported video."
    : "video thumbnail generation failed.";
}

function stdoutFromExecFile(result: ExecFileResult): string {
  const stdout =
    typeof result === "string" || Buffer.isBuffer(result)
      ? result
      : result.stdout;
  return stdout.toString();
}

function videoTypeFromProbe(output: VideoProbeOutput): VideoType {
  const formatName = output.format?.format_name?.toLowerCase() ?? "";
  const majorBrand = output.format?.tags?.major_brand?.trim().toLowerCase();

  if (formatName.includes("webm")) {
    return { contentType: "video/webm", ext: "webm" };
  }
  if (majorBrand === "qt") {
    return { contentType: "video/quicktime", ext: "mov" };
  }
  if (formatName.includes("mov") || formatName.includes("mp4")) {
    return { contentType: "video/mp4", ext: "mp4" };
  }
  throw new LinkRegistryError("video must be mp4, webm, or mov.");
}

export async function probeVideo(bytes: Uint8Array): Promise<VideoEvidence> {
  assertVideoUploadSize(bytes);
  const inputPath = tempVideoPath(".bin");
  try {
    await writeFile(inputPath, bytes);
    let stdout: string;
    try {
      stdout = stdoutFromExecFile(
        (await execFileAsync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "format=format_name,duration:format_tags=major_brand:stream=codec_type,width,height",
            "-of",
            "json",
            inputPath,
          ],
          { encoding: "utf8", maxBuffer: 1024 * 1024 },
        )) as ExecFileResult,
      );
    } catch (error) {
      throw new LinkRegistryError(commandFailure("ffprobe", error));
    }

    let output: VideoProbeOutput;
    try {
      output = JSON.parse(stdout) as VideoProbeOutput;
    } catch {
      throw new LinkRegistryError("video metadata could not be parsed.");
    }

    const stream = output.streams?.find(
      (candidate) => candidate.codec_type === "video",
    );
    const durationSeconds = Number.parseFloat(output.format?.duration ?? "0");
    const width = stream?.width ?? 0;
    const height = stream?.height ?? 0;
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      width <= 0 ||
      height <= 0
    ) {
      throw new LinkRegistryError("file is not a supported video.");
    }

    return {
      ...videoTypeFromProbe(output),
      durationSeconds,
      width,
      height,
    };
  } finally {
    await Promise.allSettled([rm(inputPath, { force: true })]);
  }
}

async function extractFrame(
  inputPath: string,
  outputPath: string,
  offset: "00:00:01" | "00:00:00",
): Promise<Uint8Array> {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      offset,
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=600:-1",
      outputPath,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  return new Uint8Array(await readFile(outputPath));
}

export async function buildVideoThumbnail(
  bytes: Uint8Array,
): Promise<LinkPreview> {
  assertVideoUploadSize(bytes);
  const inputPath = tempVideoPath(".bin");
  const outputPath = tempVideoPath(".webp");
  try {
    await writeFile(inputPath, bytes);
    let frame: Uint8Array;
    try {
      frame = await extractFrame(inputPath, outputPath, "00:00:01");
    } catch (firstError) {
      const firstMessage = commandFailure("ffmpeg", firstError);
      try {
        frame = await extractFrame(inputPath, outputPath, "00:00:00");
      } catch (secondError) {
        throw new LinkRegistryError(
          `${commandFailure("ffmpeg", secondError)} ${firstMessage}`,
        );
      }
    }
    try {
      return await buildWatermarkedPreview(frame);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "thumbnail frame failed.";
      throw new LinkRegistryError(`video thumbnail generation failed: ${message}`);
    }
  } finally {
    await Promise.allSettled([
      rm(inputPath, { force: true }),
      rm(outputPath, { force: true }),
    ]);
  }
}
