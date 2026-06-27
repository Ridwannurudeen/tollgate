import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadWallet } from "./wallet-keystore.mjs";

const facilitator = await loadWallet("x402-facilitator");
const port = process.env.LEPTONWEB_SETTLE_PORT ?? "3010";
const portNumber = Number(port);
if (!/^\d{2,5}$/.test(port) || portNumber < 1 || portNumber > 65535) {
  throw new Error("LEPTONWEB_SETTLE_PORT must be a numeric TCP port.");
}
const baseUrl = `http://127.0.0.1:${port}`;
const command = process.execPath;
const args = [
  fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)),
  "dev",
  "--hostname",
  "127.0.0.1",
  "--port",
  port,
];

console.log(
  JSON.stringify(
    {
      mode: "settle-enabled",
      url: baseUrl,
      facilitator: facilitator.address,
      nextStep: `$env:LEPTONWEB_BASE_URL='${baseUrl}'; npm run prove:settled-paid-query`,
    },
    null,
    2,
  ),
);

const child = spawn(command, args, {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    FACILITATOR_PRIVATE_KEY: facilitator.privateKey,
    LEPTONWEB_BASE_URL: baseUrl,
  },
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
