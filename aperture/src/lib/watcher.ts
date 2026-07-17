import { parseDownloadArchiveAccessLog, resolveSharedLink } from "./immich";
import { readLicenseLedger } from "./ledger";
import type {
  DownloadArchiveEvent,
  ImmichSharedLink,
  LicenseLedger,
  LicenseReceipt,
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
  resolveSharedLink?: (key: string) => Promise<ImmichSharedLink>;
  readLedger?: () => Promise<LicenseLedger>;
};

export async function processAccessLogLine(
  line: string,
  deps: WatcherDeps,
): Promise<ProcessLineResult> {
  const event = parseDownloadArchiveAccessLog(line);
  if (!event) return { kind: "ignored" };
  if (event.status === null || event.status < 200 || event.status >= 300) {
    return { kind: "ignored" };
  }

  const linkResolver =
    deps.resolveSharedLink ??
    ((key: string) => resolveSharedLink(deps.immichApiBaseUrl, key));

  const sharedLink = await linkResolver(event.sharedLinkKey);
  const ledger = await (deps.readLedger ?? readLicenseLedger)();
  const receipts: LicenseReceipt[] = [];
  const unresolvedOwnerIds: string[] = [];

  for (const asset of sharedLink.assets) {
    let existing: LicenseReceipt | undefined;
    for (let index = ledger.receipts.length - 1; index >= 0; index -= 1) {
      const receipt = ledger.receipts[index];
      if (
        receipt.sharedLinkId === sharedLink.id &&
        receipt.assetId === asset.id
      ) {
        existing = receipt;
        break;
      }
    }
    if (existing) {
      receipts.push(existing);
      continue;
    }
    if (!unresolvedOwnerIds.includes(asset.ownerId)) {
      unresolvedOwnerIds.push(asset.ownerId);
    }
  }

  return {
    kind: "processed",
    event,
    sharedLink,
    receipts,
    unresolvedOwnerIds,
  };
}
