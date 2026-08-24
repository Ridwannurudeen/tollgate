import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeOrcidId } from "./orcid";
import { readCappedResponseText } from "./safe-fetch";

const ORCID_AUTHORIZE_URL = "https://orcid.org/oauth/authorize";
const ORCID_TOKEN_URL = "https://orcid.org/oauth/token";
const ORCID_OAUTH_TIMEOUT_MS = 8_000;
const ORCID_TOKEN_MAX_BYTES = 64 * 1024;
const ORCID_STATE_TTL_MS = 10 * 60 * 1000;
const ORCID_SESSION_TTL_MS = 5 * 60 * 1000;
const TOKEN_VERSION = "v1";

type OrcidConfig = {
  clientId: string;
  clientSecret: string;
};

type OrcidStatePayload = {
  kind: "state";
  sourceId: string;
  state: string;
  exp: number;
};

type OrcidSessionPayload = {
  kind: "session";
  sourceId: string;
  orcidId: string;
  exp: number;
};

export const ORCID_STATE_COOKIE_NAME = "tollgate_orcid_state";
export const ORCID_SESSION_COOKIE_NAME = "tollgate_orcid_session";

function orcidConfig(): OrcidConfig | null {
  const clientId = process.env.ORCID_CLIENT_ID?.trim();
  const clientSecret = process.env.ORCID_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function requireOrcidConfig(): OrcidConfig {
  const config = orcidConfig();
  if (!config) throw new Error("ORCID verification is not configured.");
  return config;
}

export function orcidOAuthEnabled(): boolean {
  return orcidConfig() !== null;
}

function verifySecret(): string {
  const secret = process.env.TOLLGATE_VERIFY_SECRET;
  if (!secret) throw new Error("TOLLGATE_VERIFY_SECRET is not configured.");
  return secret;
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function signaturesMatch(supplied: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(supplied)) return false;
  return timingSafeEqual(
    Buffer.from(supplied, "hex"),
    Buffer.from(expected, "hex"),
  );
}

function signedToken(payload: OrcidStatePayload | OrcidSessionPayload): string {
  requireOrcidConfig();
  const secret = verifySecret();
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signed = `${TOKEN_VERSION}.${encoded}`;
  return `${signed}.${signature(signed, secret)}`;
}

function tokenPayload(token: string | undefined): unknown {
  const config = orcidConfig();
  if (!config || !token) return null;
  const secret = verifySecret();
  const [version, encoded, suppliedSignature, extra] = token.trim().split(".");
  if (
    version !== TOKEN_VERSION ||
    !encoded ||
    !suppliedSignature ||
    extra !== undefined
  ) {
    return null;
  }
  const signed = `${version}.${encoded}`;
  if (!signaturesMatch(suppliedSignature, signature(signed, secret))) {
    return null;
  }
  try {
    return JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    return null;
  }
}

function isStatePayload(value: unknown): value is OrcidStatePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<OrcidStatePayload>;
  return (
    payload.kind === "state" &&
    typeof payload.sourceId === "string" &&
    typeof payload.state === "string" &&
    typeof payload.exp === "number"
  );
}

function isSessionPayload(value: unknown): value is OrcidSessionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<OrcidSessionPayload>;
  return (
    payload.kind === "session" &&
    typeof payload.sourceId === "string" &&
    typeof payload.orcidId === "string" &&
    typeof payload.exp === "number"
  );
}

export function createOrcidOAuthState(
  sourceId: string,
  now = Date.now(),
): { state: string; cookie: string } {
  const state = randomBytes(32).toString("base64url");
  return {
    state,
    cookie: signedToken({
      kind: "state",
      sourceId,
      state,
      exp: now + ORCID_STATE_TTL_MS,
    }),
  };
}

export function verifyOrcidOAuthState(
  cookieValue: string | undefined,
  suppliedState: string,
  sourceId: string,
  now = Date.now(),
): boolean {
  const payload = tokenPayload(cookieValue);
  return (
    isStatePayload(payload) &&
    payload.sourceId === sourceId &&
    payload.state === suppliedState &&
    payload.exp > now
  );
}

export function createOrcidSession(
  sourceId: string,
  orcidId: string,
  now = Date.now(),
): string {
  return signedToken({
    kind: "session",
    sourceId,
    orcidId: normalizeOrcidId(orcidId),
    exp: now + ORCID_SESSION_TTL_MS,
  });
}

export function orcidIdFromSession(
  cookieValue: string | undefined,
  sourceId: string,
  now = Date.now(),
): string | null {
  const payload = tokenPayload(cookieValue);
  if (
    !isSessionPayload(payload) ||
    payload.sourceId !== sourceId ||
    payload.exp <= now
  ) {
    return null;
  }
  try {
    return normalizeOrcidId(payload.orcidId);
  } catch {
    return null;
  }
}

export function orcidAuthorizationUrl(redirectUri: string, state: string): URL {
  const { clientId } = requireOrcidConfig();
  const url = new URL(ORCID_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "/authenticate");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeOrcidCode(
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { clientId, clientSecret } = requireOrcidConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORCID_OAUTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(ORCID_TOKEN_URL, {
      method: "POST",
      headers: { accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`ORCID token exchange failed: HTTP ${response.status}`);
    }
    const payload = JSON.parse(
      await readCappedResponseText(response, ORCID_TOKEN_MAX_BYTES),
    ) as unknown;
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as { orcid?: unknown }).orcid !== "string"
    ) {
      throw new Error("ORCID token exchange did not return an ORCID iD.");
    }
    return normalizeOrcidId((payload as { orcid: string }).orcid);
  } finally {
    clearTimeout(timeout);
  }
}

export function orcidCookieOptions(sourceId: string, maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: `/api/sources/${encodeURIComponent(sourceId)}/verify/orcid`,
    maxAge,
  };
}

export const ORCID_STATE_MAX_AGE_SECONDS = ORCID_STATE_TTL_MS / 1_000;
export const ORCID_SESSION_MAX_AGE_SECONDS = ORCID_SESSION_TTL_MS / 1_000;
