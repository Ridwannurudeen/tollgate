import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DryRunFeeRouterAdapter } from "../src/fee-router.js";
import { processJellyfinWebhook } from "../src/jellyfin.js";
import {
  readPlaybackLedger,
  verifyPlaybackLedger,
  writePlaybackLedger,
} from "../src/ledger.js";
import type {
  FeeRouterSettlementInput,
  JellyfinWebhookPayload,
} from "../src/types.js";

const FIXTURES_DIR = path.join(process.cwd(), "fixtures");

async function readFixture(name: string): Promise<JellyfinWebhookPayload> {
  return JSON.parse(
    await readFile(path.join(FIXTURES_DIR, name), "utf8"),
  ) as JellyfinWebhookPayload;
}

async function createHarness() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jellyfin-sidecar-"));
  const registryPath = path.join(dir, "registry.json");
  await writeFile(
    registryPath,
    `${JSON.stringify({
      videos: [
        {
          itemId: "video-demo-001",
          title: "Demo Independent Film",
          displayName: "Demo Creator",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          priceAtomicUsdcPerMinute: 2500,
          approvalStatus: "operator-approved",
        },
      ],
    })}\n`,
    "utf8",
  );

  const settlements: FeeRouterSettlementInput[] = [];
  const feeRouter = new (class extends DryRunFeeRouterAdapter {
    override async settle(input: FeeRouterSettlementInput) {
      settlements.push(input);
      return super.settle(input);
    }
  })();

  return {
    dir,
    registryPath,
    ledgerPath: path.join(dir, "ledger.json"),
    sessionsPath: path.join(dir, "sessions.json"),
    settlements,
    options: {
      registryPath,
      ledgerPath: path.join(dir, "ledger.json"),
      sessionsPath: path.join(dir, "sessions.json"),
      defaultAtomicUsdcPerMinute: 2500,
      feeRouter,
    },
  };
}

describe("jellyfin sidecar", () => {
  it("records a dry-run receipt for a PlaybackStart plus PlaybackStop pair", async () => {
    const harness = await createHarness();
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");

      await expect(processJellyfinWebhook(start, harness.options)).resolves.toMatchObject({
        kind: "started",
      });
      const result = await processJellyfinWebhook(stop, harness.options);
      const ledger = await readPlaybackLedger(harness.ledgerPath);

      expect(result).toMatchObject({ kind: "settled", created: true });
      expect(ledger.receipts).toHaveLength(1);
      expect(ledger.receipts[0]).toMatchObject({
        itemId: "video-demo-001",
        creator: "Demo Creator",
        watchedSeconds: 120,
        watchedMinutes: 2,
        amountAtomicUsdc: 5000,
        settlement: { settlementMode: "dry-run", dryRun: true },
      });
      expect(harness.settlements).toHaveLength(1);
      expect(verifyPlaybackLedger(ledger).ok).toBe(true);
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("does not settle or append again for a duplicate PlaybackStop", async () => {
    const harness = await createHarness();
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");

      await processJellyfinWebhook(start, harness.options);
      await processJellyfinWebhook(stop, harness.options);
      const duplicate = await processJellyfinWebhook(stop, harness.options);
      const ledger = await readPlaybackLedger(harness.ledgerPath);

      expect(duplicate).toMatchObject({ kind: "settled", created: false });
      expect(ledger.receipts).toHaveLength(1);
      expect(harness.settlements).toHaveLength(1);
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("fails hash-chain verification when a receipt is tampered", async () => {
    const harness = await createHarness();
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");

      await processJellyfinWebhook(start, harness.options);
      await processJellyfinWebhook(stop, harness.options);
      const ledger = await readPlaybackLedger(harness.ledgerPath);
      const receipt = ledger.receipts[0];
      if (!receipt) throw new Error("expected a receipt");
      ledger.receipts[0] = {
        ...receipt,
        watchedMinutes: receipt.watchedMinutes + 1,
      };
      await writePlaybackLedger(ledger, harness.ledgerPath);

      const verification = verifyPlaybackLedger(
        await readPlaybackLedger(harness.ledgerPath),
      );
      expect(verification.ok).toBe(false);
      expect(verification.issues[0]?.reason).toBe(
        "receiptHash does not match the stored receipt payload.",
      );
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });
});
