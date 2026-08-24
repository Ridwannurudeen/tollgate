import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type {
  FeeRouterSplitKey,
  FeeRouterSplitRecord,
  FeeRouterSplitRegistry,
} from "../split-registry.js";
import { createFileSplitRegistryStore } from "./file.js";

const directories: string[] = [];
const WALLET = "0x7777777777777777777777777777777777777777" as Address;
const TX = `0x${"a".repeat(64)}` as Hex;
const LEGACY_SPLITS = Array.from({ length: 12 }, (_, index) => {
  const wallet = `0x${(index + 1).toString(16).padStart(40, "0")}` as Address;
  return {
    wallet,
    splitId: String(135 + index),
    recipients: [wallet],
    bps: [10_000],
    createSplitTx: TX,
    createdAt: "2026-07-09T00:00:00.000Z",
  };
});

function splitKey(tenantId: string, wallet: Address): FeeRouterSplitKey {
  return {
    tenantId,
    wallet,
    recipients: [wallet],
    bps: [10_000],
  };
}

function splitRecord(
  key: FeeRouterSplitKey,
  splitId: string,
): FeeRouterSplitRecord {
  return {
    ...key,
    splitId,
    createSplitTx: TX,
    createdAt: "2026-07-09T00:00:00.000Z",
  };
}

