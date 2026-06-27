import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildProofPack } from "../src/lib/proof-pack";

async function main() {
  const outputPath = process.argv[2] ?? path.join("data", "proof-pack.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(await buildProofPack(), null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ outputPath }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
