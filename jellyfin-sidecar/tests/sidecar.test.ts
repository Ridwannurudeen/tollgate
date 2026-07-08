import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, type SidecarConfig } from "../src/config.js";
import { DryRunFeeRouterAdapter } from "../src/fee-router.js";
import { processJellyfinWebhook } from "../src/jellyfin.js";
import {
  readPlaybackLedger,
  verifyPlaybackLedger,
  writePlaybackLedger,
} from "../src/ledger.js";
import {
  authenticateJellyfinOperator,
  readJellyfinOperators,
  registerJellyfinOperator,
} from "../src/operators.js";
import { buildProofPack } from "../src/proof.js";
import { readCreatorRegistry } from "../src/registry.js";
import { createSidecarServer } from "../src/server.js";
import type {
  FeeRouterAdapter,
  FeeRouterSettlementInput,
  JellyfinWebhookPayload,
} from "../src/types.js";

const FIXTURES_DIR = path.join(process.cwd(), "fixtures");

async function readFixture(name: string): Promise<JellyfinWebhookPayload> {
  return JSON.parse(
    await readFile(path.join(FIXTURES_DIR, name), "utf8"),
  ) as JellyfinWebhookPayload;
}

async function createHarness(
  videos = [
    {
      itemId: "video-demo-001",
      title: "Demo Independent Film",
      displayName: "Demo Creator",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      priceAtomicUsdcPerMinute: 2500,
      approvalStatus: "operator-approved",
    },
  ],
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jellyfin-sidecar-"));
  const registryPath = path.join(dir, "registry.json");
  await writeFile(registryPath, `${JSON.stringify({ videos })}\n`, "utf8");

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

function configForHarness(harness: Awaited<ReturnType<typeof createHarness>>) {
  const base = loadConfig({}, harness.dir);
  return {
    ...base,
    port: 0,
    registryPath: harness.registryPath,
    operatorsPath: path.join(harness.dir, "operators.json"),
    ledgerPath: harness.ledgerPath,
    sessionsPath: harness.sessionsPath,
    publicWebhookUrl:
      "https://tollgate.gudman.xyz/jellyfin/api/webhooks/jellyfin",
  } satisfies SidecarConfig;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function postJson(
  baseUrl: string,
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe("jellyfin sidecar", () => {
  it("records a dry-run receipt for a PlaybackStart plus PlaybackStop pair", async () => {
    const harness = await createHarness();
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");

      await expect(
        processJellyfinWebhook(start, harness.options),
      ).resolves.toMatchObject({
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

  it("records live FeeRouter evidence while labeling fixture replay honestly", async () => {
    const harness = await createHarness();
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");
      const feeRouter: FeeRouterAdapter = {
        settle: async (input) => ({
          settlementMode: "forum-routed",
          paymentResource:
            "forum-fee-router:0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59",
          wallet: input.wallet,
          amountAtomicUsdc: input.amountAtomicUsdc,
          payer: "0x0000000000000000000000000000000000000001",
          transaction: "0xabc",
          feeRouterSplitId: "42",
          feeRouterCreateSplitTx: "0xdef",
          feeRouterPayTx: "0xabc",
        }),
      };

      await processJellyfinWebhook(start, { ...harness.options, feeRouter });
      await processJellyfinWebhook(stop, { ...harness.options, feeRouter });
      const proof = await buildProofPack({
        ledgerPath: harness.ledgerPath,
        registryPath: harness.registryPath,
        defaultAtomicUsdcPerMinute: 2500,
        feeRouterMode: "live",
      });

      expect(proof.status).toBe("LIVE-FEEROUTER-FIXTURE-REPLAY");
      expect(proof.readiness).toBe(
        "READY-needs-real-Jellyfin-webhook-plugin-event",
      );
      expect(proof.settlement.liveSpendEnabled).toBe(true);
      expect(proof.receiptOrigins).toMatchObject({
        fixtureReplayReceipts: 1,
        forumRoutedFixtureReceipts: 1,
        forumRoutedNonFixtureReceipts: 0,
      });
      expect(proof.ledger.receipts[0]?.settlement).toMatchObject({
        settlementMode: "forum-routed",
        feeRouterSplitId: "42",
        feeRouterPayTx: "0xabc",
      });
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("reports public webhook readiness for non-fixture FeeRouter receipts", async () => {
    const realItemId = "real-item-001";
    const harness = await createHarness([
      {
        itemId: realItemId,
        title: "Real Jellyfin Upload",
        displayName: "Real Creator",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        priceAtomicUsdcPerMinute: 2500,
        approvalStatus: "operator-approved",
      },
    ]);
    try {
      const start = {
        ...(await readFixture("jellyfin-playback-start.json")),
        ItemId: realItemId,
        Name: "Real Jellyfin Upload",
        UserId: "real-user-001",
        Id: "real-session-001",
      };
      const stop = {
        ...(await readFixture("jellyfin-playback-stop.json")),
        ItemId: realItemId,
        Name: "Real Jellyfin Upload",
        UserId: "real-user-001",
        Id: "real-session-001",
      };
      const feeRouter: FeeRouterAdapter = {
        settle: async (input) => ({
          settlementMode: "forum-routed",
          paymentResource:
            "forum-fee-router:0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59",
          wallet: input.wallet,
          amountAtomicUsdc: input.amountAtomicUsdc,
          payer: "0x0000000000000000000000000000000000000001",
          transaction: "0xabc",
          feeRouterSplitId: "42",
          feeRouterCreateSplitTx: "0xdef",
          feeRouterPayTx: "0xabc",
        }),
      };

      await processJellyfinWebhook(start, { ...harness.options, feeRouter });
      await processJellyfinWebhook(stop, { ...harness.options, feeRouter });
      const proof = await buildProofPack({
        ledgerPath: harness.ledgerPath,
        registryPath: harness.registryPath,
        defaultAtomicUsdcPerMinute: 2500,
        feeRouterMode: "live",
      });

      expect(proof.status).toBe("LIVE-FEEROUTER-VALIDATED");
      expect(proof.readiness).toBe("READY-public-proof-and-webhook");
      expect(proof.receiptOrigins).toMatchObject({
        fixtureReplayReceipts: 0,
        nonFixtureReceipts: 1,
        forumRoutedNonFixtureReceipts: 1,
      });
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

  it("accepts live mode with the Tollgate FeeRouter key fallback", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "jellyfin-sidecar-"));
    const dummyKey = `0x${"1".repeat(64)}`;
    try {
      const config = loadConfig(
        {
          JELLYFIN_FEE_ROUTER_MODE: "live",
          LEPTONWEB_FEE_ROUTER_PRIVATE_KEY: dummyKey,
        },
        dir,
      );

      expect(config.feeRouterMode).toBe("live");
      expect(config.feeRouterPrivateKey).toBe(dummyKey);
      expect(config.feeRouterSplitRegistryPath).toBe(
        path.join(dir, "data", "fee-router-splits.json"),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects live mode without a FeeRouter private key", () => {
    expect(() => loadConfig({ JELLYFIN_FEE_ROUTER_MODE: "live" })).toThrow(
      "JELLYFIN_FEE_ROUTER_PRIVATE_KEY",
    );
  });

  it("registers a Jellyfin operator with a hashed API key and item mapping", async () => {
    const harness = await createHarness([]);
    const config = configForHarness(harness);
    try {
      const result = await registerJellyfinOperator(
        {
          operatorName: "Studio Jellyfin",
          itemId: "movie-001",
          title: "Studio Cut",
          displayName: "Studio Creator",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          priceAtomicUsdcPerMinute: 3000,
        },
        {
          operatorsPath: config.operatorsPath,
          registryPath: config.registryPath,
          now: new Date("2026-07-08T00:00:00.000Z"),
        },
      );

      const operators = await readJellyfinOperators(config.operatorsPath);
      const registry = await readCreatorRegistry(config.registryPath);
      const authenticated = await authenticateJellyfinOperator(
        result.apiKey,
        config.operatorsPath,
      );

      expect(result.apiKey).toMatch(/^tgjf_[a-f0-9]{64}$/);
      expect(JSON.stringify(operators)).not.toContain(result.apiKey);
      expect(authenticated?.id).toBe(result.operator.id);
      expect(registry.videos[0]).toMatchObject({
        itemId: "movie-001",
        title: "Studio Cut",
        displayName: "Studio Creator",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        priceAtomicUsdcPerMinute: 3000,
        approvalStatus: "operator-approved",
      });
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("requires a registered API key before accepting Jellyfin webhooks", async () => {
    const harness = await createHarness([]);
    const config = configForHarness(harness);
    const server = createSidecarServer(config);
    const baseUrl = await listen(server);
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");
      const registration = await postJson(baseUrl, "/operators/register", {
        operatorName: "Fixture Server",
        itemId: "video-demo-001",
        displayName: "Fixture Creator",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        priceAtomicUsdcPerMinute: 2500,
      });
      const apiKey = registration.body.apiKey;
      if (typeof apiKey !== "string") throw new Error("missing API key");

      const unauthenticated = await postJson(
        baseUrl,
        "/webhooks/jellyfin",
        start,
      );
      const started = await postJson(baseUrl, "/webhooks/jellyfin", start, {
        "x-tollgate-key": apiKey,
      });
      const settled = await postJson(baseUrl, "/webhooks/jellyfin", stop, {
        authorization: `Bearer ${apiKey}`,
      });

      expect(registration.status).toBe(201);
      expect(registration.body.webhookUrl).toBe(
        "https://tollgate.gudman.xyz/jellyfin/api/webhooks/jellyfin",
      );
      expect(JSON.stringify(registration.body)).not.toContain("apiKeyHash");
      expect(unauthenticated.status).toBe(401);
      expect(started.status).toBe(200);
      expect(started.body.kind).toBe("started");
      expect(settled.status).toBe(200);
      expect(settled.body.kind).toBe("settled");
      expect((await readPlaybackLedger(config.ledgerPath)).receipts).toHaveLength(
        1,
      );
    } finally {
      await closeServer(server);
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("rejects playback events for items outside the operator key scope", async () => {
    const harness = await createHarness([]);
    const config = configForHarness(harness);
    const server = createSidecarServer(config);
    const baseUrl = await listen(server);
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const registration = await postJson(baseUrl, "/operators/register", {
        operatorName: "Fixture Server",
        itemId: "other-video-001",
        displayName: "Fixture Creator",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      });
      const apiKey = registration.body.apiKey;
      if (typeof apiKey !== "string") throw new Error("missing API key");

      const response = await postJson(baseUrl, "/webhooks/jellyfin", start, {
        "x-tollgate-key": apiKey,
      });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe(
        "Jellyfin item is not registered for this API key.",
      );
    } finally {
      await closeServer(server);
      await rm(harness.dir, { recursive: true, force: true });
    }
  });
});
