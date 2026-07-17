import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, type SidecarConfig } from "../src/config.js";
import { DryRunFeeRouterAdapter } from "../src/fee-router.js";
import {
  normalizeJellyfinEvent,
  processJellyfinWebhook,
  verifyJellyfinPlaybackStart,
} from "../src/jellyfin.js";
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

function liveOptions(
  harness: Awaited<ReturnType<typeof createHarness>>,
  options: {
    now: () => Date;
    verifyPlaybackStart?: () => Promise<{
      playbackPositionTicks: number;
      runTimeTicks: number;
    } | null>;
    maxAtomicUsdcPerEvent?: number;
    maxDailyAtomicUsdc?: number;
  },
) {
  return {
    ...harness.options,
    liveSettlement: true,
    verifyPlaybackStart:
      options.verifyPlaybackStart ??
      (async () => ({
        playbackPositionTicks: 0,
        runTimeTicks: 72_000_000_000,
      })),
    now: options.now,
    maxAtomicUsdcPerEvent: options.maxAtomicUsdcPerEvent ?? 1_000_000,
    maxDailyAtomicUsdc: options.maxDailyAtomicUsdc ?? 10_000_000,
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
    registrationSecret: "registration-capability",
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

  it("settles at most once for concurrent duplicate PlaybackStop events", async () => {
    const harness = await createHarness();
    const settlements: FeeRouterSettlementInput[] = [];
    const feeRouter = new (class extends DryRunFeeRouterAdapter {
      override async settle(input: FeeRouterSettlementInput) {
        settlements.push(input);
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        return super.settle(input);
      }
    })();
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");

      await processJellyfinWebhook(start, harness.options);
      const results = await Promise.all([
        processJellyfinWebhook(stop, { ...harness.options, feeRouter }),
        processJellyfinWebhook(stop, { ...harness.options, feeRouter }),
      ]);
      const ledger = await readPlaybackLedger(harness.ledgerPath);

      expect(settlements).toHaveLength(1);
      expect(ledger.receipts).toHaveLength(1);
      expect(
        results.filter(
          (result) => result.kind === "settled" && result.created,
        ),
      ).toHaveLength(1);
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("does not settle a stop-only live event with a caller-authored 24-hour position", async () => {
    const harness = await createHarness();
    try {
      const stop = {
        ...(await readFixture("jellyfin-playback-stop.json")),
        PlaybackPositionTicks: 864_000_000_000,
        RunTimeTicks: 864_000_000_000,
        PlayedToCompletion: true,
      };

      const result = await processJellyfinWebhook(
        stop,
        liveOptions(harness, {
          now: () => new Date("2026-07-03T11:00:00.000Z"),
        }),
      );

      expect(result).toEqual({
        kind: "ignored",
        reason: "verified playback start is required",
      });
      expect(harness.settlements).toHaveLength(0);
      expect(
        (await readPlaybackLedger(harness.ledgerPath)).receipts,
      ).toHaveLength(0);
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("requires the Jellyfin server to verify a live playback start", async () => {
    const harness = await createHarness();
    try {
      const start = await readFixture("jellyfin-playback-start.json");

      const result = await processJellyfinWebhook(
        start,
        liveOptions(harness, {
          now: () => new Date("2026-07-03T11:00:00.000Z"),
          verifyPlaybackStart: async () => null,
        }),
      );

      expect(result).toMatchObject({
        kind: "unresolved",
        reason: "active playback was not verified by Jellyfin",
      });
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("verifies a live start against the active Jellyfin server session", async () => {
    const start = normalizeJellyfinEvent(
      await readFixture("jellyfin-playback-start.json"),
    );
    if (!start) throw new Error("expected a normalized start event");
    let requestUrl = "";
    let authorization = "";
    const fetchStub: typeof fetch = async (input, init) => {
      requestUrl = input.toString();
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(
        JSON.stringify([
          {
            Id: "session-001",
            UserId: "user-001",
            DeviceId: "device-001",
            IsActive: true,
            NowPlayingItem: {
              Id: "video-demo-001",
              RunTimeTicks: 72_000_000_000,
            },
            PlayState: {
              PositionTicks: 30_000_000,
            },
          },
        ]),
        {
          headers: { "content-type": "application/json" },
        },
      );
    };

    await expect(
      verifyJellyfinPlaybackStart(start, {
        serverUrl: "http://127.0.0.1:8096/",
        apiKey: "server-api-key",
        fetch: fetchStub,
      }),
    ).resolves.toEqual({
      playbackPositionTicks: 30_000_000,
      runTimeTicks: 72_000_000_000,
    });
    expect(requestUrl).toBe(
      "http://127.0.0.1:8096/Sessions?activeWithinSeconds=120",
    );
    expect(requestUrl).not.toContain("server-api-key");
    expect(authorization).toBe('MediaBrowser Token="server-api-key"');
  });

  it("rejects a Jellyfin session that is playing a different item", async () => {
    const start = normalizeJellyfinEvent(
      await readFixture("jellyfin-playback-start.json"),
    );
    if (!start) throw new Error("expected a normalized start event");
    const fetchStub: typeof fetch = async () =>
      new Response(
        JSON.stringify([
          {
            Id: "session-001",
            UserId: "user-001",
            DeviceId: "device-001",
            IsActive: true,
            NowPlayingItem: {
              Id: "attacker-selected-item",
              RunTimeTicks: 72_000_000_000,
            },
            PlayState: {
              PositionTicks: 0,
            },
          },
        ]),
      );

    await expect(
      verifyJellyfinPlaybackStart(start, {
        serverUrl: "http://127.0.0.1:8096/",
        apiKey: "server-api-key",
        fetch: fetchStub,
      }),
    ).resolves.toBeNull();
  });

  it("bounds a live payout by server-observed elapsed time", async () => {
    const harness = await createHarness();
    let now = new Date("2026-07-03T11:00:00.000Z");
    const options = liveOptions(harness, { now: () => now });
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");

      await processJellyfinWebhook(start, options);
      now = new Date("2026-07-03T11:00:30.000Z");
      const result = await processJellyfinWebhook(stop, options);

      expect(result).toMatchObject({
        kind: "settled",
        receipt: {
          watchedSeconds: 30,
          watchedMinutes: 1,
          amountAtomicUsdc: 2500,
          startedAt: "2026-07-03T11:00:00.000Z",
          stoppedAt: "2026-07-03T11:00:30.000Z",
        },
      });
      expect(harness.settlements).toHaveLength(1);
      expect(harness.settlements[0]?.amountAtomicUsdc).toBe(2500);
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("enforces the per-event live settlement cap before calling FeeRouter", async () => {
    const harness = await createHarness();
    let now = new Date("2026-07-03T11:00:00.000Z");
    const options = liveOptions(harness, {
      now: () => now,
      maxAtomicUsdcPerEvent: 4000,
    });
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");

      await processJellyfinWebhook(start, options);
      now = new Date("2026-07-03T11:02:00.000Z");
      const result = await processJellyfinWebhook(stop, options);

      expect(result).toEqual({
        kind: "ignored",
        reason: "per-event live settlement cap exceeded",
      });
      expect(harness.settlements).toHaveLength(0);
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("enforces the persistent daily live settlement cap across events", async () => {
    const harness = await createHarness([
      {
        itemId: "video-demo-001",
        title: "First Video",
        displayName: "First Creator",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        priceAtomicUsdcPerMinute: 2500,
        approvalStatus: "operator-approved",
      },
      {
        itemId: "video-demo-002",
        title: "Second Video",
        displayName: "Second Creator",
        wallet: "0x9999999999999999999999999999999999999999",
        priceAtomicUsdcPerMinute: 2500,
        approvalStatus: "operator-approved",
      },
    ]);
    let now = new Date("2026-07-03T11:00:00.000Z");
    const options = liveOptions(harness, {
      now: () => now,
      maxDailyAtomicUsdc: 4000,
    });
    try {
      const firstStart = await readFixture("jellyfin-playback-start.json");
      const firstStop = await readFixture("jellyfin-playback-stop.json");
      const secondStart = {
        ...firstStart,
        ItemId: "video-demo-002",
        UserId: "user-002",
        Id: "session-002",
      };
      const secondStop = {
        ...firstStop,
        ItemId: "video-demo-002",
        UserId: "user-002",
        Id: "session-002",
      };

      await processJellyfinWebhook(firstStart, options);
      now = new Date("2026-07-03T11:01:00.000Z");
      await expect(
        processJellyfinWebhook(firstStop, options),
      ).resolves.toMatchObject({ kind: "settled" });
      now = new Date("2026-07-03T11:02:00.000Z");
      await processJellyfinWebhook(secondStart, options);
      now = new Date("2026-07-03T11:03:00.000Z");
      const second = await processJellyfinWebhook(secondStop, options);

      expect(second).toEqual({
        kind: "ignored",
        reason: "daily live settlement cap exceeded",
      });
      expect(harness.settlements).toHaveLength(1);
      expect(
        (await readPlaybackLedger(harness.ledgerPath)).receipts,
      ).toHaveLength(1);
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("does not let a changed caller event ID settle a verified session twice", async () => {
    const harness = await createHarness();
    let now = new Date("2026-07-03T11:00:00.000Z");
    const options = liveOptions(harness, { now: () => now });
    try {
      const start = await readFixture("jellyfin-playback-start.json");
      const stop = await readFixture("jellyfin-playback-stop.json");

      await processJellyfinWebhook(start, options);
      now = new Date("2026-07-03T11:01:00.000Z");
      await processJellyfinWebhook({ ...stop, EventId: "first" }, options);
      const replay = await processJellyfinWebhook(
        { ...stop, EventId: "second" },
        options,
      );

      expect(replay).toEqual({
        kind: "ignored",
        reason: "verified playback start is required",
      });
      expect(harness.settlements).toHaveLength(1);
      expect(
        (await readPlaybackLedger(harness.ledgerPath)).receipts,
      ).toHaveLength(1);
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("preserves historical FeeRouter fixture evidence while current live spend is disabled", async () => {
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
        feeRouterMode: "dry-run",
      });

      expect(proof.status).toBe("LIVE-FEEROUTER-FIXTURE-REPLAY");
      expect(proof.readiness).toBe(
        "READY-needs-real-Jellyfin-webhook-plugin-event",
      );
      expect(proof.settlement.liveSpendEnabled).toBe(false);
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

  it("omits viewer and session identifiers from public proof without changing the ledger", async () => {
    const harness = await createHarness();
    const privateUserId = "private-viewer-001";
    const privateSessionId = "private-session-001";
    try {
      const start = {
        ...(await readFixture("jellyfin-playback-start.json")),
        UserId: privateUserId,
        Id: privateSessionId,
      };
      const stop = {
        ...(await readFixture("jellyfin-playback-stop.json")),
        UserId: privateUserId,
        Id: privateSessionId,
      };

      await processJellyfinWebhook(start, harness.options);
      await processJellyfinWebhook(stop, harness.options);
      const storedLedger = await readPlaybackLedger(harness.ledgerPath);
      const proof = await buildProofPack({
        ledgerPath: harness.ledgerPath,
        registryPath: harness.registryPath,
        defaultAtomicUsdcPerMinute: 2500,
        feeRouterMode: "dry-run",
      });
      const storedLedgerAfterProof = await readPlaybackLedger(
        harness.ledgerPath,
      );

      expect(storedLedger.receipts[0]).toMatchObject({
        userId: privateUserId,
        sessionId: privateSessionId,
      });
      expect(storedLedgerAfterProof).toEqual(storedLedger);
      expect(verifyPlaybackLedger(storedLedger).ok).toBe(true);
      expect(proof.ledger.receipts[0]).not.toHaveProperty("userId");
      expect(proof.ledger.receipts[0]).not.toHaveProperty("sessionId");
      expect(JSON.stringify(proof)).not.toContain(privateUserId);
      expect(JSON.stringify(proof)).not.toContain(privateSessionId);
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

  it("does not accept cross-service FeeRouter private-key fallbacks", () => {
    const dummyKey = `0x${"1".repeat(64)}`;

    expect(() =>
      loadConfig({
        JELLYFIN_FEE_ROUTER_MODE: "live",
        LEPTONWEB_FEE_ROUTER_PRIVATE_KEY: dummyKey,
        APERTURE_FEE_ROUTER_PRIVATE_KEY: dummyKey,
        JELLYFIN_SERVER_URL: "http://127.0.0.1:8096",
        JELLYFIN_API_KEY: "server-api-key",
      }),
    ).toThrow("JELLYFIN_FEE_ROUTER_PRIVATE_KEY is required");
  });

  it("fails closed when live mode is fully configured", () => {
    const dummyKey = `0x${"1".repeat(64)}`;

    expect(() =>
      loadConfig({
        JELLYFIN_FEE_ROUTER_MODE: "live",
        JELLYFIN_FEE_ROUTER_PRIVATE_KEY: dummyKey,
        JELLYFIN_SERVER_URL: "http://127.0.0.1:8096",
        JELLYFIN_API_KEY: "server-api-key",
      }),
    ).toThrow(
      "disabled until durable pre-payment journaling and reconciliation are implemented",
    );
  });

  it("rejects live mode without a FeeRouter private key", () => {
    expect(() => loadConfig({ JELLYFIN_FEE_ROUTER_MODE: "live" })).toThrow(
      "JELLYFIN_FEE_ROUTER_PRIVATE_KEY",
    );
  });

  it("rejects live mode without Jellyfin server verification credentials", () => {
    const dummyKey = `0x${"1".repeat(64)}`;

    expect(() =>
      loadConfig({
        JELLYFIN_FEE_ROUTER_MODE: "live",
        JELLYFIN_FEE_ROUTER_PRIVATE_KEY: dummyKey,
      }),
    ).toThrow("JELLYFIN_SERVER_URL");
    expect(() =>
      loadConfig({
        JELLYFIN_FEE_ROUTER_MODE: "live",
        JELLYFIN_FEE_ROUTER_PRIVATE_KEY: dummyKey,
        JELLYFIN_SERVER_URL: "http://127.0.0.1:8096",
      }),
    ).toThrow("JELLYFIN_API_KEY");
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

  it("does not let a later registration change an item's operator fields", async () => {
    const harness = await createHarness([]);
    const config = configForHarness(harness);
    try {
      await registerJellyfinOperator(
        {
          operatorName: "Original Jellyfin",
          itemId: "movie-001",
          title: "Original Cut",
          displayName: "Original Creator",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          priceAtomicUsdcPerMinute: 3000,
        },
        {
          operatorsPath: config.operatorsPath,
          registryPath: config.registryPath,
        },
      );

      await expect(
        registerJellyfinOperator(
          {
            operatorName: "Replacement Jellyfin",
            itemId: "movie-001",
            title: "Replacement Cut",
            displayName: "Replacement Creator",
            wallet: "0x9999999999999999999999999999999999999999",
            priceAtomicUsdcPerMinute: 9000,
          },
          {
            operatorsPath: config.operatorsPath,
            registryPath: config.registryPath,
          },
        ),
      ).rejects.toMatchObject({
        status: 409,
      });

      const registry = await readCreatorRegistry(config.registryPath);
      const operators = await readJellyfinOperators(config.operatorsPath);
      expect(registry.videos).toHaveLength(1);
      expect(registry.videos[0]).toMatchObject({
        itemId: "movie-001",
        title: "Original Cut",
        displayName: "Original Creator",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        priceAtomicUsdcPerMinute: 3000,
      });
      expect(operators.operators).toHaveLength(1);
      expect(operators.operators[0]?.operatorName).toBe("Original Jellyfin");
    } finally {
      await rm(harness.dir, { recursive: true, force: true });
    }
  });

  it("requires the server registration capability before issuing an API key", async () => {
    const harness = await createHarness([]);
    const config = configForHarness(harness);
    const server = createSidecarServer(config);
    const baseUrl = await listen(server);
    const registration = {
      operatorName: "Fixture Server",
      itemId: "video-demo-001",
      displayName: "Fixture Creator",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
    };
    try {
      const missing = await postJson(
        baseUrl,
        "/operators/register",
        registration,
      );
      const invalid = await postJson(
        baseUrl,
        "/operators/register",
        registration,
        {
          "x-tollgate-registration-secret": "wrong-capability",
        },
      );

      expect(missing.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(missing.body.error).toBe("invalid registration capability");
      expect(invalid.body.error).toBe("invalid registration capability");
      expect(
        (await readJellyfinOperators(config.operatorsPath)).operators,
      ).toHaveLength(0);
      expect((await readCreatorRegistry(config.registryPath)).videos).toHaveLength(
        0,
      );
    } finally {
      await closeServer(server);
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
      const registration = await postJson(
        baseUrl,
        "/operators/register",
        {
          operatorName: "Fixture Server",
          itemId: "video-demo-001",
          displayName: "Fixture Creator",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          priceAtomicUsdcPerMinute: 2500,
        },
        {
          "x-tollgate-registration-secret": "registration-capability",
        },
      );
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
      const registration = await postJson(
        baseUrl,
        "/operators/register",
        {
          operatorName: "Fixture Server",
          itemId: "other-video-001",
          displayName: "Fixture Creator",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        },
        {
          "x-tollgate-registration-secret": "registration-capability",
        },
      );
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
