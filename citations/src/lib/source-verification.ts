import { createHmac } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { updateSourceVerification } from "./catalog";
import { sha256Hex } from "./hash";
import {
  isUnsafeFetchHost,
  safeFetch,
  type SafeFetchOptions,
} from "./safe-fetch";
import type { CreatorSource, SourceOwnershipProof } from "./types";

const VERIFY_TIMEOUT_MS = 5_000;

function verifySecret(): string {
  const secret = process.env.TOLLGATE_VERIFY_SECRET;
  if (!secret) throw new Error("TOLLGATE_VERIFY_SECRET is not configured.");
  return secret;
}

export function verificationToken(sourceId: string): string {
  return createHmac("sha256", verifySecret()).update(sourceId).digest("hex");
}

function proof(
  method: "meta-tag" | "dns-txt",
  token: string,
): SourceOwnershipProof {
  return {
    method,
    signatureHash: sha256Hex(token),
    verifiedAt: new Date().toISOString(),
  };
}

function hasVerificationMetaTag(html: string, token: string): boolean {
  const metaPattern = /<meta\s+[^>]*>/gi;
  const attrPattern = /([a-zA-Z:-]+)\s*=\s*["']([^"']*)["']/g;
  for (const match of html.matchAll(metaPattern)) {
    const attrs = new Map<string, string>();
    for (const attr of match[0].matchAll(attrPattern)) {
      attrs.set(attr[1].toLowerCase(), attr[2]);
    }
    if (
      attrs.get("name") === "tollgate-verification" &&
      attrs.get("content") === token
    ) {
      return true;
    }
  }
  return false;
}

export async function verifyMetaTagSource(
  source: CreatorSource,
  fetchOptions: SafeFetchOptions = {},
): Promise<SourceOwnershipProof> {
  const token = verificationToken(source.id);
  const url = new URL(source.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const response = await safeFetch(
      url,
      { signal: controller.signal },
      { ...localVerificationFetchOptions(source), ...fetchOptions },
    );
    if (!response.ok) {
      throw new Error(`verification fetch failed: HTTP ${response.status}`);
    }
    const html = await response.text();
    if (!hasVerificationMetaTag(html, token)) {
      throw new Error("verification meta tag was not found.");
    }
    return proof("meta-tag", token);
  } finally {
    clearTimeout(timeout);
  }
}

function localVerificationFetchOptions(
  source: CreatorSource,
): SafeFetchOptions {
  if (process.env.TOLLGATE_VERIFY_ALLOW_PRIVATE_HOSTS !== "1") return {};
  const hostname = new URL(source.url).hostname;
  if (!isUnsafeFetchHost(hostname) && !hostname.endsWith(".lvh.me")) return {};
  return {
    resolveHost: async () => ["93.184.216.34"],
  };
}

export async function verifyDnsTxtSource(
  source: CreatorSource,
  resolver: typeof resolveTxt = resolveTxt,
): Promise<SourceOwnershipProof> {
  const token = verificationToken(source.id);
  const host = new URL(source.url).hostname;
  const records = await resolver(host);
  const flattened = records.map((record) => record.join(""));
  if (!flattened.includes(`tollgate-verify=${token}`)) {
    throw new Error("verification DNS TXT record was not found.");
  }
  return proof("dns-txt", token);
}

export async function verifySourceByWebProof(
  source: CreatorSource,
  method: "meta-tag" | "dns-txt",
): Promise<{ source: CreatorSource; sources: CreatorSource[] }> {
  const ownershipProof =
    method === "meta-tag"
      ? await verifyMetaTagSource(source)
      : await verifyDnsTxtSource(source);
  return updateSourceVerification(source.id, ownershipProof);
}
