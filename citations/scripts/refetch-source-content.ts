import { refetchCustomSourceContent } from "../src/lib/catalog";

function flagValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
}

const registryPath = flagValue("--registry");
const refreshAll = process.argv.includes("--all");

const result = await refetchCustomSourceContent({
  ...(registryPath ? { filePath: registryPath } : {}),
  refreshAll,
});

console.log(JSON.stringify(result, null, 2));
