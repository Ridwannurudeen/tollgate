import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const citationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const pluginDir = path.resolve(citationsDir, "..", "wordpress-plugin-tollgate");
const source = path.join(pluginDir, "dist", "tollgate.zip");
const target = path.join(citationsDir, "public", "tollgate.zip");

await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`Copied ${path.relative(citationsDir, source)} -> ${path.relative(citationsDir, target)}`);
