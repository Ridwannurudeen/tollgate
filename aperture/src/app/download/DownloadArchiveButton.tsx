"use client";

import { useState } from "react";
import { payErrorMessage } from "../../lib/pay-errors";
import { connectArcWallet, makePaidFetch } from "../../lib/x402-client";

type DownloadArchiveButtonProps = {
  sharedLinkKey: string;
  assetIds: string[];
  basePath: string;
  localProofEnabled: boolean;
  priceText: string;
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
  priceText,
}: DownloadArchiveButtonProps) {
  const [status, setStatus] = useState<
    "idle" | "paying" | "downloading" | "payment-required" | "done" | "bad"
  >("idle");
  const [settlementMode, setSettlementMode] = useState<string | null>(null);
  const [receiptHash, setReceiptHash] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function downloadArchive() {
    setStatus("paying");
    setSettlementMode(null);
    setReceiptHash(null);
    setFailure(null);
    const gateRequest = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(localProofEnabled ? { [LOCAL_PROOF_HEADER]: "1" } : {}),
      },
      body: JSON.stringify({ sharedLinkKey, assetIds }),
    };
    let gateResponse: Response;
    if (localProofEnabled) {
      gateResponse = await fetch(
        `${basePath}/api/license-download`,
        gateRequest,
      );
    } else {
      const paidFetch = makePaidFetch(await connectArcWallet());
      gateResponse = await paidFetch(
        `${basePath}/api/license-download`,
        gateRequest,
      );
    }

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
        disabled={
          status === "paying" ||
          status === "downloading" ||
          assetIds.length === 0
        }
        onClick={() => {
          downloadArchive().catch((error) => {
            setFailure(payErrorMessage(error, priceText));
            setStatus("bad");
          });
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
            ? (failure ??
              "Download failed. Check that the shared-link key is valid.")
            : "POST /aperture/api/license-download"}
      </span>
    </div>
  );
}
