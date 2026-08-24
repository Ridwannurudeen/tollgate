import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrcidOAuthState,
  createOrcidSession,
  exchangeOrcidCode,
  orcidIdFromSession,
  orcidOAuthEnabled,
  verifyOrcidOAuthState,
} from "./orcid-oauth";

const previousClientId = process.env.ORCID_CLIENT_ID;
const previousClientSecret = process.env.ORCID_CLIENT_SECRET;
const previousVerifySecret = process.env.TOLLGATE_VERIFY_SECRET;

function restoreEnvironment(): void {
  if (previousClientId === undefined) delete process.env.ORCID_CLIENT_ID;
  else process.env.ORCID_CLIENT_ID = previousClientId;
  if (previousClientSecret === undefined)
    delete process.env.ORCID_CLIENT_SECRET;
  else process.env.ORCID_CLIENT_SECRET = previousClientSecret;
  if (previousVerifySecret === undefined)
    delete process.env.TOLLGATE_VERIFY_SECRET;
  else process.env.TOLLGATE_VERIFY_SECRET = previousVerifySecret;
}

describe("ORCID OAuth", () => {
  beforeEach(() => {
    process.env.ORCID_CLIENT_ID = "APP-TEST";
    process.env.ORCID_CLIENT_SECRET = "test-secret";
    process.env.TOLLGATE_VERIFY_SECRET = "verify-secret";
  });

  afterEach(() => {
    restoreEnvironment();
  });

  it("stays disabled unless both credentials are configured", () => {
    delete process.env.ORCID_CLIENT_SECRET;
    expect(orcidOAuthEnabled()).toBe(false);

    process.env.ORCID_CLIENT_SECRET = "test-secret";
    delete process.env.ORCID_CLIENT_ID;
    expect(orcidOAuthEnabled()).toBe(false);
  });

  it("exchanges the authorization code server-side and returns the ORCID iD", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          access_token: "fixture-access-token",
          token_type: "bearer",
          refresh_token: "fixture-refresh-token",
          expires_in: 631138518,
          scope: "/authenticate",
          name: "Fixture Researcher",
          orcid: "0000-0002-1825-0097",
        }),
    );

    await expect(
      exchangeOrcidCode(
        "fixture-code",
        "https://tollgate.test/api/sources/paper/verify/orcid/callback",
        fetchImpl,
      ),
    ).resolves.toBe("0000-0002-1825-0097");

    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error("ORCID token exchange was never called");
    const [url, init] = call;
    expect(url).toBe("https://orcid.org/oauth/token");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ accept: "application/json" });
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const body = init?.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      client_id: "APP-TEST",
      client_secret: "test-secret",
      grant_type: "authorization_code",
      code: "fixture-code",
      redirect_uri:
        "https://tollgate.test/api/sources/paper/verify/orcid/callback",
    });
  });

  it("rejects a mismatched OAuth state", () => {
    const issued = createOrcidOAuthState("paper", 1_700_000_000_000);

    expect(
      verifyOrcidOAuthState(
        issued.cookie,
        `${issued.state}-tampered`,
        "paper",
        1_700_000_001_000,
      ),
    ).toBe(false);
  });

  it("binds the exchanged iD to one source session", () => {
    const cookie = createOrcidSession(
      "paper",
      "0000-0002-1825-0097",
      1_700_000_000_000,
    );

    expect(orcidIdFromSession(cookie, "paper", 1_700_000_001_000)).toBe(
      "0000-0002-1825-0097",
    );
    expect(
      orcidIdFromSession(cookie, "different-paper", 1_700_000_001_000),
    ).toBeNull();
  });

  it("keeps a session valid when the OAuth client secret rotates", () => {
    const cookie = createOrcidSession(
      "paper",
      "0000-0002-1825-0097",
      1_700_000_000_000,
    );
    process.env.ORCID_CLIENT_SECRET = "rotated-client-secret";

    expect(orcidIdFromSession(cookie, "paper", 1_700_000_001_000)).toBe(
      "0000-0002-1825-0097",
    );
  });
});
