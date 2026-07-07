import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { sha256Hex } from "./hash";
import { appendLicenseReceipt, type LicenseReceiptInput } from "./ledger";
import { fetchImageBytes, probeImageSource } from "./link-content";
import {
  assertLinkOriginalReadable,
  type LinkOriginalExtension,
  originalExtensionForContentType,
  readLinkOriginal,
} from "./link-originals";
import { findLink, type LinkRecord } from "./link-registry";
import { readWalletForOwner } from "./registry";
import { routeLicensePayment } from "./fee-router";
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
} from "./x402-server";

export type LinkDownloadDeps = {
  headers: Headers;
  origin: string;
  basePath: string;
  remoteAddress: string;
  userAgent: string | null;
  referer: string | null;
  collectorAddress?: Address;
  findLink?: typeof findLink;
  readWalletForOwner?: typeof readWalletForOwner;
  probeImageSource?: typeof probeImageSource;
  fetchImageBytes?: typeof fetchImageBytes;
  assertLinkOriginalReadable?: typeof assertLinkOriginalReadable;
  readLinkOriginal?: typeof readLinkOriginal;
  routeLicensePayment?: typeof routeLicensePayment;
  appendReceipt?: (
    input: LicenseReceiptInput,
  ) => Promise<{ receipt: LicenseReceipt; created: boolean }>;
  settlePayment?: (
    signatureHeader: string,
    accepted: ReturnType<typeof buildPaymentRequirements>,
  ) => Promise<X402Settlement>;
  now?: () => string;
  eventNonce?: () => string;
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

async function payoutEvidence(
  photographer: WalletRegistryEntry,
  amountAtomicUsdc: number,
  paymentResource: string,
  settlement: Extract<X402Settlement, { ok: true }>,
  deps: LinkDownloadDeps,
): Promise<LicenseSettlementEvidence> {
  try {
    return (
      (await (deps.routeLicensePayment ?? routeLicensePayment)(
        photographer.wallet,
        amountAtomicUsdc,
      )) ?? x402Evidence(settlement, paymentResource)
    );
  } catch {
    return x402Evidence(settlement, paymentResource);
  }
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
    deps.collectorAddress ?? photographer.wallet,
    link.priceAtomicUsdc,
  );
  const resourceUrl = `${deps.origin}${deps.basePath}/api/links/${link.id}/download`;
  const paymentResource = `aperture-link:${link.id}`;
  const signatureHeader = deps.headers.get(PAYMENT_SIGNATURE_HEADER);
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
    try {
      await (deps.probeImageSource ?? probeImageSource)(urlSource);
    } catch (error) {
      return {
        status: 502,
        headers: {},
        body: {
          error:
            error instanceof Error
              ? error.message
              : "photo source could not be verified",
        },
      };
    }
  }

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

  const settlement = await (deps.settlePayment ?? settleX402)(
    signatureHeader,
    requirements,
  );
  if (!settlement.ok) {
    return {
      status: settlement.status,
      headers: {},
      body: { error: settlement.reason },
    };
  }

  const createdAt = deps.now?.() ?? new Date().toISOString();
  const eventNonce = deps.eventNonce?.() ?? randomUUID();
  const eventId = sha256Hex({
    type: "aperture-link-download",
    linkId: link.id,
    createdAt,
    eventNonce,
  });
  const event = downloadEvent(link, deps, createdAt, 200);
  const evidence = await payoutEvidence(
    photographer,
    link.priceAtomicUsdc,
    paymentResource,
    settlement,
    deps,
  );
  const appendReceipt =
    deps.appendReceipt ??
    (async (input: LicenseReceiptInput) => {
      const result = await appendLicenseReceipt(input);
      return { receipt: result.receipt, created: result.created };
    });
  const { receipt } = await appendReceipt({
    eventId,
    event,
    sharedLinkId: link.id,
    assetId: link.id,
    ownerId: link.ownerId,
    photographer,
    amountAtomicUsdc: link.priceAtomicUsdc,
    evidence,
  });

  let image: { bytes: Uint8Array; contentType: string; ext?: string };
  if (link.sourceKind === "upload") {
    if (!uploadExtension || !uploadContentType) {
      return {
        status: 502,
        headers: {},
        body: { error: `uploaded ${mediaLabel(link)} metadata is missing.` },
      };
    }
    try {
      image = {
        bytes: await (deps.readLinkOriginal ?? readLinkOriginal)(
          link.id,
          uploadExtension,
        ),
        contentType: uploadContentType,
        ext: uploadExtension,
      };
    } catch {
      return {
        status: 502,
        headers:
          settlement.responseHeader !== undefined
            ? { [PAYMENT_RESPONSE_HEADER]: settlement.responseHeader }
            : {},
        body: {
          error:
            `Payment settled and receipt was recorded, but the uploaded ${mediaLabel(link)} stream failed. Retry this link shortly.`,
          receiptHash: receipt.receiptHash,
        },
      };
    }
  } else {
    if (!urlSource) {
      return {
        status: 502,
        headers: {},
        body: { error: "photo source is missing." },
      };
    }
    try {
      image = await (deps.fetchImageBytes ?? fetchImageBytes)(urlSource);
    } catch {
      return {
        status: 502,
        headers:
          settlement.responseHeader !== undefined
            ? { [PAYMENT_RESPONSE_HEADER]: settlement.responseHeader }
            : {},
        body: {
          error:
            "Payment settled and receipt was recorded, but the photo stream failed. Retry this link shortly.",
          receiptHash: receipt.receiptHash,
        },
      };
    }
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
      "x-aperture-receipt-hash": receipt.receiptHash,
      ...(settlement.responseHeader
        ? { [PAYMENT_RESPONSE_HEADER]: settlement.responseHeader }
        : {}),
    },
  };
}
