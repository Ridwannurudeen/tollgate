import { APERTURE_IMMICH_API_BASE_URL } from "./config";
import { resolveSharedLink as defaultResolveSharedLink } from "./immich";
import { readLicenseLedger as defaultReadLicenseLedger } from "./ledger";
import { readWalletForOwner as defaultReadWalletForOwner } from "./registry";
import type {
  ImmichSharedLink,
  LicenseLedger,
  WalletRegistryEntry,
} from "./types";

export type LicenseCheckInput = {
  originalUri: string | null;
  originalMethod?: string | null;
};

export type LicenseCheckDeps = {
  immichApiBaseUrl?: string;
  resolveSharedLink?: (
    apiBaseUrl: string,
    key: string,
  ) => Promise<ImmichSharedLink>;
  readWalletForOwner?: (
    ownerId: string,
  ) => Promise<WalletRegistryEntry | null>;
  readLicenseLedger?: () => Promise<LicenseLedger>;
};

export type LicenseCheckResult =
  | { allowed: true; status: 204 }
  | {
      allowed: false;
      status: 403;
      body: { error: "payment required"; pay: "/aperture/api/license-download" };
    };

const PAYMENT_REQUIRED: LicenseCheckResult = {
  allowed: false,
  status: 403,
  body: {
    error: "payment required",
    pay: "/aperture/api/license-download",
  },
};

function sharedLinkKey(originalUri: string | null): {
  hasKey: boolean;
  key: string;
} {
  if (!originalUri) return { hasKey: false, key: "" };
  const url = new URL(originalUri, "http://aperture.local");
  if (!url.searchParams.has("key")) return { hasKey: false, key: "" };
  return { hasKey: true, key: url.searchParams.get("key") ?? "" };
}

function isPayable(entry: WalletRegistryEntry | null | undefined): boolean {
  return (
    entry !== null && entry !== undefined && entry.approvalStatus !== "pending"
  );
}

export async function evaluateLicenseCheck(
  input: LicenseCheckInput,
  deps: LicenseCheckDeps = {},
): Promise<LicenseCheckResult> {
  const parsed = sharedLinkKey(input.originalUri);
  if (!parsed.hasKey) return { allowed: true, status: 204 };
  if (!parsed.key) return PAYMENT_REQUIRED;

  const resolveSharedLink = deps.resolveSharedLink ?? defaultResolveSharedLink;
  const readWalletForOwner = deps.readWalletForOwner ?? defaultReadWalletForOwner;
  const readLicenseLedger = deps.readLicenseLedger ?? defaultReadLicenseLedger;
  const apiBaseUrl = deps.immichApiBaseUrl ?? APERTURE_IMMICH_API_BASE_URL;

  let sharedLink: ImmichSharedLink;
  try {
    sharedLink = await resolveSharedLink(apiBaseUrl, parsed.key);
  } catch {
    return PAYMENT_REQUIRED;
  }

  const ledger = await readLicenseLedger();
  const licensedAssets = new Set(
    ledger.receipts
      .filter((receipt) => receipt.sharedLinkId === sharedLink.id)
      .map((receipt) => receipt.assetId),
  );
  const ownerCache = new Map<string, WalletRegistryEntry | null>();

  for (const asset of sharedLink.assets) {
    let photographer = ownerCache.get(asset.ownerId);
    if (!ownerCache.has(asset.ownerId)) {
      photographer = await readWalletForOwner(asset.ownerId);
      ownerCache.set(asset.ownerId, photographer);
    }
    if (!isPayable(photographer)) continue;
    if (!licensedAssets.has(asset.id)) return PAYMENT_REQUIRED;
  }

  return { allowed: true, status: 204 };
}
