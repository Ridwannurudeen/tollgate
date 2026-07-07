"use client";

import { useState } from "react";
import { payErrorMessage } from "../lib/pay-errors";
import { connectArcWallet, makePaidFetch } from "../lib/x402-client";

type LinkDownloadButtonProps = {
  id: string;
  title: string;
  basePath: string;
  priceText: string;
};

function extensionForContentType(contentType: string | null): string {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    case "image/tiff":
      return "tiff";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    default:
      return "jpg";
  }
}

function safeDownloadName(response: Response, title: string): string {
  const disposition = response.headers.get("content-disposition");
  const filename = disposition?.match(/filename="([^"]+)"/i)?.[1];
  if (filename) return filename.replace(/[\\/]/g, "-");
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "aperture-download";
  return `${base}.${extensionForContentType(response.headers.get("content-type"))}`;
}

export function LinkDownloadButton({
  id,
  title,
  basePath,
  priceText,
}: LinkDownloadButtonProps) {
  const [pending, setPending] = useState<"wallet" | "demo" | null>(null);
  const [status, setStatus] = useState<"idle" | "done" | "bad">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [receiptHash, setReceiptHash] = useState<string | null>(null);

  async function downloadBlob(response: Response) {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeDownloadName(response, title);
    anchor.click();
    URL.revokeObjectURL(url);
    setReceiptHash(response.headers.get("x-aperture-receipt-hash"));
    setMessage("Unlocked. The receipt is recorded in Aperture proof.");
    setStatus("done");
  }

  async function responseError(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        return body.error;
      }
    } catch {
      return "Unlock failed. Try again shortly.";
    }
    return "Unlock failed. Try again shortly.";
  }

  async function unlockWithWallet() {
    setPending("wallet");
    setStatus("idle");
    setMessage(null);
    setReceiptHash(null);
    try {
      const client = await connectArcWallet();
      const paidFetch = makePaidFetch(client);
      const response = await paidFetch(`${basePath}/api/links/${id}/download`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(await responseError(response));
      await downloadBlob(response);
    } catch (error) {
      setStatus("bad");
      setMessage(payErrorMessage(error, priceText));
    } finally {
      setPending(null);
    }
  }

  async function unlockWithoutWallet() {
    setPending("demo");
    setStatus("idle");
    setMessage(null);
    setReceiptHash(null);
    try {
      const response = await fetch(
        `${basePath}/api/links/${id}/download/demo`,
        { method: "POST" },
      );
      if (!response.ok) {
        setStatus("bad");
        setMessage(await responseError(response));
        return;
      }
      await downloadBlob(response);
    } catch {
      setStatus("bad");
      setMessage("Unlock failed. Try again shortly.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="downloadAction">
      <div className="buyerActions">
        <button
          className="button primary"
          disabled={pending !== null}
          onClick={() => {
            unlockWithWallet();
          }}
          type="button"
        >
          {pending === "wallet"
            ? "Opening wallet"
            : "Unlock with your own wallet"}
        </button>
        <div className="demoUnlock">
          <button
            className="button"
            disabled={pending !== null}
            onClick={() => {
              unlockWithoutWallet();
            }}
            type="button"
          >
            {pending === "demo" ? "Unlocking" : "Unlock without a wallet"}
          </button>
          <span>Paid for you by Tollgate for the demo - no crypto needed.</span>
        </div>
      </div>
      <span
        aria-live="polite"
        className={status === "bad" ? "statusText badText" : "statusText"}
      >
        {status === "done"
          ? `${message ?? "Unlocked."}${
              receiptHash
                ? ` Proof of payment: ${receiptHash.slice(0, 18)}`
                : ""
            }`
          : status === "bad"
            ? (message ?? "Unlock failed. Try again shortly.")
            : (message ??
              "Choose a wallet unlock, or use the no-wallet demo unlock.")}
      </span>
    </div>
  );
}
