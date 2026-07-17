import type { Address, Hex } from "viem";
import { sha256Hex } from "./hash";
import { appendLicenseReceipt, type LicenseReceiptInput } from "./ledger";
import {
  createLicensePurchaseStore,
  type LicensePurchase,
  type LicensePurchaseStore,
  type StoredLicenseSettlement,
} from "./license-purchase";
import { fetchImageBytes } from "./link-content";
import {
  assertLinkOriginalReadable,
  type LinkOriginalExtension,
  originalExtensionForContentType,
  readLinkOriginal,
} from "./link-originals";
import { findLink, type LinkRecord } from "./link-registry";
import { readWalletForOwner } from "./registry";
import type {
  DownloadArchiveEvent,
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

export type LinkDownloadDeps = {
  headers: Headers;
  origin: string;
  basePath: string;
  remoteAddress: string;
  userAgent: string | null;
  referer: string | null;
  findLink?: typeof findLink;
  readWalletForOwner?: typeof readWalletForOwner;
  fetchImageBytes?: typeof fetchImageBytes;
  assertLinkOriginalReadable?: typeof assertLinkOriginalReadable;
  readLinkOriginal?: typeof readLinkOriginal;
  purchaseStore?: LicensePurchaseStore;
  appendReceipt?: (
    input: LicenseReceiptInput,
  ) => Promise<{ receipt: LicenseReceipt; created: boolean }>;
  settlePayment?: (
    signatureHeader: string,
    accepted: ReturnType<typeof buildPaymentRequirements>,
    beforeSettle?: () => Promise<void>,
  ) => Promise<X402Settlement>;
  now?: () => string;
};

export type LinkDownloadResult =
  | {
      status: number;
      headers: Record<string, string>;
      body: unknown;
    }
  | {
      status: 200;
      headers: Record<string, string>;
      bytes: Uint8Array;
    };

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
  link: LinkRecord,
  deps: LinkDownloadDeps,
  createdAt: string,
  status: number,
): DownloadArchiveEvent {
  const path = `/api/links/${link.id}/download` as const;
  return {
    remoteAddress: deps.remoteAddress,
    method: "POST",
    path,
    sharedLinkKey: `aperture-link:${link.id}`,
    status,
    userAgent: deps.userAgent,
    referer: deps.referer,
    createdAt,
    rawLine: `aperture-link ${link.id} ${createdAt} ${path} ${status}`,
  };
}

function safeFilename(title: string, id: string, ext = "jpg"): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `aperture-${id}`;
  return `${base}.${ext}`;
}

function mediaLabel(link: LinkRecord): string {
  return link.mediaKind === "video" ? "video" : "photo";
}