async function temporaryRegistry() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tollgate-sdk-"));
  directories.push(directory);
  const filePath = path.join(directory, "nested", "splits.json");
  return { directory, filePath, store: createFileSplitRegistryStore(filePath) };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createFileSplitRegistryStore", () => {
  it("returns an empty registry when the file does not exist", async () => {
    const { store } = await temporaryRegistry();

    await expect(store.read()).resolves.toEqual({ splits: [] });
  });

  it("writes atomically and reads a registry back", async () => {
    const { directory, filePath, store } = await temporaryRegistry();
    const registry: FeeRouterSplitRegistry = {
      splits: [
        {
          tenantId: "toy-paywall",
          wallet: WALLET,
          splitId: "42",
          recipients: [WALLET],
          bps: [10_000],
          createSplitTx: TX,
          createdAt: "2026-07-09T00:00:00.000Z",
        },
      ],
    };

    await store.write(registry);

    await expect(store.read()).resolves.toEqual(registry);
    expect(await readFile(filePath, "utf8")).toBe(
      `${JSON.stringify(registry, null, 2)}\n`,
    );
    expect(
      (await readdir(path.join(directory, "nested"))).filter((name) =>
        name.includes(".tmp."),
      ),
    ).toEqual([]);
  });

  it("claims a split before creation and shares it with a concurrent caller", async () => {
    const { store } = await temporaryRegistry();
    if (!store.getOrInsert) throw new Error("missing atomic store operation");
    const key = splitKey("toy-paywall", WALLET);
    let releaseCreation!: () => void;
    const creationBlocked = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    let creationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      creationStarted = resolve;
    });
    let secondInsertCalled = false;

    const first = store.getOrInsert(key, async () => {
      creationStarted();
      await creationBlocked;
      return splitRecord(key, "42");
    });
    await started;

    const second = store.getOrInsert(key, async () => {
      secondInsertCalled = true;
      return splitRecord(key, "43");
    });

    releaseCreation();
    await expect(first).resolves.toEqual({
      record: splitRecord(key, "42"),
      inserted: true,
    });
    await expect(second).resolves.toEqual({
      record: splitRecord(key, "42"),
      inserted: false,
    });
    expect(secondInsertCalled).toBe(false);
    await expect(
      store.getOrInsert(key, async () => splitRecord(key, "43")),
    ).resolves.toEqual({ record: splitRecord(key, "42"), inserted: false });
  });

  it("keeps an ambiguous failed creation reserved", async () => {
    const { store } = await temporaryRegistry();
    if (!store.getOrInsert) throw new Error("missing atomic store operation");
    const key = splitKey("toy-paywall", WALLET);
    let retryCalled = false;

    await expect(
      store.getOrInsert(key, async () => {
        throw new Error("receipt timed out");
      }),
    ).rejects.toThrow("receipt timed out");
    await expect(
      store.getOrInsert(key, async () => {
        retryCalled = true;
        return splitRecord(key, "43");
      }),
    ).rejects.toThrow("pending reconciliation");
    expect(retryCalled).toBe(false);
  });

  it("preserves concurrent inserts for different split identities", async () => {
    const { store } = await temporaryRegistry();
    if (!store.getOrInsert) throw new Error("missing atomic store operation");
    const firstKey = splitKey("tenant-a", WALLET);
    const secondWallet =
      "0x8888888888888888888888888888888888888888" as Address;
    const secondKey = splitKey("tenant-b", secondWallet);

    await Promise.all([
      store.getOrInsert(firstKey, async () => splitRecord(firstKey, "42")),
      store.getOrInsert(secondKey, async () => splitRecord(secondKey, "43")),
    ]);

    const registry = await store.read();
    registry.splits.sort((left, right) =>
      left.tenantId.localeCompare(right.tenantId),
    );
    expect(registry).toEqual({
      splits: [splitRecord(firstKey, "42"), splitRecord(secondKey, "43")],
    });
  });

  it("uses the explicit legacy tenant for an empty stored tenant", async () => {
    const { filePath } = await temporaryRegistry();
    const store = createFileSplitRegistryStore(filePath, {
      legacyTenantId: "citations-core",
    });
    await store.write({ splits: [] });
    await writeFile(
      filePath,
      JSON.stringify({
        splits: [
          {
            tenantId: "",
            wallet: WALLET,
            splitId: "42",
            recipients: [WALLET],
            bps: [10_000],
            createSplitTx: TX,
            createdAt: "2026-07-09T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    const registry = await store.read();

    expect(registry.splits[0]?.tenantId).toBe("citations-core");
  });

  it("round trips 12 legacy records without loss or duplicate creation", async () => {
    const { filePath } = await temporaryRegistry();
    const store = createFileSplitRegistryStore(filePath, {
      legacyTenantId: "citations-core",
    });
    await store.write({ splits: [] });
    await writeFile(
      filePath,
      `${JSON.stringify({ splits: LEGACY_SPLITS }, null, 2)}\n`,
      "utf8",
    );

    const registry = await store.read();
    expect(registry.splits).toHaveLength(12);
    expect(
      registry.splits.every(
        ({ tenantId }) => tenantId === "citations-core",
      ),
    ).toBe(true);
    if (!store.getOrInsert) throw new Error("missing atomic store operation");
    const existing = registry.splits[0];
    if (!existing) throw new Error("missing legacy split fixture");
    let createCalls = 0;

    await expect(
      store.getOrInsert(
        {
          tenantId: existing.tenantId,
          wallet: existing.wallet,
          recipients: existing.recipients,
          bps: existing.bps,
        },
        async () => {
          createCalls += 1;
          return splitRecord(splitKey("citations-core", WALLET), "999");
        },
      ),
    ).resolves.toEqual({ record: existing, inserted: false });
    expect(createCalls).toBe(0);

    await store.write(registry);

    const written = JSON.parse(await readFile(filePath, "utf8")) as {
      splits: Array<{ tenantId?: string }>;
    };
    expect(written.splits).toHaveLength(12);
    expect(
      written.splits.every(
        ({ tenantId }) => tenantId === "citations-core",
      ),
    ).toBe(true);
    await expect(store.read()).resolves.toEqual(registry);
  });

  it("drops records with invalid on-chain identifiers", async () => {
    const { filePath, store } = await temporaryRegistry();
    await store.write({ splits: [] });
    await writeFile(
      filePath,
      JSON.stringify({
        splits: [
          {
            tenantId: "toy-paywall",
            wallet: WALLET,
            splitId: "not-a-number",
            recipients: [WALLET],
            bps: [10_000],
            createSplitTx: "0xaa",
            createdAt: "2026-07-09T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    await expect(store.read()).resolves.toEqual({ splits: [] });
  });

  it("drops records with identifiers outside registry bounds", async () => {
    const { filePath, store } = await temporaryRegistry();
    await store.write({ splits: [] });
    const validRecord = {
      wallet: WALLET,
      recipients: [WALLET],
      bps: [10_000],
      createSplitTx: TX,
      createdAt: "2026-07-09T00:00:00.000Z",
    };
    await writeFile(
      filePath,
      JSON.stringify({
        splits: [
          {
            ...validRecord,
            tenantId: "t".repeat(121),
            splitId: "42",
          },
          {
            ...validRecord,
            tenantId: "toy-paywall",
            splitId: (1n << 256n).toString(),
          },
        ],
      }),
      "utf8",
    );

    await expect(store.read()).resolves.toEqual({ splits: [] });
  });
});
