"use client";

import { useEffect, useState } from "react";

type ThreadSummary = {
  linkId: string;
  buyerOwnerId: string;
  sellerOwnerId: string;
  linkTitle: string;
  counterpartyName: string;
  viewerRole: "buyer" | "seller";
  latestMessage: string;
  latestAt: string;
  unreadCount: number;
};

type Message = {
  id: string;
  senderOwnerId: string;
  body: string;
  createdAt: string;
};

type DashboardMessagesProps = {
  basePath: string;
  ownerId: string;
};

function threadUrl(basePath: string, thread: ThreadSummary): string {
  const search =
    thread.viewerRole === "seller"
      ? `?buyerOwnerId=${encodeURIComponent(thread.buyerOwnerId)}`
      : "";
  return `${basePath}/api/links/${thread.linkId}/messages${search}`;
}

export function DashboardMessages({ basePath, ownerId }: DashboardMessagesProps) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selected, setSelected] = useState<ThreadSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function loadInbox() {
    const response = await fetch(`${basePath}/api/messages/inbox`);
    if (!response.ok) return;
    const payload = (await response.json().catch(() => null)) as {
      threads?: ThreadSummary[];
    } | null;
    if (Array.isArray(payload?.threads)) setThreads(payload.threads);
  }

  async function loadThread(thread: ThreadSummary) {
    const response = await fetch(threadUrl(basePath, thread));
    if (!response.ok) return;
    const payload = (await response.json().catch(() => null)) as {
      messages?: Message[];
    } | null;
    if (Array.isArray(payload?.messages)) setMessages(payload.messages);
  }

  useEffect(() => {
    loadInbox();
    const timer = window.setInterval(loadInbox, 5000);
    return () => window.clearInterval(timer);
  }, [basePath]);

  useEffect(() => {
    if (!selected) return;
    loadThread(selected);
    const timer = window.setInterval(() => loadThread(selected), 5000);
    return () => window.clearInterval(timer);
  }, [basePath, selected?.linkId, selected?.buyerOwnerId]);

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setPending(true);
    setStatus("");
    const endpoint =
      selected.viewerRole === "seller"
        ? `${basePath}/api/links/${selected.linkId}/messages/reply`
        : `${basePath}/api/links/${selected.linkId}/messages`;
    const body =
      selected.viewerRole === "seller"
        ? { buyerOwnerId: selected.buyerOwnerId, body: reply }
        : { body: reply };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (!response.ok) {
        setStatus(
          typeof payload?.error === "string" ? payload.error : "Reply failed.",
        );
        return;
      }
      setReply("");
      await Promise.all([loadInbox(), loadThread(selected)]);
      setStatus("Reply sent.");
    } catch {
      setStatus("Network error - please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="tableSurface messagesSurface">
      <div className="sectionTitle">
        <h2>Messages</h2>
        <span>{threads.length} thread(s)</span>
      </div>
      {threads.length === 0 ? (
        <div className="empty">No buyer or seller messages yet.</div>
      ) : (
        <div className="messageLayout">
          <div className="messageList">
            {threads.map((thread) => (
              <button
                className={
                  selected?.linkId === thread.linkId &&
                  selected.buyerOwnerId === thread.buyerOwnerId
                    ? "messageListItem active"
                    : "messageListItem"
                }
                key={`${thread.linkId}:${thread.buyerOwnerId}`}
                onClick={() => {
                  setSelected(thread);
                  setStatus("");
                }}
                type="button"
              >
                <strong>{thread.linkTitle}</strong>
                <span>{thread.counterpartyName}</span>
                <small>{thread.latestMessage}</small>
                {thread.unreadCount > 0 && (
                  <em>{thread.unreadCount} unread</em>
                )}
              </button>
            ))}
          </div>
          <div className="messageDetail">
            {!selected ? (
              <div className="empty">Select a thread to read and reply.</div>
            ) : (
              <>
                <div className="messageThread">
                  {messages.map((message) => (
                    <article
                      className={
                        message.senderOwnerId === ownerId
                          ? "messageBubble mine"
                          : "messageBubble"
                      }
                      key={message.id}
                    >
                      <span>
                        {message.senderOwnerId === ownerId
                          ? "You"
                          : selected.counterpartyName}
                      </span>
                      <p>{message.body}</p>
                      <small>{new Date(message.createdAt).toLocaleString()}</small>
                    </article>
                  ))}
                </div>
                <form className="registerForm" onSubmit={sendReply}>
                  <label>
                    Reply
                    <textarea
                      maxLength={2000}
                      onChange={(event) => setReply(event.target.value)}
                      required
                      rows={4}
                      value={reply}
                    />
                  </label>
                  <button type="submit" disabled={pending}>
                    {pending ? "Sending" : "Send reply"}
                  </button>
                  {status && <p className="formStatus">{status}</p>}
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
