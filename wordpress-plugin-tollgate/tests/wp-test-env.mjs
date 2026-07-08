import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dockerBin = process.platform === "win32" ? "docker.exe" : "docker";

function dockerAvailable() {
  for (const args of [
    ["--version"],
    ["info", "--format", "{{.ServerVersion}}"],
  ]) {
    const result = spawnSync(dockerBin, args, {
      cwd: pluginDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return false;
  }
  return true;
}

const script = dockerAvailable() ? "wp-env-smoke.mjs" : "playground-smoke.mjs";
console.log(
  script === "wp-env-smoke.mjs"
    ? "Docker is available; running wp-env WordPress smoke."
    : "Docker is unavailable; running WordPress Playground smoke.",
);

const result = spawnSync(process.execPath, [path.join("tests", script)], {
  cwd: pluginDir,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
