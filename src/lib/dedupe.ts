import type { Hex } from "viem";
import { sha256Hex } from "./hash";
import type { DownloadArchiveEvent } from "./types";

export function resolveWindowBucket(createdAt: string, minutes = 10): string {
  const widthMs = minutes * 60 * 1000;
  const time = new Date(createdAt).getTime();
  return new Date(Math.floor(time / widthMs) * widthMs).toISOString();
}

export function viewerFingerprint(event: DownloadArchiveEvent): Hex {
  return sha256Hex({
    remoteAddress: event.remoteAddress,
    userAgent: event.userAgent,
  });
}

export function buildResolveEventId(
  event: DownloadArchiveEvent,
  sharedLinkId: string,
  assetId: string,
  windowMinutes = 10,
): Hex {
  return sha256Hex({
    type: "immich-download-archive",
    sharedLinkId,
    assetId,
    viewer: viewerFingerprint(event),
    window: resolveWindowBucket(event.createdAt, windowMinutes),
  });
}
