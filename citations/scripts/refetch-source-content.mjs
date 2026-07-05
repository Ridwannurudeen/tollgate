import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteNode = fileURLToPath(
  new URL("../node_modules/vite-node/vite-node.mjs", import.meta.url),
);
const script = fileURLToPath(
  new URL("./refetch-source-content.ts", import.meta.url),
);

const result = spawnSync(
  process.execPath,
  [viteNode, script, ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
