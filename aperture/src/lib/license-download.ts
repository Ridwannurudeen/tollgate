import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import { APERTURE_LICENSE_FEE_ATOMIC_USDC } from "./config";
import { sha256Hex } from "./hash";
import {
  LICENSE_AUTHORIZATION_TTL_MS,
  createLicenseAuthorization,
} from "./license-authorization";
import type { LicenseReceiptInput } from "./ledger";
import {
  createLicensePurchaseStore,
  type LicensePurchase,
  type LicensePurchaseStore,
  type StoredLicenseSettlement,
} from "./license-purchase";
import type {
  DownloadArchiveEvent,
  ImmichSharedLink,
  LicenseReceipt,
  LicenseSettlementEvidence,
  WalletRegistryEntry,
} from "./types";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  buildPaymentRequirements,
  paymentRequiredBody,
  paymentRequiredHeaders,
  settleX402,
  type X402Settlement,
  x402PaymentIdentity,
} from "./x402-server";

export const LOCAL_PROOF_HEADER = "X-APERTURE-LOCAL-PROOF";
export const MAX_LICENSE_ASSET_IDS = 100;

export type LicenseDownloadRequest = {
  sharedLinkKey: string;
  assetIds?: string[];
};

export type LicenseDownloadDeps = {
  headers: Headers;
  origin: string;
  basePath: string;
  localProofEnabled?: boolean;
  createAuthorization?: typeof createLicenseAuthorization;
  purchaseStore?: LicensePurchaseStore;
  resolveSharedLink: (key: string) => Promise<ImmichSharedLink>;
  findWalletForOwner: (ownerId: string) => Promise<WalletRegistryEntry | null>;
  appendReceipt: (
    input: LicenseReceiptInput,
  ) => Promise<{ receipt: LicenseReceipt; created: boolean }>;
  now?: () => string;
  nowMs?: () => number;
  localProofPaymentId?: () => Hex;
  settlePayment?: (
    signatureHeader: string,
    accepted: ReturnType<typeof buildPaymentRequirements>,
  ) => Promise<X402Settlement>;
};

export type LicenseDownloadResult = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

type ResolvedAsset = {
  assetId: string;
  ownerId: string;
  photographer: WalletRegistryEntry;
};

function localProofEvidence(
  paymentResource: string,
): LicenseSettlementEvidence {
  return {
    settlementMode: "local-proof",
    paymentResource,
  };
}

function x402Evidence(
  settlement: Extract<X402Settlement, { ok: true }>,
  paymentResource: string,
): LicenseSettlementEvidence {
  return {
    settlementMode: settlement.mode,
    payer: settlement.payer as Address | undefined,
    transaction: settlement.transaction as Hex | undefined,
    paymentResource,
  };
}

function downloadEvent(
  sharedLinkKey: string,
  createdAt: string,
  paymentId: Hex,
): DownloadArchiveEvent {
  return {
    remoteAddress: "license-download",
    method: "POST",
    path: "/api/download/archive",
    sharedLinkKey,
    status: 200,
    userAgent: "aperture-license-download",
    referer: null,
    createdAt,
    rawLine: `license-download ${paymentId} ${createdAt}`,
  };
}

function canonicalAssetIds(assetIds: readonly string[]): string[] {
  return [...new Set(assetIds)].sort();
}

function sameAssetSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const leftCanonical = canonicalAssetIds(left);
  const rightCanonical = canonicalAssetIds(right);
  return (
    leftCanonical.length === left.length &&
    rightCanonical.length === right.length &&
    leftCanonical.every((assetId, index) => assetId === rightCanonical[index])
  );
}

function licenseSnapshot(
  sharedLink: ImmichSharedLink,
  assets: ResolvedAsset[],
): Hex {
  return sha256Hex({
    type: "aperture-license-snapshot-v1",
    sharedLinkId: sharedLink.id,
    feeAtomicUsdc: APERTURE_LICENSE_FEE_ATOMIC_USDC,
    assets: assets
      .map((asset) => ({
        assetId: asset.assetId,
        ownerId: asset.ownerId,
        wallet: asset.photographer.wallet.toLowerCase(),
      }))
      .sort((left, right) => left.assetId.localeCompare(right.assetId)),
  });
}

