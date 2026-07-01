import type { Address, Hex } from "viem";
import { buildResolveEventId } from "./dedupe";
import { APERTURE_LICENSE_FEE_ATOMIC_USDC } from "./config";
import { readLicenseLedger, type LicenseReceiptInput } from "./ledger";
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
} from "./x402-server";

export const LOCAL_PROOF_HEADER = "X-APERTURE-LOCAL-PROOF";

export type LicenseDownloadRequest = {
  sharedLinkKey: string;
  assetIds?: string[];
};

export type LicenseDownloadDeps = {
  headers: Headers;
  origin: string;
  basePath: string;
  collectorAddress?: Address;
  localProofEnabled?: boolean;
  resolveSharedLink: (key: string) => Promise<ImmichSharedLink>;
  findWalletForOwner: (ownerId: string) => Promise<WalletRegistryEntry | null>;
  routeLicensePayment: (
    recipient: Address,
    amountAtomicUsdc: number,
  ) => Promise<LicenseSettlementEvidence | null>;
  appendReceipt: (
    input: LicenseReceiptInput,
  ) => Promise<{ receipt: LicenseReceipt; created: boolean }>;
  findExistingReceipt?: (eventId: Hex) => Promise<LicenseReceipt | null>;
  now?: () => string;
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
    rawLine: `license-download ${sharedLinkKey} ${createdAt}`,
  };
}

function selectedAssets(
  sharedLink: ImmichSharedLink,
  assetIds: string[] | undefined,
) {
  if (!assetIds || assetIds.length === 0) return sharedLink.assets;
  const requested = new Set(assetIds);
  return sharedLink.assets.filter((asset) => requested.has(asset.id));
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
  const assets = selectedAssets(sharedLink, input.assetIds);
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

  if (resolved.length === 0) {
    return {
      status: 404,
      headers: {},
      body: { error: "no approved photographer wallets for this download" },
    };
  }

  if (resolved.length > 1 && !deps.collectorAddress) {
    return {
      status: 402,
      headers: {},
      body: {
        error:
          "collector address required for multi-owner link; refusing to route the full total to a single photographer",
      },
    };
  }

  const totalAtomicUsdc = resolved.length * APERTURE_LICENSE_FEE_ATOMIC_USDC;
  const payTo = deps.collectorAddress ?? resolved[0].photographer.wallet;
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

  const settlement = localProof
    ? null
    : await (deps.settlePayment ?? settleX402)(
        signatureHeader ?? "",
        requirements,
      );
  if (settlement && !settlement.ok) {
    return {
      status: settlement.status,
      headers: {},
      body: { error: settlement.reason },
    };
  }

  const createdAt = deps.now?.() ?? new Date().toISOString();
  const event = downloadEvent(input.sharedLinkKey, createdAt);
  const receipts: LicenseReceipt[] = [];
  const findExisting =
    deps.findExistingReceipt ??
    (async (eventId: Hex) => {
      const ledger = await readLicenseLedger();
      return (
        ledger.receipts.find((receipt) => receipt.eventId === eventId) ?? null
      );
    });

  for (const asset of resolved) {
    const eventId = buildResolveEventId(event, sharedLink.id, asset.assetId);

    // Idempotency: if this resolve event was already settled, do NOT pay the
    // creator on-chain again. Paying before this check double-pays and the
    // receipt is then silently discarded by append de-dup (see watcher.ts).
    const existing = await findExisting(eventId);
    if (existing) {
      receipts.push(existing);
      continue;
    }

    const payoutEvidence =
      (await deps.routeLicensePayment(
        asset.photographer.wallet,
        APERTURE_LICENSE_FEE_ATOMIC_USDC,
      )) ??
      (settlement
        ? x402Evidence(settlement, paymentResource)
        : localProofEvidence(paymentResource));
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
      sharedLinkId: sharedLink.id,
      receipts,
      unresolvedOwnerIds,
      downloadRequest: {
        url: `/immich/api/download/archive?key=${encodeURIComponent(
          input.sharedLinkKey,
        )}`,
        body: {
          assetIds: resolved.map((asset) => asset.assetId),
          edited: false,
        },
      },
    },
  };
}
