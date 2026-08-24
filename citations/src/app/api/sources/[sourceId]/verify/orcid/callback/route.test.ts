import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ORCID_STATE_COOKIE_NAME,
  createOrcidOAuthState,
} from "@/lib/orcid-oauth";
import { GET } from "./route";

vi.mock("@/lib/public-origin", () => ({
  leptonwebPublicOrigin: () => "https://tollgate.test",
}));

const previousClientId = process.env.ORCID_CLIENT_ID;
const previousClientSecret = process.env.ORCID_CLIENT_SECRET;

function context(sourceId = "paper") {
  return { params: Promise.resolve({ sourceId }) };
}

describe("GET /api/sources/[sourceId]/verify/orcid/callback", () => {
  beforeEach(() => {
    process.env.ORCID_CLIENT_ID = "APP-TEST";
    process.env.ORCID_CLIENT_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousClientId === undefined) delete process.env.ORCID_CLIENT_ID;
    else process.env.ORCID_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined)
      delete process.env.ORCID_CLIENT_SECRET;
    else process.env.ORCID_CLIENT_SECRET = previousClientSecret;
  });

  it("rejects a callback whose state does not match the session", async () => {
    const issued = createOrcidOAuthState("paper");
    const request = new NextRequest(
      `https://tollgate.test/api/sources/paper/verify/orcid/callback?code=fixture-code&state=${issued.state}-tampered`,
      {
        headers: {
          cookie: `${ORCID_STATE_COOKIE_NAME}=${issued.cookie}`,
        },
      },
    );

    const response = await GET(request, context());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "ORCID OAuth state did not match this session.",
    });
  });

  it("binds the server-exchanged iD to a session before verification", async () => {
    const issued = createOrcidOAuthState("paper");
    const fetchImpl = vi.fn(async () =>
      Response.json({ orcid: "0000-0002-1825-0097" }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const request = new NextRequest(
      `https://tollgate.test/api/sources/paper/verify/orcid/callback?code=fixture-code&state=${issued.state}`,
      {
        headers: {
          cookie: `${ORCID_STATE_COOKIE_NAME}=${issued.cookie}`,
        },
      },
    );

    const response = await GET(request, context());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://tollgate.test/api/sources/paper/verify/orcid/complete",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "tollgate_orcid_session=",
    );
  });
});
