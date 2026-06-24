import type { Hex } from "viem";
import { buildResolveEventId } from "./dedupe";
import { parseDownloadArchiveAccessLog, resolveSharedLink } from "./immich";
import {
  appendLicenseReceipt,
  readLicenseLedger,
  type LicenseReceiptInput,
} from "./ledger";
import { readWalletForOwner } from "./registry";
import { routeLicensePayment } from "./fee-router";
import type {
  DownloadArchiveEvent,
  ExifCredit,
  ImmichAsset,
  ImmichSharedLink,
  LicenseReceipt,
  LicenseSettlementEvidence,
  WalletRegistryEntry,
} from "./types";

export type ProcessLineResult =
  | { kind: "ignored" }
  | {
      kind: "processed";
      event: DownloadArchiveEvent;
      sharedLink: ImmichSharedLink;
      receipts: LicenseReceipt[];
      unresolvedOwnerIds: string[];
    };

export type WatcherDeps = {
  immichApiBaseUrl: string;
  amountAtomicUsdc: number;
  resolveSharedLink?: (key: string) => Promise<ImmichSharedLink>;
  findWalletForOwner?: (ownerId: string) => Promise<WalletRegistryEntry | null>;
  readExifCredit?: (asset: ImmichAsset) => Promise<ExifCredit | null>;
  findExistingReceipt?: (eventId: Hex) => Promise<LicenseReceipt | null>;
  settle?: (
    recipient: WalletRegistryEntry,
    amountAtomicUsdc: number,
  ) => Promise<LicenseSettlementEvidence | null>;
  appendReceipt?: (
    input: LicenseReceiptInput,
  ) => Promise<{ receipt: LicenseReceipt; created: boolean }>;
};

function localProofEvidence(): LicenseSettlementEvidence {
  return {
    settlementMode: "local-proof",
    paymentResource: "immich-access-log",
  };
}

export async function processAccessLogLine(
  line: string,
  deps: WatcherDeps,
): Promise<ProcessLineResult> {
  const event = parseDownloadArchiveAccessLog(line);
  if (!event) return { kind: "ignored" };

  const linkResolver =
    deps.resolveSharedLink ??
    ((key: string) => resolveSharedLink(deps.immichApiBaseUrl, key));
  const walletResolver = deps.findWalletForOwner ?? readWalletForOwner;
  const findExisting =
    deps.findExistingReceipt ??
    (async (eventId: Hex) => {
      const ledger = await readLicenseLedger();
      return (
        ledger.receipts.find((receipt) => receipt.eventId === eventId) ?? null
      );
    });
  const settle =
    deps.settle ??
    ((recipient: WalletRegistryEntry, amountAtomicUsdc: number) =>
      routeLicensePayment(recipient.wallet, amountAtomicUsdc));
  const appendReceipt =
    deps.appendReceipt ??
    (async (input: LicenseReceiptInput) => {
      const result = await appendLicenseReceipt(input);
      return { receipt: result.receipt, created: result.created };
    });

  const sharedLink = await linkResolver(event.sharedLinkKey);
  const receipts: LicenseReceipt[] = [];
  const unresolvedOwnerIds: string[] = [];

  for (const asset of sharedLink.assets) {
    const photographer = await walletResolver(asset.ownerId);
    if (!photographer) {
      unresolvedOwnerIds.push(asset.ownerId);
      continue;
    }

    const eventId = buildResolveEventId(event, sharedLink.id, asset.id);

    // Idempotency: if this resolve event was already recorded, do NOT settle
    // again. Settling before this check caused real on-chain double-payments
    // that were then silently discarded by receipt de-dup.
    const existing = await findExisting(eventId);
    if (existing) {
      receipts.push(existing);
      continue;
    }

    const exifCredit = deps.readExifCredit
      ? await deps.readExifCredit(asset)
      : null;
    const evidence =
      (await settle(photographer, deps.amountAtomicUsdc)) ??
      localProofEvidence();
    const result = await appendReceipt({
      eventId,
      event,
      sharedLinkId: sharedLink.id,
      assetId: asset.id,
      ownerId: asset.ownerId,
      photographer,
      amountAtomicUsdc: deps.amountAtomicUsdc,
      evidence,
      exifCredit,
    });
    receipts.push(result.receipt);
  }

  return {
    kind: "processed",
    event,
    sharedLink,
    receipts,
    unresolvedOwnerIds,
  };
}
