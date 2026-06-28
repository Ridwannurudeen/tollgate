"use client";

import { useState } from "react";

type DownloadArchiveButtonProps = {
  sharedLinkKey: string;
  assetIds: string[];
  basePath: string;
  localProofEnabled: boolean;
};

type LicenseDownloadResponse = {
  unlocked?: boolean;
  settlementMode?: string;
  receipts?: { receiptHash: string; settlementMode: string }[];
  downloadRequest?: {
    url: string;
    body: { assetIds: string[]; edited: boolean };
  };
};

const LOCAL_PROOF_HEADER = "X-APERTURE-LOCAL-PROOF";

export function DownloadArchiveButton({
  sharedLinkKey,
  assetIds,
  basePath,
  localProofEnabled,
}: DownloadArchiveButtonProps) {
  const [status, setStatus] = useState<
    "idle" | "paying" | "downloading" | "payment-required" | "done" | "bad"
  >("idle");
  const [settlementMode, setSettlementMode] = useState<string | null>(null);
  const [receiptHash, setReceiptHash] = useState<string | null>(null);

  async function downloadArchive() {
    setStatus("paying");
    setSettlementMode(null);
    setReceiptHash(null);
    const gateResponse = await fetch(`${basePath}/api/license-download`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(localProofEnabled ? { [LOCAL_PROOF_HEADER]: "1" } : {}),
      },
      body: JSON.stringify({ sharedLinkKey, assetIds }),
    });

    if (gateResponse.status === 402) {
      setStatus("payment-required");
      return;
    }

    if (!gateResponse.ok) {
      setStatus("bad");
      return;
    }

    const gate = (await gateResponse.json()) as LicenseDownloadResponse;
    if (!gate.unlocked || !gate.downloadRequest) {
      setStatus("bad");
      return;
    }

    setSettlementMode(gate.settlementMode ?? null);
    setReceiptHash(gate.receipts?.[0]?.receiptHash ?? null);
    setStatus("downloading");
    const response = await fetch(gate.downloadRequest.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(gate.downloadRequest.body),
    });

    if (!response.ok) {
      setStatus("bad");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "aperture-licensed-download.zip";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("done");
  }

  return (
    <div className="downloadAction">
      <button
        className="button primary"
        disabled={status === "downloading" || assetIds.length === 0}
        onClick={() => {
          downloadArchive().catch(() => setStatus("bad"));
        }}
        type="button"
      >
        {status === "paying"
          ? "Checking payment"
          : status === "downloading"
            ? "Downloading"
            : "Download archive"}
      </button>
      <span className={status === "bad" ? "statusText badText" : "statusText"}>
        {status === "done"
          ? `Unlocked${settlementMode ? ` via ${settlementMode}` : ""}${
              receiptHash ? ` / ${receiptHash.slice(0, 18)}` : ""
            }`
          : status === "payment-required"
            ? "x402 payment required before download unlock."
          : status === "bad"
            ? "Download failed. Check that the shared-link key is valid."
            : "POST /aperture/api/license-download"}
      </span>
    </div>
  );
}
