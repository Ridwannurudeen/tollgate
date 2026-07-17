import {
  completeLicenseAuthorization,
  releaseLicenseAuthorization,
  reserveLicenseAuthorization,
  type LicenseAuthorizationClaim,
  type LicenseAuthorizationReserveScope,
} from "./license-authorization";
import { MAX_LICENSE_ASSET_IDS } from "./license-download";
import type { ImmichSharedLink } from "./types";

export type LicenseArchiveInput = {
  sharedLinkKey: string;
  authorization: string;
  method: string;
  assetIds: string[];
  edited: boolean;
};

export type LicenseArchiveBody = {
  assetIds: string[];
  edited: false;
};

export type LicenseArchiveDeps = {
  resolveSharedLink: (key: string) => Promise<ImmichSharedLink>;
  reserveAuthorization?: (
    token: string,
    scope: LicenseAuthorizationReserveScope,
  ) => Promise<LicenseAuthorizationClaim | null>;
  completeAuthorization?: (
    claim: LicenseAuthorizationClaim,
  ) => Promise<boolean>;
  releaseAuthorization?: (claim: LicenseAuthorizationClaim) => Promise<void>;
  fetchArchive: (
    key: string,
    body: LicenseArchiveBody,
  ) => Promise<Response>;
};

export type LicenseArchiveResult =
  | { status: 200; response: Response }
  | { status: number; body: { error: string } };

function canonicalAssetIds(assetIds: readonly string[]): string[] {
  return [...new Set(assetIds)].sort();
}

function exactAssetSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const canonicalLeft = canonicalAssetIds(left);
  const canonicalRight = canonicalAssetIds(right);
  return (
    canonicalLeft.length === left.length &&
    canonicalRight.length === right.length &&
    canonicalLeft.every(
      (assetId, index) => assetId === canonicalRight[index],
    )
  );
}

export async function handleLicenseArchive(
  input: LicenseArchiveInput,
  deps: LicenseArchiveDeps,
): Promise<LicenseArchiveResult> {
  if (input.method !== "POST") {
    return { status: 405, body: { error: "method not allowed" } };
  }
  if (!input.sharedLinkKey || !input.authorization) {
    return {
      status: 403,
      body: { error: "valid license authorization required" },
    };
  }

  const sharedLink = await deps.resolveSharedLink(input.sharedLinkKey);
  if (
    !sharedLink.allowDownload ||
    sharedLink.assets.length === 0 ||
    sharedLink.assets.length > MAX_LICENSE_ASSET_IDS
  ) {
    return {
      status: 403,
      body: { error: "shared link is not eligible for archive download" },
    };
  }

  const assetIds = sharedLink.assets.map((asset) => asset.id);
  if (input.edited !== false || !exactAssetSet(input.assetIds, assetIds)) {
    return {
      status: 400,
      body: { error: "archive body must match the complete shared link" },
    };
  }

  const scope = {
    sharedLinkKey: input.sharedLinkKey,
    sharedLinkId: sharedLink.id,
    assetIds,
    method: input.method,
  };
  const claim = await (
    deps.reserveAuthorization ?? reserveLicenseAuthorization
  )(input.authorization, scope);
  if (!claim) {
    return {
      status: 403,
      body: { error: "valid unused license authorization required" },
    };
  }

  const archiveBody: LicenseArchiveBody = {
    assetIds,
    edited: false,
  };
  let response: Response;
  try {
    response = await deps.fetchArchive(input.sharedLinkKey, archiveBody);
  } catch (error) {
    await (
      deps.releaseAuthorization ?? releaseLicenseAuthorization
    )(claim);
    throw error;
  }

  if (!response.ok) {
    await (
      deps.releaseAuthorization ?? releaseLicenseAuthorization
    )(claim);
    return {
      status: 502,
      body: { error: "Immich rejected the licensed archive request" },
    };
  }

  const completed = await (
    deps.completeAuthorization ?? completeLicenseAuthorization
  )(claim);
  if (!completed) {
    await response.body?.cancel();
    return {
      status: 409,
      body: { error: "license authorization was already consumed" },
    };
  }

  return { status: 200, response };
}
