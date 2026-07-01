import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function sha256Hex(value: unknown): string {
  return `0x${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}
