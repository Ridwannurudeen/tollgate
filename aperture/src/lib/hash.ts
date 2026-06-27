import { createHash } from "node:crypto";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stable(entry)]),
  );
}

export function sha256Hex(value: unknown): `0x${string}` {
  const encoded =
    typeof value === "string" ? value : JSON.stringify(stable(value));
  return `0x${createHash("sha256").update(encoded).digest("hex")}`;
}
