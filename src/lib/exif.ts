import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExifCredit, ImmichAsset } from "./types";

const execFileAsync = promisify(execFile);

export type ExifToolRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

async function defaultExifToolRunner(
  command: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync(command, [...args], {
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseExifCreditJson(
  stdout: string,
  sourcePath: string,
): ExifCredit | null {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed) || !isRecord(parsed[0])) return null;

  const artist =
    stringField(parsed[0], "Artist") ?? stringField(parsed[0], "By-line");
  const copyright = stringField(parsed[0], "Copyright");
  if (!artist && !copyright) return null;

  return { sourcePath, artist, copyright };
}

export function hostPathForImmichOriginal(originalPath: string): string {
  const libraryRoot =
    process.env.APERTURE_IMMICH_LIBRARY_ROOT ?? "/opt/immich/library";
  return originalPath.startsWith("/data/")
    ? `${libraryRoot}${originalPath.slice("/data".length)}`
    : originalPath;
}

export async function readExifCredit(
  sourcePath: string,
  options: { exiftoolPath?: string; runner?: ExifToolRunner } = {},
): Promise<ExifCredit | null> {
  const exiftoolPath =
    options.exiftoolPath ?? process.env.APERTURE_EXIFTOOL_PATH ?? "exiftool";
  const runner = options.runner ?? defaultExifToolRunner;
  const stdout = await runner(exiftoolPath, [
    "-json",
    "-Artist",
    "-By-line",
    "-Copyright",
    sourcePath,
  ]);
  return parseExifCreditJson(stdout, sourcePath);
}

export async function readAssetExifCredit(
  asset: ImmichAsset,
): Promise<ExifCredit | null> {
  if (!asset.originalPath) return null;
  try {
    return await readExifCredit(hostPathForImmichOriginal(asset.originalPath));
  } catch {
    return null;
  }
}
