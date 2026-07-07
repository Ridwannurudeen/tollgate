import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliEntry = path.join(
  pluginDir,
  "node_modules",
  "@wp-playground",
  "cli",
  "wp-playground.js",
);

const playground = spawn(
  process.execPath,
  [
    cliEntry,
    "server",
    `--auto-mount=${pluginDir}`,
    "--blueprint=tests/playground-server-blueprint.json",
    "--php=8.3",
    "--wp=latest",
    "--no-intl",
    "--no-redis",
    "--no-memcached",
    "--port=9417",
    "--site-url=http://127.0.0.1:9417",
    "--workers=6",
  ],
  { cwd: pluginDir, stdio: "inherit" },
);

playground.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 0);
});
