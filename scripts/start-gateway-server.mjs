import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadWallet } from "./wallet-keystore.mjs";

const forumWallet = await loadWallet("demo-payer");
const port = process.env.LEPTONWEB_GATEWAY_PORT ?? "3011";
const portNumber = Number(port);
if (!/^\d{2,5}$/.test(port) || portNumber < 1 || portNumber > 65535) {
  throw new Error("LEPTONWEB_GATEWAY_PORT must be a numeric TCP port.");
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
      mode: "gateway-enabled",
      url: baseUrl,
      trackRecordSigner: forumWallet.address,
      nextStep: `$env:LEPTONWEB_BASE_URL='${baseUrl}'; npm run prove:gateway-source`,
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
    LEPTONWEB_BASE_URL: baseUrl,
    LEPTONWEB_PUBLIC_URL: baseUrl,
    LEPTONWEB_GATEWAY_ENABLED: "1",
    LEPTONWEB_TRACK_RECORD_PRIVATE_KEY: forumWallet.privateKey,
  },
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
