"use client";

import { useEffect, useState } from "react";

type Message = {
  id: string;
  senderOwnerId: string;
  body: string;
  createdAt: string;
};

type LinkMessagePanelProps = {
  basePath: string;
  linkId: string;
  currentOwnerId: string;
  sellerName: string;
};

export function LinkMessagePanel({
  basePath,
  linkId,
  currentOwnerId,
  sellerName,
}: LinkMessagePanelProps) {
  const [body, setBody] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function loadThread() {
    const response = await fetch(`${basePath}/api/links/${linkId}/messages`);
    if (!response.ok) return;
    const payload = (await response.json().catch(() => null)) as {
      messages?: Message[];
    } | null;
    if (Array.isArray(payload?.messages)) setMessages(payload.messages);
  }

  useEffect(() => {
    loadThread();
    const timer = window.setInterval(loadThread, 5000);
    return () => window.clearInterval(timer);
  }, [basePath, linkId]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setStatus("");
    try {
      const response = await fetch(`${basePath}/api/links/${linkId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (!response.ok) {
        setStatus(
          typeof payload?.error === "string"
            ? payload.error
            : "Message was not sent.",
        );
        return;
      }
      setBody("");
      await loadThread();
      setStatus("Message sent.");
    } catch {
      setStatus("Network error - please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="surface wide messagePanel">
      <div className="sectionTitle inlineTitle">
        <h2>Ask the seller</h2>
        <span>{sellerName}</span>
      </div>
      <div className="messageThread" aria-live="polite">
        {messages.length === 0 ? (
          <p className="empty compactEmpty">
            No messages yet. Ask about licensing terms, usage rights, or custom
            requests.
          </p>
        ) : (
          messages.map((message) => (
            <article
              className={
                message.senderOwnerId === currentOwnerId
                  ? "messageBubble mine"
                  : "messageBubble"
              }
              key={message.id}
            >
              <span>
                {message.senderOwnerId === currentOwnerId ? "You" : sellerName}
              </span>
              <p>{message.body}</p>
              <small>{new Date(message.createdAt).toLocaleString()}</small>
            </article>
          ))
        )}
      </div>
      <form className="registerForm" onSubmit={send}>
        <label>
          Message
          <textarea
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Can I use this in a commercial campaign?"
            required
            rows={4}
            value={body}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Sending" : "Send message"}
        </button>
        {status && <p className="formStatus">{status}</p>}
      </form>
    </section>
  );
}
