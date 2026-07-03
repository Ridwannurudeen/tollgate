import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ActivePlaybackSession,
  NormalizedPlaybackEvent,
  SessionStore,
} from "./types.js";

const EMPTY_STORE: SessionStore = { sessions: [] };
let sessionWriteLock: Promise<void> = Promise.resolve();

function isSessionStore(value: unknown): value is SessionStore {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as Record<string, unknown>).sessions);
}

function withSessionWriteLock<T>(write: () => Promise<T>): Promise<T> {
  const run = sessionWriteLock.then(write, write);
  sessionWriteLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function sessionKeyForEvent(event: NormalizedPlaybackEvent): string {
  return [
    event.itemId,
    event.userId,
    event.sessionId ?? event.deviceId ?? "no-session",
  ].join(":");
}

export async function readSessionStore(filePath: string): Promise<SessionStore> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isSessionStore(parsed) ? parsed : EMPTY_STORE;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_STORE;
    throw error;
  }
}

async function writeSessionStore(
  store: SessionStore,
  filePath: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

export async function upsertPlaybackSession(
  event: NormalizedPlaybackEvent,
  filePath: string,
): Promise<ActivePlaybackSession> {
  return withSessionWriteLock(async () => {
    const session: ActivePlaybackSession = {
      key: sessionKeyForEvent(event),
      itemId: event.itemId,
      itemName: event.itemName,
      itemType: event.itemType,
      userId: event.userId,
      sessionId: event.sessionId,
      deviceId: event.deviceId,
      clientName: event.clientName,
      startedAt: event.timestamp,
      startPlaybackPositionTicks: event.playbackPositionTicks ?? 0,
      rawStartHash: event.rawHash,
    };
    const store = await readSessionStore(filePath);
    await writeSessionStore(
      {
        sessions: [
          session,
          ...store.sessions.filter((entry) => entry.key !== session.key),
        ],
      },
      filePath,
    );
    return session;
  });
}

export async function findPlaybackSession(
  event: NormalizedPlaybackEvent,
  filePath: string,
): Promise<ActivePlaybackSession | null> {
  const store = await readSessionStore(filePath);
  const key = sessionKeyForEvent(event);
  return store.sessions.find((entry) => entry.key === key) ?? null;
}

export async function removePlaybackSession(
  event: NormalizedPlaybackEvent,
  filePath: string,
): Promise<void> {
  await withSessionWriteLock(async () => {
    const store = await readSessionStore(filePath);
    const key = sessionKeyForEvent(event);
    await writeSessionStore(
      { sessions: store.sessions.filter((entry) => entry.key !== key) },
      filePath,
    );
  });
}
