export type CitationsSummarySource = {
  id: string;
  title: string;
  creator: string;
  handle: string;
  wallet: string;
  url: string;
  summary: string;
  tags: string[];
  priceAtomicUsdc: number;
  sourceKind: "external" | "seed" | "internal-test";
  creatorKind: "external" | "seed" | "internal-test";
  verifiedCreator: boolean;
  probation?: boolean;
  citationCount: number;
  earnedAtomicUsdc: number;
};

export type CitationsSummary = {
  wallet: string;
  earnings: {
    sourceCount: number;
    citationCount: number;
    earnedAtomicUsdc: number;
  };
  sources: CitationsSummarySource[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isSummary(value: unknown): value is CitationsSummary {
  if (!isRecord(value) || !isRecord(value.earnings)) return false;
  return (
    typeof value.wallet === "string" &&
    typeof value.earnings.sourceCount === "number" &&
    typeof value.earnings.citationCount === "number" &&
    typeof value.earnings.earnedAtomicUsdc === "number" &&
    Array.isArray(value.sources)
  );
}

export async function fetchCitationsSummary(
  wallet: string,
): Promise<CitationsSummary | null> {
  const configuredBaseUrl = process.env.CITATIONS_BASE_URL?.trim().replace(
    /\/+$/,
    "",
  );
  const baseUrl = configuredBaseUrl || "https://tollgate.gudman.xyz";
  try {
    const response = await fetch(`${baseUrl}/api/creators/${wallet}/summary`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    return isSummary(body) ? body : null;
  } catch {
    return null;
  }
}
