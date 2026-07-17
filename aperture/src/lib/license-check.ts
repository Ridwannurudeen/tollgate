export type LicenseCheckInput = {
  originalUri: string | null;
  originalMethod?: string | null;
  originalImmichShareKey?: string | null;
  originalImmichShareSlug?: string | null;
};

export type LicenseCheckResult =
  | { allowed: true; status: 204 }
  | {
      allowed: false;
      status: 403;
      body: {
        error: "payment required";
        pay: "/aperture/api/license-download";
      };
    };

const PAYMENT_REQUIRED: LicenseCheckResult = {
  allowed: false,
  status: 403,
  body: {
    error: "payment required",
    pay: "/aperture/api/license-download",
  },
};

function hasSharedLinkCredential(originalUri: string | null): boolean {
  if (!originalUri) return false;
  try {
    const url = new URL(originalUri, "http://aperture.local");
    return url.searchParams.has("key") || url.searchParams.has("slug");
  } catch {
    return true;
  }
}

export function evaluateLicenseCheck(
  input: LicenseCheckInput,
): LicenseCheckResult {
  if (
    input.originalImmichShareKey !== undefined &&
    input.originalImmichShareKey !== null
  ) {
    return PAYMENT_REQUIRED;
  }
  if (
    input.originalImmichShareSlug !== undefined &&
    input.originalImmichShareSlug !== null
  ) {
    return PAYMENT_REQUIRED;
  }
  return hasSharedLinkCredential(input.originalUri)
    ? PAYMENT_REQUIRED
    : { allowed: true, status: 204 };
}
