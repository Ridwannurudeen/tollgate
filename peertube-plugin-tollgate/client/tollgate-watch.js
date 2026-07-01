function register({ registerHook, peertubeHelpers }) {
  const base = peertubeHelpers.getBaseRouterRoute();

  async function api(path, options) {
    const res = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...peertubeHelpers.getAuthHeader(),
        ...((options && options.headers) || {}),
      },
    });
    return res.json();
  }

  function renderPanel(status) {
    const existing = document.getElementById("tollgate-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "tollgate-panel";
    panel.style.cssText =
      "margin:12px 0;padding:12px 14px;border:1px solid #1e6a47;border-radius:8px;font-size:14px;background:rgba(30,106,71,0.06);";

    const paid = status.paid;
    const title = document.createElement("div");
    title.style.cssText = "font-weight:600;margin-bottom:4px;";
    title.textContent = paid
      ? "Creator paid ✓"
      : `Support the creator — ${status.priceUsdc} USDC`;
    panel.appendChild(title);

    if (paid && status.explorerTxUrl) {
      const link = document.createElement("a");
      link.href = status.explorerTxUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "View on-chain receipt";
      panel.appendChild(link);
    } else if (!paid && status.creatorWallet) {
      const button = document.createElement("button");
      button.textContent = "Pay the creator";
      button.style.cssText =
        "padding:6px 12px;border:none;border-radius:6px;background:#1e6a47;color:#fff;cursor:pointer;";
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Settling on Arc…";
        try {
          const result = await api(`/video/${status.videoId}/pay`, {
            method: "POST",
            body: JSON.stringify({ videoName: status.videoName || "" }),
          });
          if (result && result.receipt) {
            renderPanel({
              ...status,
              paid: true,
              explorerTxUrl: result.explorerTxUrl,
            });
          } else {
            button.disabled = false;
            button.textContent = "Retry payment";
          }
        } catch (_error) {
          button.disabled = false;
          button.textContent = "Retry payment";
        }
      });
      panel.appendChild(button);
    } else if (!status.creatorWallet) {
      const note = document.createElement("div");
      note.textContent = "No creator wallet configured for this video.";
      panel.appendChild(note);
    }

    const anchor = document.querySelector(".video-info") || document.body;
    anchor.prepend(panel);
  }

  registerHook({
    target: "action:video-watch.video.loaded",
    handler: async ({ video }) => {
      try {
        const status = await api(`/video/${video.uuid}/status`);
        renderPanel({ ...status, videoName: video.name });
      } catch (_error) {
        // Non-fatal: the plugin panel simply does not render.
      }
    },
  });
}

export { register };
