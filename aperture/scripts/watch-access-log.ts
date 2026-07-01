import { open, stat } from "node:fs/promises";
import {
  APERTURE_ACCESS_LOG,
  APERTURE_EXIF_ENABLED,
  APERTURE_IMMICH_API_BASE_URL,
  APERTURE_LICENSE_FEE_ATOMIC_USDC,
} from "../src/lib/config";
import { readAssetExifCredit } from "../src/lib/exif";
import { processAccessLogLine } from "../src/lib/watcher";

let offset = 0;

async function readNewLines(filePath: string): Promise<string[]> {
  const current = await stat(filePath);
  if (current.size < offset) offset = 0;
  if (current.size === offset) return [];

  const handle = await open(filePath, "r");
  try {
    const length = current.size - offset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    offset = current.size;
    return buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
  } finally {
    await handle.close();
  }
}

async function tick() {
  for (const line of await readNewLines(APERTURE_ACCESS_LOG)) {
    // The offset was already advanced by readNewLines, so a throw here would
    // permanently drop this line and every remaining one. Skip the bad line
    // and keep processing; append de-dup keeps retries from double-paying.
    try {
      const result = await processAccessLogLine(line, {
        immichApiBaseUrl: APERTURE_IMMICH_API_BASE_URL,
        amountAtomicUsdc: APERTURE_LICENSE_FEE_ATOMIC_USDC,
        ...(APERTURE_EXIF_ENABLED
          ? { readExifCredit: readAssetExifCredit }
          : {}),
      });
      if (result.kind === "processed") {
        console.log(
          JSON.stringify({
            kind: result.kind,
            sharedLinkId: result.sharedLink.id,
            receipts: result.receipts.map((receipt) => receipt.receiptHash),
            unresolvedOwnerIds: result.unresolvedOwnerIds,
          }),
        );
      }
    } catch (error) {
      console.error(error);
    }
  }
}

async function main() {
  offset = (await stat(APERTURE_ACCESS_LOG)).size;
  console.log(
    `Watching ${APERTURE_ACCESS_LOG} for Immich archive downloads at ${APERTURE_IMMICH_API_BASE_URL} (exif=${APERTURE_EXIF_ENABLED ? "on" : "off"})`,
  );
  setInterval(() => {
    tick().catch((error: unknown) => {
      console.error(error);
    });
  }, 1000);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
