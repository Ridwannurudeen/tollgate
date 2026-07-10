import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { FeeRouterSplitRegistry } from "../split-registry.js";
import { createFileSplitRegistryStore } from "./file.js";

const directories: string[] = [];
const WALLET = "0x7777777777777777777777777777777777777777" as Address;
const TX = `0x${"a".repeat(64)}` as Hex;

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

  it("drops records without an explicit tenant", async () => {
    const { filePath, store } = await temporaryRegistry();
    await store.write({ splits: [] });
    await writeFile(
      filePath,
      JSON.stringify({
        splits: [
          {
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

    expect(registry.splits).toEqual([]);
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
