import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteNode = fileURLToPath(
  new URL("../node_modules/vite-node/vite-node.mjs", import.meta.url),
);
const script = fileURLToPath(
  new URL("./rotate-fee-router-key.ts", import.meta.url),
);

const result = spawnSync(process.execPath, [viteNode, script], {
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
