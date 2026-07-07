import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { findLink, readLinks, type LinkRecord } from "./link-registry";
import { readWalletRegistry } from "./registry";

const MESSAGES_PATH = path.join(process.cwd(), "data", "messages.json");
const EMPTY_MESSAGES: MessageStore = { messages: [] };
export const MAX_MESSAGE_LENGTH = 2000;
let messageWriteLock: Promise<void> = Promise.resolve();

export type ChatMessage = {
  id: string;
  linkId: string;
  buyerOwnerId: string;
  senderOwnerId: string;
  body: string;
  createdAt: string;
  readBy?: string[];
};

export type MessageStore = {
  messages: ChatMessage[];
};

export type MessagePaths = {
  messagePath?: string;
  linkPath?: string;
  registryPath?: string;
};

export type ThreadSummary = {
  linkId: string;
  buyerOwnerId: string;
  sellerOwnerId: string;
  linkTitle: string;
  counterpartyOwnerId: string;
  counterpartyName: string;
  viewerRole: "buyer" | "seller";
  latestMessage: string;
  latestAt: string;
  unreadCount: number;
};

export class MessageError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.linkId === "string" &&
    typeof record.buyerOwnerId === "string" &&
    typeof record.senderOwnerId === "string" &&
    typeof record.body === "string" &&
    typeof record.createdAt === "string" &&
    (record.readBy === undefined ||
      (Array.isArray(record.readBy) &&
        record.readBy.every((ownerId) => typeof ownerId === "string")))
  );
}

function parseMessages(value: unknown): MessageStore {
  if (!value || typeof value !== "object") return EMPTY_MESSAGES;
  const messages = (value as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return EMPTY_MESSAGES;
  return { messages: messages.filter(isChatMessage) };
}

function ordered(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

async function requireLink(
  linkId: string,
  linkPath?: string,
): Promise<LinkRecord> {
  const link = await findLink(linkId, linkPath);
  if (!link) throw new MessageError("link not found", 404);
  return link;
}

function ensureThreadParticipant(
  link: LinkRecord,
  buyerOwnerId: string,
  ownerId: string,
): "buyer" | "seller" {
  if (!buyerOwnerId.trim()) {
    throw new MessageError("buyerOwnerId is required.");
  }
  if (buyerOwnerId === link.ownerId) {
    throw new MessageError("seller cannot message themselves.");
  }
  if (ownerId === buyerOwnerId) return "buyer";
  if (ownerId === link.ownerId) return "seller";
  throw new MessageError("not a participant in this thread.", 403);
}

export async function readMessages(
  filePath: string = MESSAGES_PATH,
): Promise<MessageStore> {
  try {
    return parseMessages(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_MESSAGES;
    throw error;
  }
}

export async function writeMessages(
  store: MessageStore,
  filePath: string = MESSAGES_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

export function withMessagesWriteLock<T>(
  write: () => Promise<T>,
): Promise<T> {
  const run = messageWriteLock.then(write, write);
  messageWriteLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function sendMessage(
  {
    linkId,
    buyerOwnerId,
    senderOwnerId,
    body,
  }: {
    linkId: string;
    buyerOwnerId: string;
    senderOwnerId: string;
    body: string;
  },
  paths: MessagePaths = {},
): Promise<ChatMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new MessageError("message body is required.");
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new MessageError(
      `message body must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    );
  }
  const link = await requireLink(linkId, paths.linkPath);
  ensureThreadParticipant(link, buyerOwnerId, senderOwnerId);

  return withMessagesWriteLock(async () => {
    const store = await readMessages(paths.messagePath);
    const message: ChatMessage = {
      id: randomUUID(),
      linkId,
      buyerOwnerId,
      senderOwnerId,
      body: trimmed,
      createdAt: new Date().toISOString(),
      readBy: [senderOwnerId],
    };
    await writeMessages(
      { messages: [...store.messages, message] },
      paths.messagePath,
    );
    return message;
  });
}

export async function readThread(
  linkId: string,
  buyerOwnerId: string,
  filePath?: string,
): Promise<ChatMessage[]> {
  const store = await readMessages(filePath);
  return ordered(
    store.messages.filter(
      (message) =>
        message.linkId === linkId && message.buyerOwnerId === buyerOwnerId,
    ),
  );
}

export async function readThreadsForOwner(
  ownerId: string,
  paths: MessagePaths = {},
): Promise<ThreadSummary[]> {
  const [store, links, registry] = await Promise.all([
    readMessages(paths.messagePath),
    readLinks(paths.linkPath),
    readWalletRegistry(paths.registryPath),
  ]);
  const linkById = new Map(links.links.map((link) => [link.id, link]));
  const nameByOwner = new Map(
    registry.photographers.map((entry) => [entry.ownerId, entry.displayName]),
  );
  const byThread = new Map<string, ChatMessage[]>();
  for (const message of store.messages) {
    const link = linkById.get(message.linkId);
    if (!link) continue;
    if (message.buyerOwnerId !== ownerId && link.ownerId !== ownerId) continue;
    const key = `${message.linkId}:${message.buyerOwnerId}`;
    byThread.set(key, [...(byThread.get(key) ?? []), message]);
  }

  return Array.from(byThread.values())
    .map((messages) => {
      const thread = ordered(messages);
      const latest = thread[thread.length - 1];
      const link = linkById.get(latest.linkId);
      if (!link) return null;
      const viewerRole = latest.buyerOwnerId === ownerId ? "buyer" : "seller";
      const counterpartyOwnerId =
        viewerRole === "buyer" ? link.ownerId : latest.buyerOwnerId;
      const unreadCount = thread.filter(
        (message) =>
          message.senderOwnerId !== ownerId &&
          !(message.readBy ?? []).includes(ownerId),
      ).length;
      return {
        linkId: latest.linkId,
        buyerOwnerId: latest.buyerOwnerId,
        sellerOwnerId: link.ownerId,
        linkTitle: link.title,
        counterpartyOwnerId,
        counterpartyName:
          nameByOwner.get(counterpartyOwnerId) ?? counterpartyOwnerId,
        viewerRole,
        latestMessage: latest.body,
        latestAt: latest.createdAt,
        unreadCount,
      } satisfies ThreadSummary;
    })
    .filter((thread): thread is ThreadSummary => thread !== null)
    .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt));
}

export async function markThreadRead(
  linkId: string,
  buyerOwnerId: string,
  readerOwnerId: string,
  paths: MessagePaths = {},
): Promise<ChatMessage[]> {
  const link = await requireLink(linkId, paths.linkPath);
  ensureThreadParticipant(link, buyerOwnerId, readerOwnerId);

  return withMessagesWriteLock(async () => {
    const store = await readMessages(paths.messagePath);
    const messages = store.messages.map((message) => {
      if (message.linkId !== linkId || message.buyerOwnerId !== buyerOwnerId) {
        return message;
      }
      const readBy = new Set(message.readBy ?? []);
      readBy.add(readerOwnerId);
      return { ...message, readBy: Array.from(readBy) };
    });
    await writeMessages({ messages }, paths.messagePath);
    return ordered(
      messages.filter(
        (message) =>
          message.linkId === linkId && message.buyerOwnerId === buyerOwnerId,
      ),
    );
  });
}