function storedSettlement(
  purchase: LicensePurchase,
): Extract<X402Settlement, { ok: true }> | null {
  if (
    (purchase.state !== "settled" && purchase.state !== "receipted") ||
    !purchase.settlement
  ) {
    return null;
  }
  return { ok: true, ...purchase.settlement };
}

function settlementForStorage(
  settlement: Extract<X402Settlement, { ok: true }>,
): StoredLicenseSettlement {
  return {
    mode: settlement.mode,
    ...(settlement.payer ? { payer: settlement.payer } : {}),
    ...(settlement.transaction
      ? { transaction: settlement.transaction }
      : {}),
    responseHeader: settlement.responseHeader,
  };
}

export async function handleLicenseDownload(
  input: LicenseDownloadRequest,
  deps: LicenseDownloadDeps,
): Promise<LicenseDownloadResult> {
  if (!input.sharedLinkKey) {
    return {
      status: 400,
      headers: {},
      body: { error: "sharedLinkKey is required" },
    };
  }

  const sharedLink = await deps.resolveSharedLink(input.sharedLinkKey);
  if (!sharedLink.allowDownload) {
    return {
      status: 403,
      headers: {},
      body: { error: "this shared link does not permit archive downloads" },
    };
  }
  const assets = sharedLink.assets;
  if (assets.length === 0) {
    return {
      status: 404,
      headers: {},
      body: { error: "shared link has no directly downloadable assets" },
    };
  }
  if (assets.length > MAX_LICENSE_ASSET_IDS) {
    return {
      status: 400,
      headers: {},
      body: { error: "license download may contain at most 100 assets" },
    };
  }
  const allAssetIds = assets.map((asset) => asset.id);
  if (input.assetIds && !sameAssetSet(input.assetIds, allAssetIds)) {
    return {
      status: 400,
      headers: {},
      body: { error: "assetIds must match the complete shared-link archive" },
    };
  }
  const resolved: ResolvedAsset[] = [];
  const unresolvedOwnerIds: string[] = [];

  for (const asset of assets) {
    const photographer = await deps.findWalletForOwner(asset.ownerId);
    if (!photographer || photographer.approvalStatus === "pending") {
      unresolvedOwnerIds.push(asset.ownerId);
      continue;
    }
    resolved.push({
      assetId: asset.id,
      ownerId: asset.ownerId,
      photographer,
    });
  }

  if (unresolvedOwnerIds.length > 0) {
    return {
      status: 409,
      headers: {},
      body: {
        error:
          "every archive asset must have an approved photographer wallet before payment",
      },
    };
  }

  const payoutWallets = new Set(
    resolved.map((asset) => asset.photographer.wallet.toLowerCase()),
  );
  if (payoutWallets.size !== 1) {
    return {
      status: 409,
      headers: {},
      body: {
        error:
          "multi-photographer archives require atomic split settlement and are not available",
      },
    };
  }

  const totalAtomicUsdc = resolved.length * APERTURE_LICENSE_FEE_ATOMIC_USDC;
  const payTo = resolved[0].photographer.wallet;
  const requirements = buildPaymentRequirements(payTo, totalAtomicUsdc);
  const resourceUrl = `${deps.origin}${deps.basePath}/api/license-download`;
  const paymentResource = `x402-license-download:${sharedLink.id}`;
  const signatureHeader = deps.headers.get(PAYMENT_SIGNATURE_HEADER);
  const localProof =
    deps.localProofEnabled === true &&
    deps.headers.get(LOCAL_PROOF_HEADER) === "1";

  if (!signatureHeader && !localProof) {
    const body = paymentRequiredBody(
      requirements,
      resourceUrl,
      "Paid photo license download.",
    );
    return {
      status: 402,
      headers: paymentRequiredHeaders(body),
      body,
    };
  }

  const nowMs = deps.nowMs?.() ?? Date.now();
  const createdAt = deps.now?.() ?? new Date(nowMs).toISOString();
  const paymentId: Hex | null = localProof
    ? (deps.localProofPaymentId?.() ?? sha256Hex(randomBytes(32)))
    : x402PaymentIdentity(signatureHeader ?? "");
  if (!paymentId) {
    return {
      status: 400,
      headers: {},
      body: { error: "malformed payment header" },
    };
  }
  const snapshotHash = licenseSnapshot(sharedLink, resolved);
  let authorizationExpiresAt = nowMs + LICENSE_AUTHORIZATION_TTL_MS;
  const authorizationScope = {
    sharedLinkKey: input.sharedLinkKey,
    sharedLinkId: sharedLink.id,
    assetIds: allAssetIds,
  };
  const createAuthorization =
    deps.createAuthorization ?? createLicenseAuthorization;
  let authorization = createAuthorization(authorizationScope, {
    now: nowMs,
    nonce: paymentId.slice(2),
    expiresAt: authorizationExpiresAt,
  });
  if (!authorization) {
    return {
      status: 503,
      headers: {},
      body: { error: "license download authorization is unavailable" },
    };
  }

  let settlement: Extract<X402Settlement, { ok: true }> | null = null;
  const purchaseStore =
    deps.purchaseStore ?? createLicensePurchaseStore();
  if (!localProof) {
    const reservation = await purchaseStore.reserve(paymentId, snapshotHash);
    if (!reservation.created) {
      if (reservation.purchase.state === "reserved") {
        return {
          status: 409,
          headers: {},
          body: {
            error:
              "payment status is pending reconciliation; it will not be settled again",
          },
        };
      }
      settlement = storedSettlement(reservation.purchase);
      authorizationExpiresAt =
        reservation.purchase.authorizationExpiresAt ?? 0;
      if (!settlement || authorizationExpiresAt <= 0) {
        throw new Error(
          "Settled license purchase is missing recovery evidence.",
        );
      }
      authorization = createAuthorization(authorizationScope, {
        now: Math.min(nowMs, authorizationExpiresAt - 1),
        nonce: paymentId.slice(2),
        expiresAt: authorizationExpiresAt,
      });
    } else {
      const result = await (deps.settlePayment ?? settleX402)(
        signatureHeader ?? "",
        requirements,
      );
      if (!result.ok) {
        await purchaseStore.release(paymentId, snapshotHash);
        return {
          status: result.status,
          headers: {},
          body: { error: result.reason },
        };
      }
      settlement = result;
      await purchaseStore.markSettled(
        paymentId,
        snapshotHash,
        settlementForStorage(result),
        authorizationExpiresAt,
      );
    }
  }

  const event = downloadEvent(input.sharedLinkKey, createdAt, paymentId);
  const receipts: LicenseReceipt[] = [];
  let receiptStatus: "recorded" | "pending" = "recorded";

  for (const asset of resolved) {
    const eventId = sha256Hex({
      type: "aperture-license-receipt-v2",
      paymentId,
      sharedLinkId: sharedLink.id,
      assetId: asset.assetId,
    });
    const payoutEvidence: LicenseSettlementEvidence = settlement
      ? x402Evidence(settlement, paymentResource)
      : localProofEvidence(paymentResource);
    try {
      const result = await deps.appendReceipt({
        eventId,
        event,
        sharedLinkId: sharedLink.id,
        assetId: asset.assetId,
        ownerId: asset.ownerId,
        photographer: asset.photographer,
        amountAtomicUsdc: APERTURE_LICENSE_FEE_ATOMIC_USDC,
        evidence: payoutEvidence,
      });
      receipts.push(result.receipt);
    } catch {
      receiptStatus = "pending";
      break;
    }
  }

  if (!localProof && receiptStatus === "recorded") {
    await purchaseStore.markReceipted(paymentId, snapshotHash);
  }
  if (!authorization || authorizationExpiresAt <= nowMs) {
    return {
      status: 410,
      headers: {},
      body: {
        error:
          "the settled archive authorization expired; submit a new payment",
      },
    };
  }

  return {
    status: 200,
    headers:
      settlement?.ok && settlement.responseHeader
        ? { [PAYMENT_RESPONSE_HEADER]: settlement.responseHeader }
        : {},
    body: {
      unlocked: true,
      settlementMode: settlement?.ok ? settlement.mode : "local-proof",
      receiptStatus,
      sharedLinkId: sharedLink.id,
      receipts,
      unresolvedOwnerIds: [],
      downloadRequest: {
        url: `${deps.basePath}/api/license-archive?key=${encodeURIComponent(
          input.sharedLinkKey,
        )}&tollgateAuthorization=${encodeURIComponent(authorization)}`,
        body: {
          assetIds: resolved.map((asset) => asset.assetId),
          edited: false,
        },
      },
    },
  };
}
