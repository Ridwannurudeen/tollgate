"use client";

import { useState } from "react";

type RegistrationMode = "upload" | "link";
type MediaKind = "photo" | "video";

type LinkRegistrationResult = {
  shareUrl: string;
  accountKey?: string;
  link: {
    id: string;
    title: string;
    description?: string;
    mediaKind?: MediaKind;
    priceAtomicUsdc: number;
    hasPreview?: boolean;
  };
  registered: {
    ownerId: string;
    displayName: string;
    wallet: string;
    approvalStatus: string;
    custody?: "self" | "circle-w3s";
  };
};

export function LinkRegistrationForm({ basePath }: { basePath: string }) {
  const [mode, setMode] = useState<RegistrationMode>("upload");
  const [mediaKind, setMediaKind] = useState<MediaKind>("photo");
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<LinkRegistrationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");
    setResult(null);
    try {
      let response: Response;
      if (mode === "upload") {
        if (!file) {
          setStatus(
            mediaKind === "video"
              ? "Choose a video file to upload."
              : "Choose an image file to upload.",
          );
          return;
        }
        const body = new FormData();
        body.set("file", file);
        body.set("mediaKind", mediaKind);
        body.set("title", title.trim());
        body.set("displayName", displayName.trim());
        if (description.trim()) body.set("description", description.trim());
        if (wallet.trim()) body.set("wallet", wallet.trim());
        response = await fetch(`${basePath}/api/links/upload`, {
          method: "POST",
          body,
        });
      } else {
        response = await fetch(`${basePath}/api/links`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceUrl: sourceUrl.trim(),
            title: title.trim(),
            description: description.trim() || undefined,
            displayName: displayName.trim(),
            wallet: wallet.trim() || undefined,
          }),
        });
      }
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.error ?? "Photo link registration failed.");
        return;
      }
      setResult(body);
    } catch {
      setStatus("Network error - please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyShareUrl() {
    if (!result) return;
    await navigator.clipboard.writeText(result.shareUrl);
    setStatus("Share link copied.");
  }

  async function copyAccountKey() {
    if (!result?.accountKey) return;
    await navigator.clipboard.writeText(result.accountKey);
    setStatus("Account key copied.");
  }

  return (
    <form className="registerForm" onSubmit={submit}>
      <div className="modeToggle" aria-label="Media type">
        <button
          aria-pressed={mediaKind === "photo"}
          type="button"
          onClick={() => setMediaKind("photo")}
        >
          Photo
        </button>
        <button
          aria-pressed={mediaKind === "video"}
          type="button"
          onClick={() => {
            setMediaKind("video");
            setMode("upload");
          }}
        >
          Video
        </button>
      </div>
      <div className="modeToggle" aria-label="Photo source">
        <button
          aria-pressed={mode === "upload"}
          type="button"
          onClick={() => setMode("upload")}
        >
          Upload a file
        </button>
        <button
          aria-pressed={mode === "link"}
          disabled={mediaKind === "video"}
          type="button"
          onClick={() => setMode("link")}
        >
          Paste a link
        </button>
      </div>
      {mode === "upload" ? (
        <label>
          {mediaKind === "video" ? "Video file" : "Photo file"}
          <input
            accept={
              mediaKind === "video"
                ? "video/mp4,video/webm,video/quicktime"
                : "image/jpeg,image/png,image/webp,image/gif,image/avif,image/tiff"
            }
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
            type="file"
          />
        </label>
      ) : (
        <label>
          Photo URL
          <input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://example.com/photo.jpg"
            required
            type="url"
          />
        </label>
      )}
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Morning at Surulere"
          required
        />
      </label>
      <label>
        Description{" "}
        <span className="hint">(optional - tell buyers what they unlock)</span>
        <textarea
          maxLength={600}
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={
            mediaKind === "video"
              ? "What is in the clip, its length, quality, and usage context."
              : "What is in the photo, where it was taken, and why it is useful."
          }
        />
      </label>
      <label>
        Photographer name
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Jane Lens"
          required
        />
      </label>
      <label>
        Payout wallet{" "}
        <span className="hint">
          (optional - leave blank and we create one for you)
        </span>
        <input
          value={wallet}
          onChange={(event) => setWallet(event.target.value)}
          placeholder="0x... or leave blank"
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting
          ? mode === "upload"
            ? mediaKind === "video"
              ? "Uploading video..."
              : "Uploading photo..."
            : "Checking photo..."
          : "Create gated link"}
      </button>
      {status && <p className="formStatus">{status}</p>}
      {result && (
        <div className="linkSuccess" aria-live="polite">
          <p className="eyebrow">Share this link</p>
          {result.link.hasPreview && (
            <figure className="previewFrame compactPreview">
              <img
                alt={`Watermarked preview of ${result.link.title}`}
                src={`${basePath}/link/${result.link.id}/preview`}
              />
              <figcaption>
                Buyers see this watermarked preview before unlocking the full
                {result.link.mediaKind === "video" ? " video." : " original."}
              </figcaption>
            </figure>
          )}
          <input readOnly value={result.shareUrl} />
          <div className="actions compactActions">
            <button type="button" onClick={copyShareUrl}>
              Copy link
            </button>
            <a className="button" href={result.shareUrl}>
              Open gated page
            </a>
          </div>
          <p className="formStatus">
            Registered {result.registered.displayName} to{" "}
            {result.registered.custody === "circle-w3s"
              ? "a wallet created for you"
              : "your wallet"}{" "}
            {result.registered.wallet}.
          </p>
          {result.accountKey && (
            <div className="accountKeyBox">
              <p className="eyebrow">Save your account key</p>
              <p>
                Save this key for future sign-in. Email login is available when
                an account is created from a verified email link.
              </p>
              <input readOnly value={result.accountKey} />
              <div className="actions compactActions">
                <button type="button" onClick={copyAccountKey}>
                  Copy account key
                </button>
                <a className="button" href={`${basePath}/dashboard`}>
                  Open dashboard
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
