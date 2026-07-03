import { sha256Hex } from "./hash.js";
import {
  appendPlaybackReceipt,
  readPlaybackLedger,
  type PlaybackReceiptInput,
} from "./ledger.js";
import { findCreatorForItem, readCreatorRegistry } from "./registry.js";
import {
  findPlaybackSession,
  removePlaybackSession,
  upsertPlaybackSession,
} from "./session-store.js";
import type {
  ActivePlaybackSession,
  FeeRouterAdapter,
  Hex,
  JellyfinWebhookPayload,
  NormalizedPlaybackEvent,
  PlaybackEventKind,
  ProcessWebhookResult,
} from "./types.js";

const TICKS_PER_SECOND = 10_000_000;

export type ProcessWebhookOptions = {
  registryPath: string;
  ledgerPath: string;
  sessionsPath: string;
  defaultAtomicUsdcPerMinute: number;
  feeRouter: FeeRouterAdapter;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueAt(record: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = record;

  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    const direct = current[part];
    if (direct !== undefined) {
      current = direct;
      continue;
    }
    const found = Object.entries(current).find(
      ([candidate]) => candidate.toLowerCase() === part.toLowerCase(),
    );
    current = found?.[1];
  }

  return current;
}

function firstValue(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    const value = valueAt(record, key);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  const value = firstValue(record, keys);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function firstNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  const value = firstValue(record, keys);
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function firstBoolean(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | null {
  const value = firstValue(record, keys);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

function parseEventKind(notificationType: string): PlaybackEventKind | null {
  const normalized = notificationType.toLowerCase().replace(/[^a-z]/g, "");
  if (
    normalized === "playbackstart" ||
    normalized === "playbackstarted" ||
    normalized === "playstart"
  ) {
    return "playback-start";
  }
  if (
    normalized === "playbackstop" ||
    normalized === "playbackstopped" ||
    normalized === "playbackend" ||
    normalized === "playbackended" ||
    normalized === "playended"
  ) {
    return "playback-stop";
  }
  return null;
}

function isoTimestamp(value: string | null): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function normalizeJellyfinEvent(
  payload: JellyfinWebhookPayload,
): NormalizedPlaybackEvent | null {
  const notificationType = firstString(payload, [
    "NotificationType",
    "notificationType",
    "Event",
    "event",
    "eventName",
    "type",
  ]);
  if (!notificationType) return null;

  const kind = parseEventKind(notificationType);
  if (!kind) return null;

  const itemId = firstString(payload, [
    "ItemId",
    "ItemID",
    "itemId",
    "item.id",
    "VideoId",
    "videoId",
  ]);
  const userId = firstString(payload, ["UserId", "userId", "user.id"]);
  if (!itemId || !userId) return null;

  return {
    kind,
    notificationType,
    itemId,
    itemName:
      firstString(payload, ["Name", "ItemName", "Title", "item.name"]) ??
      "Untitled",
    itemType:
      firstString(payload, ["ItemType", "MediaType", "item.type"]) ??
      "Unknown",
    userId,
    sessionId: firstString(payload, ["Id", "SessionId", "sessionId", "session.id"]),
    deviceId: firstString(payload, ["DeviceId", "deviceId"]),
    clientName: firstString(payload, ["ClientName", "Client", "clientName"]),
    timestamp: isoTimestamp(
      firstString(payload, ["UtcTimestamp", "Timestamp", "Date", "createdAt"]),
    ),
    playbackPositionTicks: firstNumber(payload, [
      "PlaybackPositionTicks",
      "playbackPositionTicks",
      "PositionTicks",
      "positionTicks",
    ]),
    runTimeTicks: firstNumber(payload, ["RunTimeTicks", "runtimeTicks"]),
    playedToCompletion: firstBoolean(payload, [
      "PlayedToCompletion",
      "playedToCompletion",
      "Finished",
    ]),
    rawHash: sha256Hex(payload),
    raw: payload,
  };
}

function buildReceiptEventId(event: NormalizedPlaybackEvent): Hex {
  const explicitId = firstString(event.raw, [
    "EventId",
    "eventId",
    "WebhookEventId",
    "NotificationId",
  ]);
  return sha256Hex(
    explicitId ?? {
      namespace: "tollgate-jellyfin-playback-stop-v1",
      itemId: event.itemId,
      userId: event.userId,
      sessionId: event.sessionId,
      deviceId: event.deviceId,
      stoppedAt: event.timestamp,
      playbackPositionTicks: event.playbackPositionTicks,
    },
  );
}

function ticksToSeconds(ticks: number): number {
  return Math.max(0, ticks / TICKS_PER_SECOND);
}

function secondsBetween(startedAt: string, stoppedAt: string): number {
  const start = new Date(startedAt).getTime();
  const stop = new Date(stoppedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(stop) || stop <= start) return 0;
  return (stop - start) / 1000;
}

function watchedSeconds(
  session: ActivePlaybackSession | null,
  stop: NormalizedPlaybackEvent,
): number {
  const startPosition = session?.startPlaybackPositionTicks ?? 0;
  if (stop.playbackPositionTicks !== null) {
    const delta = stop.playbackPositionTicks - startPosition;
    if (delta > 0) return ticksToSeconds(delta);
  }

  if (session) {
    const elapsed = secondsBetween(session.startedAt, stop.timestamp);
    if (elapsed > 0) return elapsed;
  }

  if (stop.playedToCompletion && stop.runTimeTicks && stop.runTimeTicks > 0) {
    return ticksToSeconds(stop.runTimeTicks);
  }

  return 0;
}

function watchedMinutes(seconds: number): number {
  return seconds > 0 ? Math.ceil(seconds / 60) : 0;
}

export async function processJellyfinWebhook(
  payload: JellyfinWebhookPayload,
  options: ProcessWebhookOptions,
): Promise<ProcessWebhookResult> {
  const event = normalizeJellyfinEvent(payload);
  if (!event) return { kind: "ignored", reason: "not a playback event" };

  if (event.kind === "playback-start") {
    const session = await upsertPlaybackSession(event, options.sessionsPath);
    return { kind: "started", session };
  }

  const eventId = buildReceiptEventId(event);
  const ledger = await readPlaybackLedger(options.ledgerPath);
  const existing = ledger.receipts.find((receipt) => receipt.eventId === eventId);
  if (existing) return { kind: "settled", receipt: existing, created: false };

  const registry = await readCreatorRegistry(options.registryPath);
  const creator = findCreatorForItem(registry, event.itemId);
  if (!creator) return { kind: "unresolved", event, reason: "item not in registry" };
  if (creator.approvalStatus === "pending") {
    return { kind: "unresolved", event, reason: "creator wallet is pending" };
  }

  const session = await findPlaybackSession(event, options.sessionsPath);
  const seconds = watchedSeconds(session, event);
  const minutes = watchedMinutes(seconds);
  if (minutes === 0) {
    return { kind: "ignored", reason: "watch duration is zero" };
  }

  const priceAtomicUsdcPerMinute =
    creator.priceAtomicUsdcPerMinute ?? options.defaultAtomicUsdcPerMinute;
  const amountAtomicUsdc = minutes * priceAtomicUsdcPerMinute;
  const settlement = await options.feeRouter.settle({
    wallet: creator.wallet,
    amountAtomicUsdc,
    itemId: event.itemId,
    eventId,
    watchedMinutes: minutes,
  });

  const input: PlaybackReceiptInput = {
    eventId,
    itemId: event.itemId,
    itemName: event.itemName,
    itemType: event.itemType,
    userId: event.userId,
    sessionId: event.sessionId,
    creator: creator.displayName,
    wallet: creator.wallet,
    watchedSeconds: Math.round(seconds),
    watchedMinutes: minutes,
    priceAtomicUsdcPerMinute,
    amountAtomicUsdc,
    settlement,
    startedAt: session?.startedAt ?? event.timestamp,
    stoppedAt: event.timestamp,
    rawStartHash: session?.rawStartHash ?? null,
    rawStopHash: event.rawHash,
  };
  const result = await appendPlaybackReceipt(input, options.ledgerPath);
  await removePlaybackSession(event, options.sessionsPath);

  return {
    kind: "settled",
    receipt: result.receipt,
    created: result.created,
  };
}
