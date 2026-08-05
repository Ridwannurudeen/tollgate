import { readCappedResponseText } from "./safe-fetch";

// pub.orcid.org serves public records without a token — verified against
// 0000-0002-1825-0097 on 2026-08-05. The host is fixed, so there is no
// user-controlled URL here and no SSRF surface to defend.
const ORCID_PUBLIC_API = "https://pub.orcid.org/v3.0";
const ORCID_TIMEOUT_MS = 8_000;
export const ORCID_WORKS_MAX_BYTES = 2 * 1024 * 1024;
const ORCID_ID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export type OrcidWorksResponse = {
  group?: Array<{
    "external-ids"?: OrcidExternalIds | null;
    "work-summary"?: Array<{ "external-ids"?: OrcidExternalIds | null }> | null;
  }> | null;
};

type OrcidExternalIds = {
  "external-id"?: Array<{
    "external-id-type"?: string | null;
    "external-id-value"?: string | null;
    "external-id-normalized"?: { value?: string | null } | null;
  }> | null;
} | null;

// DOIs are case-insensitive and are handed to us with every prefix style going,
// so both sides of a comparison get flattened to the bare identifier.
export function normalizeDoi(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim()
    .toLowerCase();
}

export function normalizeOrcidId(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\/(sandbox\.)?orcid\.org\//i, "")
    .toUpperCase();
  if (!ORCID_ID_PATTERN.test(trimmed)) {
    throw new Error(`Not a valid ORCID iD: ${value}`);
  }
  return trimmed;
}

// A work carries external-ids at both the group and the summary level, and
// either can be absent or explicitly null; ignoring the group level silently
// drops DOIs for works that ORCID has merged across sources.
export function orcidWorkDois(payload: OrcidWorksResponse): string[] {
  const dois = new Set<string>();
  for (const group of payload.group ?? []) {
    const containers = [
      group["external-ids"],
      ...(group["work-summary"] ?? []).map((work) => work?.["external-ids"]),
    ];
    for (const container of containers) {
      for (const entry of container?.["external-id"] ?? []) {
        if (entry?.["external-id-type"]?.toLowerCase() !== "doi") continue;
        const raw =
          entry["external-id-normalized"]?.value ?? entry["external-id-value"];
        if (raw) dois.add(normalizeDoi(raw));
      }
    }
  }
  return [...dois];
}

export async function fetchOrcidWorks(
  orcidId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OrcidWorksResponse> {
  const id = normalizeOrcidId(orcidId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORCID_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${ORCID_PUBLIC_API}/${id}/works`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`ORCID works fetch failed: HTTP ${response.status}`);
    }
    return JSON.parse(
      await readCappedResponseText(response, ORCID_WORKS_MAX_BYTES),
    ) as OrcidWorksResponse;
  } finally {
    clearTimeout(timeout);
  }
}

// Answers only "does this ORCID record claim this DOI". Proving the registrant
// *is* that ORCID iD is the OAuth half, and until that exists this must not be
// used to grant verification on its own — an unauthenticated caller can name
// any iD, and a public record is readable by anyone.
export async function orcidRecordListsDoi(
  orcidId: string,
  doi: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const target = normalizeDoi(doi);
  if (!target) return false;
  const works = await fetchOrcidWorks(orcidId, fetchImpl);
  return orcidWorkDois(works).includes(target);
}