function linkSnapshot(
  link: LinkRecord,
  photographer: WalletRegistryEntry,
): Hex {
  return sha256Hex({
    type: "aperture-link-purchase-v1",
    linkId: link.id,
    ownerId: link.ownerId,
    wallet: photographer.wallet.toLowerCase(),
    amountAtomicUsdc: link.priceAtomicUsdc,
    sourceKind: link.sourceKind ?? "url",
    sourceContentHash: link.sourceContentHash ?? null,
    sourceUrlHash: link.sourceUrl ? sha256Hex(link.sourceUrl) : null,
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

export async function handleLinkDownload(
  id: string,
  deps: LinkDownloadDeps,
): Promise<LinkDownloadResult> {
  const link = await (deps.findLink ?? findLink)(id);
  if (!link) {
    return { status: 404, headers: {}, body: { error: "link not found" } };
  }

  const photographer = await (deps.readWalletForOwner ?? readWalletForOwner)(
    link.ownerId,
  );
  if (!photographer || photographer.approvalStatus === "pending") {
    return {
      status: 404,
      headers: {},
      body: { error: "approved photographer wallet not found for this link" },
    };
  }

  const requirements = buildPaymentRequirements(
    photographer.wallet,
    link.priceAtomicUsdc,
  );
  const resourceUrl = `${deps.origin}${deps.basePath}/api/links/${link.id}/download`;
  const paymentResource = `aperture-link:${link.id}`;
  const signatureHeader = deps.headers.get(PAYMENT_SIGNATURE_HEADER);
  if (!signatureHeader) {
    const body = paymentRequiredBody(
      requirements,
      resourceUrl,
      `Paid Aperture ${mediaLabel(link)} download.`,
    );
    return {
      status: 402,
      headers: paymentRequiredHeaders(body),
      body,
    };
  }
  const paymentId = x402PaymentIdentity(signatureHeader);
  if (!paymentId) {
    return {
      status: 400,
      headers: {},
      body: { error: "malformed payment header" },
    };
  }

  const uploadExt =
    link.sourceKind === "upload" && link.originalContentType
      ? originalExtensionForContentType(link.originalContentType)
      : null;
  let uploadExtension: LinkOriginalExtension | null = null;
  let uploadContentType: string | null = null;
  let urlSource: string | null = null;

  if (link.sourceKind === "upload") {
    if (!uploadExt || !link.originalContentType) {
      return {
        status: 502,
        headers: {},
        body: { error: `uploaded ${mediaLabel(link)} metadata is missing.` },
      };
    }
    uploadExtension = uploadExt;
    uploadContentType = link.originalContentType;
    try {
      await (deps.assertLinkOriginalReadable ?? assertLinkOriginalReadable)(
        link.id,
        uploadExtension,
      );
    } catch {
      return {
        status: 410,
        headers: {},
        body: { error: "uploaded original is no longer available." },
      };
    }
  } else {
    urlSource = link.sourceUrl ?? null;
    if (!urlSource) {
      return {
        status: 502,
        headers: {},
        body: { error: "photo source is missing." },
      };
    }
  }

  const media: {
    image: {
      bytes: Uint8Array;
      contentType: string;
      ext?: string;
    } | null;
  } = { image: null };
  let mediaFailure: Exclude<LinkDownloadResult, { status: 200 }> | null =
    null;
  const loadMedia = async () => {
    if (media.image) return;
    try {
      if (link.sourceKind === "upload") {
        if (!uploadExtension || !uploadContentType) {
          mediaFailure = {
            status: 502,
            headers: {},
            body: {
              error: `uploaded ${mediaLabel(link)} metadata is missing.`,
            },
          };
          throw new Error("Uploaded media metadata is missing.");
        }
        media.image = {
          bytes: await (deps.readLinkOriginal ?? readLinkOriginal)(
            link.id,
            uploadExtension,
          ),
          contentType: uploadContentType,
          ext: uploadExtension,
        };
      } else {
        if (!urlSource) {
          mediaFailure = {
            status: 502,
            headers: {},
            body: { error: "photo source is missing." },
          };
          throw new Error("Photo source is missing.");
        }
        media.image = await (deps.fetchImageBytes ?? fetchImageBytes)(
          urlSource,
        );
      }
    } catch {
      mediaFailure ??= {
        status: link.sourceKind === "upload" ? 410 : 502,
        headers: {},
        body: {
          error:
            link.sourceKind === "upload"
              ? `uploaded ${mediaLabel(link)} is no longer available.`
              : "photo is temporarily unavailable.",
        },
      };
      throw new Error("Link media is unavailable before settlement.");
    }
  };

  const snapshotHash = linkSnapshot(link, photographer);
  const purchaseStore =
    deps.purchaseStore ?? createLicensePurchaseStore();
  const reservation = await purchaseStore.reserve(paymentId, snapshotHash);
  let settlement: Extract<X402Settlement, { ok: true }>;

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
    const recovered = storedSettlement(reservation.purchase);
    if (!recovered) {
      throw new Error(
        "Settled link purchase is missing recovery evidence.",
      );
    }
    settlement = recovered;
    try {
      await loadMedia();
    } catch (error) {
      if (mediaFailure) return mediaFailure;
      throw error;
    }
  } else {
    let result: X402Settlement;
    try {
      result = await (deps.settlePayment ?? settleX402)(
        signatureHeader,
        requirements,
        loadMedia,
      );
    } catch (error) {
      if (mediaFailure) {
        await purchaseStore.release(paymentId, snapshotHash);
        return mediaFailure;
      }
      throw error;
    }
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
      0,
    );
    if (!media.image) {
      throw new Error(
        "Settlement provider did not run the media availability check.",
      );
    }
  }
  if (!media.image) {
    throw new Error("Settled link purchase is missing downloadable media.");
  }
  const image = media.image;

  const createdAt = deps.now?.() ?? new Date().toISOString();
  const eventId = sha256Hex({
    type: "aperture-link-download-v2",
    paymentId,
    linkId: link.id,
  });
  const event = downloadEvent(link, deps, createdAt, 200);
  const appendReceipt =
    deps.appendReceipt ??
    (async (input: LicenseReceiptInput) => {
      const result = await appendLicenseReceipt(input);
      return { receipt: result.receipt, created: result.created };
    });
  let receipt: LicenseReceipt | null = null;
  let receiptStatus: "recorded" | "pending" = "recorded";
  try {
    const result = await appendReceipt({
      eventId,
      event,
      sharedLinkId: link.id,
      assetId: link.id,
      ownerId: link.ownerId,
      photographer,
      amountAtomicUsdc: link.priceAtomicUsdc,
      evidence: x402Evidence(settlement, paymentResource),
    });
    receipt = result.receipt;
    try {
      await purchaseStore.markReceipted(paymentId, snapshotHash);
    } catch {
      receiptStatus = "pending";
    }
  } catch {
    receiptStatus = "pending";
  }

  return {
    status: 200,
    bytes: image.bytes,
    headers: {
      "content-type": image.contentType,
      "content-disposition": `attachment; filename="${safeFilename(
        link.title,
        link.id,
        image.ext,
      )}"`,
      "cache-control": "no-store",
      "x-aperture-receipt-status": receiptStatus,
      ...(receipt
        ? { "x-aperture-receipt-hash": receipt.receiptHash }
        : {}),
      ...(settlement.responseHeader
        ? { [PAYMENT_RESPONSE_HEADER]: settlement.responseHeader }
        : {}),
    },
  };
}
