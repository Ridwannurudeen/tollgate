# Codex scope — buyer/seller messaging on Aperture

Add a simple, safe messaging channel between a prospective buyer and a photo/video's seller — for pre-purchase questions (licensing terms, usage rights, custom requests) or post-purchase follow-up. Polling-based (no websockets), text-only, reusing the existing account/session system entirely — no new identity concept.

All in `aperture/`. Read every file before editing — especially `link-registry.ts` (atomic write/lock pattern), `account.ts` (`getSessionOwner`), `dashboard/page.tsx`, `link/[id]/page.tsx`. Run `npm run typecheck && npm test && npm run build`. Do NOT touch payment/x402/download/fee-router/license-gate/nginx/preview/video-scope code — this is a self-contained messaging feature.

## Design
- A conversation is keyed by `(linkId, buyerOwnerId)` — one thread per prospective-buyer-per-listing, between that buyer and the link's owner (seller). This lets a popular listing have many independent buyer threads, each private between that buyer and the seller.
- **Both participants must be logged in** (existing session system) — messaging requires an account, reusing `getSessionOwner()` exactly as the dashboard/wallets features already do. No anonymous messaging, no new auth path.
- Storage: `data/messages.json` (new), atomic write (mirror the exact tmp-file + `rename` pattern already used in `link-registry.ts`/`registry.ts`, under a new `withMessagesWriteLock` mirroring `withLinkWriteLock`'s shape).

## Data model (`src/lib/types.ts` or a new `src/lib/messages.ts`)
```
type ChatMessage = {
  id: string;              // randomUUID
  linkId: string;
  buyerOwnerId: string;    // the non-seller participant
  senderOwnerId: string;   // who sent this message (buyer or seller ownerId)
  body: string;             // plain text, max length enforced
  createdAt: string;        // ISO
};
type MessageStore = { messages: ChatMessage[] };
```

## Build

### 1. `src/lib/messages.ts` (new)
- `readMessages(filePath?)` / `writeMessages(store, filePath?)` — mirror `link-registry.ts`'s `readLinks`/`writeLinks` exactly (JSON parse with a safe empty-store fallback on ENOENT, atomic tmp+rename write).
- `withMessagesWriteLock<T>(write)` — mirror `withLinkWriteLock`.
- `MAX_MESSAGE_LENGTH = 2000`. `sendMessage({ linkId, buyerOwnerId, senderOwnerId, body })`:
  - Validate `body` is a non-empty trimmed string ≤ `MAX_MESSAGE_LENGTH`, else throw a clear error.
  - Validate `senderOwnerId` is either `buyerOwnerId` or the link's actual `ownerId` (look up the link via `findLink(linkId)` — reject if the sender is neither party in this thread; this is the core access-control invariant).
  - Append under the write lock, return the new message.
- `readThread(linkId, buyerOwnerId, filePath?)` → messages filtered + sorted by `createdAt` ascending, for that specific thread only.
- `readThreadsForOwner(ownerId, filePath?)` → for the SELLER's inbox: all distinct `(linkId, buyerOwnerId)` threads where `ownerId` is either the buyer or the seller of that link, with the latest message + an unread count (see below) per thread.

### 2. Unread tracking (simplest viable approach — do not over-engineer)
- Add `readBy?: string[]` to `ChatMessage` — array of ownerIds who have "seen" this message (append the reader's ownerId when they view the thread). A thread's unread count for a given owner = count of messages in that thread NOT sent by them and not containing their ownerId in `readBy`.
- `markThreadRead(linkId, buyerOwnerId, readerOwnerId)` — under the write lock, add `readerOwnerId` to `readBy` for every message in that thread not already containing it.

### 3. API routes (all session-gated via `getSessionOwner()`)
- `POST /aperture/api/links/[id]/messages` — body `{ body }`. Resolve session owner. If the session owner IS the link's seller, reject (400 "sellers reply within an existing thread, they don't start one with themselves") — actually: allow the SELLER to reply only via a thread-scoped route (below); THIS route is for a buyer initiating/continuing their own thread. `buyerOwnerId = session owner's id` (a buyer can only ever post into their OWN thread with this seller — never impersonate another buyer). Calls `sendMessage`. Rate-limit (new `assertMessageRateLimit`, generous but real, e.g. 20/min).
- `GET /aperture/api/links/[id]/messages` — session-gated. If the caller is the buyer (has a thread) or the seller, return that thread (`readThread(linkId, callerOwnerId-if-buyer-else-need-a-buyer-param)`). Since a seller may have MULTIPLE buyer threads for one link, this route needs a `?buyerOwnerId=` query param when called by the seller (validate the seller only reads threads for links they own); when called by the buyer, ignore any query param and always return their own thread.
- `POST /aperture/api/links/[id]/messages/reply` (seller-only) — body `{ buyerOwnerId, body }`. Verify session owner is the link's actual seller (`ownerId` match) before allowing — reject otherwise. Calls `sendMessage` with `senderOwnerId = seller's ownerId`.
- `GET /aperture/api/messages/inbox` — session-gated, calls `readThreadsForOwner(session.ownerId)` — powers the dashboard's message list (all threads across all the owner's links, both as buyer and as seller).
- `POST /aperture/api/links/[id]/messages/read` — body `{ buyerOwnerId }` (only needed when the seller is marking a thread read; a buyer marking their own thread read needs no param). Calls `markThreadRead`.

### 4. UI
- **`link/[id]/page.tsx`**: when logged in and NOT the seller, show a simple message box ("Ask the seller a question") — textarea + send, polling `GET .../messages` every ~5s while the thread panel is open, rendering messages as plain text (React's default escaping — never `dangerouslySetInnerHTML`).
- **`dashboard/page.tsx`**: add a "Messages" section listing threads from `GET /api/messages/inbox` (counterparty name, link title, last message preview, unread badge). Clicking a thread opens an inline panel (same polling pattern) showing the full thread with a reply box (uses the seller-reply route if the owner is the seller for that thread, else the buyer route).
- Keep styling consistent with the existing dashboard/link-page paper theme; no new design system.

## Tests
- `messages.ts`: `sendMessage` rejects empty/over-length body; rejects a sender who is neither the buyer nor the seller of that link; `readThread` returns only that thread's messages in order; `readThreadsForOwner` aggregates correctly across multiple threads/links; `markThreadRead` updates `readBy` and unread counts drop to zero for the reader.
- Routes: no session → 401 everywhere; a buyer cannot post into another buyer's thread; a non-seller cannot use the seller-reply route; a seller cannot read another seller's link's threads; rate limit trips.
- No leak of `sourceUrl`/other link internals through the messages API (it should only ever return message content + minimal counterpart display name).

## Security invariants
- Every route is session-gated; no anonymous messaging.
- Strict participant check on every read/write: a caller can only touch threads where they are the buyer or the verified seller.
- Message length capped; rendered as plain text only (no HTML/markdown injection surface).
- Rate-limited per sender.
- No new dependency (plain polling, no websocket library).

## Acceptance
- A logged-in buyer can message a listing's seller with a question; the seller sees it in their dashboard inbox with an unread badge and can reply.
- Each buyer's thread with a seller is private — no cross-thread or cross-user leakage.
- Polling refreshes a thread without a page reload.
- `npm run typecheck && npm test && npm run build` green. No new dependency. No payment/gate/preview/video changes.
