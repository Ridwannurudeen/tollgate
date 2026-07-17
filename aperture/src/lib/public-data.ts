import { BlockList, isIP } from "node:net";
import type { LicenseLedger, LicenseReceipt } from "./types";

const EMAIL_PATTERN =
  /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/gi;
const HTTP_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const IPV4_LITERAL_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_LITERAL_PATTERN =
  /\[?[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]+(?:%[A-Za-z0-9._~-]+)?\]?/g;
const ALTERNATE_LOOPBACK_PATTERN =
  /\b(?:0+177\.0\.0\.1|127(?:\.\d{1,3}){1,2}|0x7f[0-9a-f]{6}|2130706433)\b(?!\.\d)/gi;
const WINDOWS_HOST_PATH_PATTERN =
  /(^|\s|[=:("'\[])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s"'<>]+[\\/])[^\s"'<>]*/g;
const POSIX_HOST_PATH_PATTERN =
  /(^|\s|[=:("'\[])(?:\/(?:etc|home|Users|var\/(?:lib|log|run|tmp)|opt|srv|tmp|root|mnt|media|data|private\/(?:var|etc|tmp))(?:\/[^\s"'<>]*)?)/g;
const OMIT = Symbol("omit-public-field");
const PRIVATE_FIELD_NAMES = new Set([
  "exifSourcePath",
  "filePath",
  "originalPath",
  "sourcePath",
]);
const PRIVATE_ADDRESSES = new BlockList();
const PRIVATE_IPV4_SUBNETS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const;

for (const [address, prefix] of PRIVATE_IPV4_SUBNETS) {
  PRIVATE_ADDRESSES.addSubnet(address, prefix, "ipv4");
  PRIVATE_ADDRESSES.addSubnet(`::ffff:${address}`, 96 + prefix, "ipv6");
}
PRIVATE_ADDRESSES.addAddress("::", "ipv6");
PRIVATE_ADDRESSES.addAddress("::1", "ipv6");
PRIVATE_ADDRESSES.addSubnet("fc00::", 7, "ipv6");
PRIVATE_ADDRESSES.addSubnet("fe80::", 10, "ipv6");

function privateHostname(value: string): boolean {
  const hostname = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const addressFamily = isIP(hostname);
  if (addressFamily === 4) {
    return PRIVATE_ADDRESSES.check(hostname, "ipv4");
  }
  if (addressFamily === 6) {
    return PRIVATE_ADDRESSES.check(hostname, "ipv6");
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    !hostname.includes(".")
  ) {
    return true;
  }
  return false;
}

function privateHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      privateHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function privateHttpUrlLiteral(value: string): boolean {
  if (privateHttpUrl(value)) return true;
  const withoutPunctuation = value.replace(/[),.;!?]+$/, "");
  return withoutPunctuation !== value && privateHttpUrl(withoutPunctuation);
}

function redactIpLiterals(value: string): string {
  return value
    .replace(ALTERNATE_LOOPBACK_PATTERN, "[redacted-private-ip]")
    .replace(IPV6_LITERAL_PATTERN, (candidate) => {
      const trailing = candidate.match(/\.+$/)?.[0] ?? "";
      const literal = candidate
        .slice(0, candidate.length - trailing.length)
        .replace(/^\[|\]$/g, "");
      return isIP(literal) === 6
        ? `[redacted-private-ip]${trailing}`
        : candidate;
    })
    .replace(IPV4_LITERAL_PATTERN, (literal) =>
      isIP(literal) === 4 ? "[redacted-private-ip]" : literal,
    );
}

function redactNonUrlText(value: string): string {
  return redactIpLiterals(value)
    .replace(
      WINDOWS_HOST_PATH_PATTERN,
      (_path, prefix: string) => `${prefix}[redacted-host-path]`,
    )
    .replace(
      POSIX_HOST_PATH_PATTERN,
      (_path, prefix: string) => `${prefix}[redacted-host-path]`,
    )
    .replace(EMAIL_PATTERN, "[redacted-email]");
}

export function redactPublicText(value: string): string {
  let redacted = "";
  let offset = 0;
  for (const match of value.matchAll(HTTP_URL_PATTERN)) {
    redacted += redactNonUrlText(value.slice(offset, match.index));
    redacted += privateHttpUrlLiteral(match[0])
      ? "[redacted-private-url]"
      : redactIpLiterals(match[0]).replace(EMAIL_PATTERN, "[redacted-email]");
    offset = match.index + match[0].length;
  }
  return redacted + redactNonUrlText(value.slice(offset));
}

function projectValue(
  value: unknown,
  fieldName?: string,
): unknown | typeof OMIT {
  if (fieldName && PRIVATE_FIELD_NAMES.has(fieldName)) return OMIT;
  if (typeof value === "string") {
    if (privateHttpUrlLiteral(value.trim())) return "[redacted-private-url]";
    return redactPublicText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const projected = projectValue(item);
      return projected === OMIT ? "[redacted-private-url]" : projected;
    });
  }
  if (!value || typeof value !== "object") return value;

  const projected: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const publicItem = projectValue(item, key);
    if (publicItem !== OMIT) projected[key] = publicItem;
  }
  return projected;
}

export function projectPublicData<T>(value: T): T {
  const projected = projectValue(value);
  return (projected === OMIT ? "[redacted-private-url]" : projected) as T;
}

export function publicLicenseReceipt(receipt: LicenseReceipt): LicenseReceipt {
  return projectPublicData(receipt);
}

export function publicLicenseLedger(ledger: LicenseLedger): LicenseLedger {
  return projectPublicData(ledger);
}
