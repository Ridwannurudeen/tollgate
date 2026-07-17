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
  PlaybackLedger,
  ProcessWebhookResult,
  VerifiedPlaybackStart,
} from "./types.js";

const TICKS_PER_SECOND = 10_000_000;
const MAX_JELLYFIN_RESPONSE_BYTES = 1_048_576;
const JELLYFIN_REQUEST_TIMEOUT_MS = 5_000;

export type ProcessWebhookOptions = {
  registryPath: string;
  ledgerPath: string;
  sessionsPath: string;
  defaultAtomicUsdcPerMinute: number;
  feeRouter: FeeRouterAdapter;
  liveSettlement?: boolean;
  verifyPlaybackStart?: (
    event: NormalizedPlaybackEvent,
  ) => Promise<VerifiedPlaybackStart | null>;
  now?: () => Date;
  maxAtomicUsdcPerEvent?: number;
  maxDailyAtomicUsdc?: number;
};

let settlementLock: Promise<void> = Promise.resolve();

function withSettlementLock<T>(work: () => Promise<T>): Promise<T> {
  const run = settlementLock.then(work, work);
  settlementLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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

async function readLimitedJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error("Jellyfin session verification request failed.");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_JELLYFIN_RESPONSE_BYTES
  ) {
    throw new Error("Jellyfin session verification response is too large.");
  }
  if (!response.body) {
    throw new Error("Jellyfin session verification response is empty.");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_JELLYFIN_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Jellyfin session verification response is too large.");
    }
    chunks.push(Buffer.from(value));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function verifyJellyfinPlaybackStart(
  event: NormalizedPlaybackEvent,
  options: {
    serverUrl: string;
    apiKey: string;
    fetch?: typeof fetch;
  },
): Promise<VerifiedPlaybackStart | null> {
  if (!event.sessionId) return null;

  const url = new URL("Sessions", options.serverUrl);
  url.searchParams.set("activeWithinSeconds", "120");
  const response = await (options.fetch ?? fetch)(url, {
    headers: {
      accept: "application/json",
      authorization: `MediaBrowser Token="${options.apiKey}"`,
    },
    signal: AbortSignal.timeout(JELLYFIN_REQUEST_TIMEOUT_MS),
  });
  const value = await readLimitedJson(response);
  if (!Array.isArray(value)) {
    throw new Error("Jellyfin session verification response is invalid.");
  }

  const session = value.find((candidate) => {
    if (!isRecord(candidate)) return false;
    const nowPlayingItem = valueAt(candidate, "NowPlayingItem");
    const isActive = firstBoolean(candidate, ["IsActive"]);
    return (
      firstString(candidate, ["Id"]) === event.sessionId &&
      firstString(candidate, ["UserId"]) === event.userId &&
      (!event.deviceId ||
        firstString(candidate, ["DeviceId"]) === event.deviceId) &&
      isRecord(nowPlayingItem) &&
      firstString(nowPlayingItem, ["Id"]) === event.itemId &&
      isActive !== false
    );
  });
  if (!isRecord(session)) return null;

  const nowPlayingItem = valueAt(session, "NowPlayingItem");
  const playState = valueAt(session, "PlayState");
  if (!isRecord(nowPlayingItem) || !isRecord(playState)) return null;
  const playbackPositionTicks = firstNumber(playState, ["PositionTicks"]);
  const runTimeTicks = firstNumber(nowPlayingItem, ["RunTimeTicks"]);
  if (
    playbackPositionTicks === null ||
    runTimeTicks === null ||
    !Number.isSafeInteger(playbackPositionTicks) ||
    !Number.isSafeInteger(runTimeTicks) ||
    playbackPositionTicks < 0 ||
    runTimeTicks <= 0 ||
    playbackPositionTicks > runTimeTicks
  ) {
    return null;
  }

  return {
    playbackPositionTicks,
    runTimeTicks,
  };
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

function buildReceiptEventId(
  event: NormalizedPlaybackEvent,
  session: ActivePlaybackSession | null,
  liveSettlement: boolean,
): Hex {
  if (liveSettlement && session) {
    return sha256Hex({
      namespace: "tollgate-jellyfin-verified-playback-v1",
      itemId: event.itemId,
      userId: event.userId,
      sessionKey: session.key,
      rawStartHash: session.rawStartHash,
    });
  }
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
  liveSettlement: boolean,
  stoppedAt: string,
): number {
  if (liveSettlement) {
    if (
      !session?.verifiedAt ||
      !session.verifiedRunTimeTicks ||
      stop.playbackPositionTicks === null
    ) {
      return 0;
    }
    const positionDelta =
      stop.playbackPositionTicks - session.startPlaybackPositionTicks;
    const runtimeRemaining =
      session.verifiedRunTimeTicks - session.startPlaybackPositionTicks;
    if (positionDelta <= 0 || runtimeRemaining <= 0) return 0;
    return Math.min(
      ticksToSeconds(positionDelta),
      secondsBetween(session.verifiedAt, stoppedAt),
      ticksToSeconds(runtimeRemaining),
    );
  }

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

function settledAtomicUsdcOnDay(
  ledger: PlaybackLedger,
  stoppedAt: string,
): number {
  const day = stoppedAt.slice(0, 10);
  return ledger.receipts
    .filter((receipt) => receipt.stoppedAt.slice(0, 10) === day)
    .reduce((total, receipt) => total + receipt.amountAtomicUsdc, 0);
}

export async function processJellyfinWebhook(
  payload: JellyfinWebhookPayload,
  options: ProcessWebhookOptions,
): Promise<ProcessWebhookResult> {
  const event = normalizeJellyfinEvent(payload);
  if (!event) return { kind: "ignored", reason: "not a playback event" };
  const liveSettlement = options.liveSettlement === true;
  const now = options.now ?? (() => new Date());

  if (event.kind === "playback-start") {
    if (liveSettlement) {
      if (!options.verifyPlaybackStart) {
        return {
          kind: "unresolved",
          event,
          reason: "Jellyfin playback verification is not configured",
        };
      }
      let verification: VerifiedPlaybackStart | null;
      try {
        verification = await options.verifyPlaybackStart(event);
      } catch {
        return {
          kind: "unresolved",
          event,
          reason: "Jellyfin playback verification is unavailable",
        };
      }
      if (!verification) {
        return {
          kind: "unresolved",
          event,
          reason: "active playback was not verified by Jellyfin",
        };
      }
      const session = await upsertPlaybackSession(
        event,
        options.sessionsPath,
        {
          ...verification,
          verifiedAt: now().toISOString(),
        },
      );
      return { kind: "started", session };
    }

    const session = await upsertPlaybackSession(event, options.sessionsPath);
    return { kind: "started", session };
  }

  const receivedAt = liveSettlement ? now().toISOString() : event.timestamp;
  return withSettlementLock(async () => {
    const ledger = await readPlaybackLedger(options.ledgerPath);
    const session = await findPlaybackSession(event, options.sessionsPath);
    if (liveSettlement && !session?.verifiedAt) {
      const duplicate = ledger.receipts.find(
        (receipt) => receipt.rawStopHash === event.rawHash,
      );
      if (duplicate) {
        return { kind: "settled", receipt: duplicate, created: false };
      }
      return {
        kind: "ignored",
        reason: "verified playback start is required",
      };
    }

    const eventId = buildReceiptEventId(event, session, liveSettlement);
    const existing = ledger.receipts.find(
      (receipt) => receipt.eventId === eventId,
    );
    if (existing) {
      if (liveSettlement) {
        await removePlaybackSession(event, options.sessionsPath);
      }
      return { kind: "settled", receipt: existing, created: false };
    }

    const registry = await readCreatorRegistry(options.registryPath);
    const creator = findCreatorForItem(registry, event.itemId);
    if (!creator) {
      return { kind: "unresolved", event, reason: "item not in registry" };
    }
    if (creator.approvalStatus === "pending") {
      return { kind: "unresolved", event, reason: "creator wallet is pending" };
    }

    const stoppedAt = receivedAt;
    const seconds = watchedSeconds(
      session,
      event,
      liveSettlement,
      stoppedAt,
    );
    const minutes = watchedMinutes(seconds);
    if (minutes === 0) {
      if (liveSettlement) {
        await removePlaybackSession(event, options.sessionsPath);
      }
      return { kind: "ignored", reason: "watch duration is zero" };
    }

    const priceAtomicUsdcPerMinute =
      creator.priceAtomicUsdcPerMinute ?? options.defaultAtomicUsdcPerMinute;
    const amountAtomicUsdc = minutes * priceAtomicUsdcPerMinute;
    if (!Number.isSafeInteger(amountAtomicUsdc)) {
      if (liveSettlement) {
        await removePlaybackSession(event, options.sessionsPath);
      }
      return { kind: "ignored", reason: "settlement amount is invalid" };
    }
    if (liveSettlement) {
      if (
        !options.maxAtomicUsdcPerEvent ||
        !options.maxDailyAtomicUsdc
      ) {
        await removePlaybackSession(event, options.sessionsPath);
        return {
          kind: "ignored",
          reason: "live settlement caps are not configured",
        };
      }
      if (amountAtomicUsdc > options.maxAtomicUsdcPerEvent) {
        await removePlaybackSession(event, options.sessionsPath);
        return {
          kind: "ignored",
          reason: "per-event live settlement cap exceeded",
        };
      }
      if (
        settledAtomicUsdcOnDay(ledger, stoppedAt) + amountAtomicUsdc >
        options.maxDailyAtomicUsdc
      ) {
        await removePlaybackSession(event, options.sessionsPath);
        return {
          kind: "ignored",
          reason: "daily live settlement cap exceeded",
        };
      }
    }

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
      itemName: creator.title ?? event.itemName,
      itemType: event.itemType,
      userId: event.userId,
      sessionId: session?.sessionId ?? event.sessionId,
      creator: creator.displayName,
      wallet: creator.wallet,
      watchedSeconds: Math.round(seconds),
      watchedMinutes: minutes,
      priceAtomicUsdcPerMinute,
      amountAtomicUsdc,
      settlement,
      startedAt: session?.startedAt ?? event.timestamp,
      stoppedAt,
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
  });
}
