import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  feeRouterSplitMatchesKey,
  findFeeRouterSplit,
  parseFeeRouterSplitRegistry,
  type FeeRouterSplitKey,
  type FeeRouterSplitRegistry,
  type ParseFeeRouterSplitRegistryOptions,
  type SplitRegistryGetOrInsertResult,
  type SplitRegistryStore,
} from "../split-registry.js";

const WRITE_LOCK_RETRY_MS = 10;
const WRITE_LOCK_TIMEOUT_MS = 5_000;
const pendingInsertions = new Map<
  string,
  Promise<SplitRegistryGetOrInsertResult>
>();

function splitReservationName(key: FeeRouterSplitKey): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        key.tenantId,
        key.wallet.toLowerCase(),
        key.recipients.map((recipient) => recipient.toLowerCase()),
        key.bps,
      ]),
    )
    .digest("hex");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createFileSplitRegistryStore(
  filePath: string,
  options: ParseFeeRouterSplitRegistryOptions = {},
): SplitRegistryStore {
  const read = async (): Promise<FeeRouterSplitRegistry> => {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      return parseFeeRouterSplitRegistry(parsed, options);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { splits: [] };
      throw error;
    }
  };
  const write = async (registry: FeeRouterSplitRegistry): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await rename(tmpPath, filePath);
  };
  const withWriteLock = async <T>(task: () => Promise<T>): Promise<T> => {
    const lockPath = `${filePath}.lock`;
    const deadline = Date.now() + WRITE_LOCK_TIMEOUT_MS;
    await mkdir(dirname(filePath), { recursive: true });
    let lock: Awaited<ReturnType<typeof open>>;
    while (true) {
      try {
        lock = await open(lockPath, "wx");
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        if (Date.now() >= deadline) {
          throw new Error(
            `FeeRouter split registry write lock requires reconciliation: ${lockPath}`,
          );
        }
        await delay(WRITE_LOCK_RETRY_MS);
      }
    }
    try {
      return await task();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  };

  return {
    read,
    write,
    getOrInsert: async (key, insert) => {
      const existing = findFeeRouterSplit(await read(), key);
      if (existing) return { record: existing, inserted: false };

      const reservationDirectory = `${filePath}.pending`;
      const reservationPath = join(
        reservationDirectory,
        `${splitReservationName(key)}.json`,
      );
      const pending = pendingInsertions.get(reservationPath);
      if (pending) {
        const result = await pending;
        return { record: result.record, inserted: false };
      }

      const insertion = (async (): Promise<SplitRegistryGetOrInsertResult> => {
        await mkdir(reservationDirectory, { recursive: true });
        let reservation: Awaited<ReturnType<typeof open>> | undefined;
        try {
          reservation = await open(reservationPath, "wx");
          await reservation.writeFile(
            `${JSON.stringify({ ...key, claimedAt: new Date().toISOString() }, null, 2)}\n`,
            "utf8",
          );
          await reservation.sync();
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "EEXIST") throw error;
          const committed = findFeeRouterSplit(await read(), key);
          if (committed) return { record: committed, inserted: false };
          throw new Error(
            `FeeRouter split creation for tenant ${key.tenantId} is pending reconciliation.`,
          );
        } finally {
          await reservation?.close();
        }

        const record = await insert();
        if (!feeRouterSplitMatchesKey(record, key)) {
          throw new Error(
            "FeeRouter split insert returned a different identity.",
          );
        }
        await withWriteLock(async () => {
          const registry = await read();
          if (findFeeRouterSplit(registry, key)) {
            throw new Error(
              `FeeRouter split creation for tenant ${key.tenantId} conflicts with a committed record.`,
            );
          }
          await write({ splits: [...registry.splits, record] });
        });
        await unlink(reservationPath);
        return { record, inserted: true };
      })();
      pendingInsertions.set(reservationPath, insertion);
      try {
        return await insertion;
      } finally {
        if (pendingInsertions.get(reservationPath) === insertion) {
          pendingInsertions.delete(reservationPath);
        }
      }
    },
  };
}
