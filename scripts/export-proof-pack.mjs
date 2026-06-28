import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();

async function runExport(app, outputPath) {
  const cwd = path.join(root, app);
  const args =
    app === "citations"
      ? ["scripts/export-proof-pack.mjs", outputPath]
      : [
          path.join("node_modules", "tsx", "dist", "cli.mjs"),
          "scripts/export-proof-pack.ts",
          outputPath,
        ];
  await execFileAsync(process.execPath, args, { cwd });
  return JSON.parse(
    await readFile(path.join(cwd, outputPath), "utf8"),
  );
}

const childOutput = path.join("data", "proof-pack.monorepo.json");
const [citations, aperture] = await Promise.all([
  runExport("citations", childOutput),
  runExport("aperture", childOutput),
]);

const combined = {
  project: "tollgate",
  generatedAt: new Date().toISOString(),
  apps: {
    citations,
    aperture,
  },
  ledger: {
    valid:
      citations.ledger?.valid === true &&
      aperture.verification?.ok === true,
    citationsLatestHash: citations.ledger?.latestHash ?? null,
    apertureLatestHash: aperture.verification?.latestHash ?? null,
  },
  traction: {
    citations: citations.traction,
    aperture: aperture.totals,
  },
};

const outputPath =
  process.argv[2] ?? path.join(root, "data", "tollgate-proof-pack.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(combined, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      outputPath,
      valid: combined.ledger.valid,
    },
    null,
    2,
  ),
);
if (!combined.ledger.valid) process.exit(1);
