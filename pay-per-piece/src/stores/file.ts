import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  parseFeeRouterSplitRegistry,
  type FeeRouterSplitRegistry,
  type SplitRegistryStore,
} from "../split-registry.js";

export function createFileSplitRegistryStore(
  filePath: string,
): SplitRegistryStore {
  return {
    read: async () => {
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
        return parseFeeRouterSplitRegistry(parsed);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return { splits: [] };
        throw error;
      }
    },
    write: async (registry: FeeRouterSplitRegistry) => {
      await mkdir(dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await writeFile(
        tmpPath,
        `${JSON.stringify(registry, null, 2)}\n`,
        "utf8",
      );
      await rename(tmpPath, filePath);
    },
  };
}
