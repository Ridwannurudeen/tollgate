import { NextResponse } from "next/server";
import { getSourceEvidence, readLedger } from "@/lib/ledger";

export const runtime = "nodejs";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sourceIdFromRequest(request: Request): string {
  const pathname = new URL(request.url).pathname;
  const segment = pathname.split("/").at(-1) ?? "";
  return decodeURIComponent(segment.replace(/\.svg$/, ""));
}

export async function GET(request: Request) {
  const sourceId = sourceIdFromRequest(request);
  const evidence = getSourceEvidence(await readLedger(), sourceId);
  const earned = evidence
    ? `$${(evidence.earnedAtomicUsdc / 1_000_000)
        .toFixed(6)
        .replace(/0+$/, "")
        .replace(/\.$/, "")}`
    : "$0";
  const label = escapeXml(`Cited & paid by AI · ${earned} earned`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="310" height="36" role="img" aria-label="${label}"><rect width="310" height="36" rx="6" fill="#fdfaf0" stroke="#ccc2a9"/><circle cx="18" cy="18" r="5" fill="#1e6a47"/><text x="32" y="23" fill="#1c1b15" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="12">${label}</text></svg>`;
  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
