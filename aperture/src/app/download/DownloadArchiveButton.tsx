"use client";

import { useState } from "react";

type DownloadArchiveButtonProps = {
  sharedLinkKey: string;
  assetIds: string[];
};

export function DownloadArchiveButton({
  sharedLinkKey,
  assetIds,
}: DownloadArchiveButtonProps) {
  const [status, setStatus] = useState<"idle" | "downloading" | "done" | "bad">(
    "idle",
  );

  async function downloadArchive() {
    setStatus("downloading");
    const response = await fetch(
      `/immich/api/download/archive?key=${encodeURIComponent(sharedLinkKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds, edited: false }),
      },
    );

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
        {status === "downloading" ? "Downloading" : "Download archive"}
      </button>
      <span className={status === "bad" ? "statusText badText" : "statusText"}>
        {status === "done"
          ? "Archive requested. The nginx watcher will record the billable resolve."
          : status === "bad"
            ? "Download failed. Check that the shared-link key is valid."
            : "POST /immich/api/download/archive"}
      </span>
    </div>
  );
}
