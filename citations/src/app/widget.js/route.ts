import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const script = `(() => {
  const current = document.currentScript;
  if (!current) return;
  const src = new URL(current.src);
  const creator = src.searchParams.get("creator") || "";
  const iframe = document.createElement("iframe");
  iframe.src = src.origin + "/embed?creator=" + encodeURIComponent(creator);
  iframe.title = "Tollgate paid answer widget";
  iframe.loading = "lazy";
  iframe.style.width = "100%";
  iframe.style.maxWidth = "420px";
  iframe.style.height = "360px";
  iframe.style.border = "1px solid rgba(46, 60, 54, 0.18)";
  iframe.style.borderRadius = "8px";
  iframe.style.background = "#fbfaf4";
  current.parentNode.insertBefore(iframe, current);
})();`;
  return new NextResponse(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
