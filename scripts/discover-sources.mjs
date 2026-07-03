import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DEFAULT_REGISTRY_PATH = path.join(
  process.cwd(),
  "citations",
  "data",
  "sources.json",
);

function flagValue(name) {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function isUnsafeHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0") return true;
  if (
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    return true;
  }
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (/^fe[89ab]/.test(host)) return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isUnsafeHost(mapped[1]);
  }
  return false;
}

function assertFetchUrl(url, allowLocal) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("discovery URL must use http or https.");
  }
  if (!allowLocal && isUnsafeHost(url.hostname)) {
    throw new Error("local/private discovery hosts require --allow-local.");
  }
}

function integerPrice(value, field) {
  const price = typeof value === "string" ? Number(value) : value;
  if (
    typeof price !== "number" ||
    !Number.isInteger(price) ||
    price < 1 ||
    price > 1_000_000
  ) {
    throw new Error(`${field} must be an integer from 1 to 1000000.`);
  }
  return price;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9-]/g, "").trim())
    .filter((tag) => tag.length >= 2)
    .slice(0, 8);
  return tags.length > 0 ? tags : undefined;
}

function parseDeclaration(value, baseUrl) {
  if (!value || typeof value !== "object") {
    throw new Error("tollgate.json must be an object.");
  }
  if (value.version !== "1") throw new Error("tollgate.json version must be 1.");
  if (typeof value.wallet !== "string" || !WALLET_PATTERN.test(value.wallet)) {
    throw new Error("wallet must be a 20-byte EVM address.");
  }
  const defaultPriceAtomicUsdc = integerPrice(
    value.defaultPriceAtomicUsdc,
    "defaultPriceAtomicUsdc",
  );
  const base = new URL(baseUrl);
  const declaredSources = Array.isArray(value.sources) ? value.sources : [];
  const sources = declaredSources.map((source, index) => {
    if (!source || typeof source !== "object") {
      throw new Error(`sources[${index}] must be an object.`);
    }
    const sourceUrl = new URL(source.url, base);
    if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
      throw new Error("sources[].url must use http or https.");
    }
    return {
      url: sourceUrl.toString(),
      priceAtomicUsdc:
        source.priceAtomicUsdc === undefined
          ? defaultPriceAtomicUsdc
          : integerPrice(source.priceAtomicUsdc, "sources[].priceAtomicUsdc"),
      ...(typeof source.title === "string" && source.title.trim()
        ? { title: source.title.trim() }
        : {}),
      ...(typeof source.summary === "string" && source.summary.trim()
        ? { summary: source.summary.trim() }
        : {}),
      ...(normalizeTags(source.tags) ? { tags: normalizeTags(source.tags) } : {}),
    };
  });
  return {
    version: "1",
    wallet: value.wallet,
    defaultPriceAtomicUsdc,
    sources:
      sources.length > 0
        ? sources
        : [{ url: base.toString(), priceAtomicUsdc: defaultPriceAtomicUsdc }],
  };
}

function parseMeta(html, baseUrl) {
  const metaPattern = /<meta\s+[^>]*>/gi;
  const attrPattern = /([a-zA-Z:-]+)\s*=\s*["']([^"']*)["']/g;
  for (const match of html.matchAll(metaPattern)) {
    const attrs = new Map();
    for (const attr of match[0].matchAll(attrPattern)) {
      attrs.set(attr[1].toLowerCase(), attr[2]);
    }
    if (attrs.get("name") !== "tollgate") continue;
    const fields = new Map(
      (attrs.get("content") ?? "")
        .split(";")
        .map((field) => field.trim())
        .filter(Boolean)
        .map((field) => {
          const [key, ...rest] = field.split("=");
          return [key.trim(), rest.join("=").trim()];
        }),
    );
    return {
      version: "1",
      wallet: fields.get("wallet"),
      defaultPriceAtomicUsdc: integerPrice(fields.get("price"), "meta price"),
      sources: [
        {
          url: new URL(baseUrl).toString(),
          priceAtomicUsdc: integerPrice(fields.get("price"), "meta price"),
        },
      ],
    };
  }
  return null;
}

async function discover(inputUrl, allowLocal) {
  const base = new URL(inputUrl);
  assertFetchUrl(base, allowLocal);
  const wellKnown = new URL("/.well-known/tollgate.json", base);
  assertFetchUrl(wellKnown, allowLocal);
  const jsonResponse = await fetch(wellKnown, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (jsonResponse?.ok) {
    return parseDeclaration(await jsonResponse.json(), base.toString());
  }

  const htmlResponse = await fetch(base, {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!htmlResponse.ok) {
    throw new Error(`discovery fetch failed: HTTP ${htmlResponse.status}`);
  }
  const meta = parseMeta(await htmlResponse.text(), base.toString());
  if (!meta) throw new Error("no tollgate declaration found.");
  return parseDeclaration(meta, base.toString());
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function registrationInputs(declaration, publisherUrl) {
  const host = new URL(publisherUrl).hostname;
  return declaration.sources.map((source, index) => ({
    id: slugify(source.title ?? `${host}-${index + 1}`),
    title: source.title ?? `Discovered source ${host} ${index + 1}`,
    creator: host,
    handle: `@${host.replace(/[^a-z0-9]/gi, "").slice(0, 32) || "publisher"}`,
    wallet: declaration.wallet,
    url: source.url,
    summary: source.summary ?? `Open-web Tollgate source declared by ${host}.`,
    tags: source.tags ?? ["discovered", "tollgate"],
    priceAtomicUsdc: source.priceAtomicUsdc,
    sourceKind: "external",
    creatorKind: "external",
    verifiedCreator: false,
    custody: "self",
    probation: true,
    registeredAt: new Date().toISOString(),
    origin: "discovered",
  }));
}

async function readRegistry(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function urlKey(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.hostname.toLowerCase()}${pathname.toLowerCase()}`;
}

async function writeRegistry(filePath, sources) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

const urls = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"));
if (urls.length === 0) {
  throw new Error(
    "Usage: node scripts/discover-sources.mjs [--write] [--allow-local] [--registry=path] <url>...",
  );
}

const registryPath = flagValue("--registry") ?? DEFAULT_REGISTRY_PATH;
const write = process.argv.includes("--write");
const allowLocal = process.argv.includes("--allow-local");
const existing = await readRegistry(registryPath);
const seenUrls = new Set(existing.map((source) => urlKey(source.url)));
const seenTitles = new Set(existing.map((source) => slugify(source.title)));
const discovered = [];

for (const url of urls) {
  const declaration = await discover(url, allowLocal);
  for (const source of registrationInputs(declaration, url)) {
    const sourceUrlKey = urlKey(source.url);
    const sourceTitleKey = slugify(source.title);
    if (seenUrls.has(sourceUrlKey) || seenTitles.has(sourceTitleKey)) continue;
    seenUrls.add(sourceUrlKey);
    seenTitles.add(sourceTitleKey);
    discovered.push(source);
  }
}

if (write && discovered.length > 0) {
  await writeRegistry(registryPath, [...existing, ...discovered]);
}

console.log(
  JSON.stringify(
    {
      registryPath,
      dryRun: !write,
      discoveredCount: discovered.length,
      discovered,
    },
    null,
    2,
  ),
);
