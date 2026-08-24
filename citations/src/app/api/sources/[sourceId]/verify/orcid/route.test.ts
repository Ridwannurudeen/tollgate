import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  findSource: vi.fn(),
}));

vi.mock("@/lib/catalog", () => ({
  findSource: mocks.findSource,
}));

vi.mock("@/lib/public-origin", () => ({
  leptonwebPublicOrigin: () => "https://tollgate.test",
}));

const previousClientId = process.env.ORCID_CLIENT_ID;
const previousClientSecret = process.env.ORCID_CLIENT_SECRET;
const previousVerifySecret = process.env.TOLLGATE_VERIFY_SECRET;

function context(sourceId = "paper") {
  return { params: Promise.resolve({ sourceId }) };
}

describe("GET /api/sources/[sourceId]/verify/orcid", () => {
  beforeEach(() => {
    delete process.env.ORCID_CLIENT_ID;
    delete process.env.ORCID_CLIENT_SECRET;
    mocks.findSource.mockReset();
  });

  afterEach(() => {
    if (previousClientId === undefined) delete process.env.ORCID_CLIENT_ID;
    else process.env.ORCID_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined)
      delete process.env.ORCID_CLIENT_SECRET;
    else process.env.ORCID_CLIENT_SECRET = previousClientSecret;
    if (previousVerifySecret === undefined)
      delete process.env.TOLLGATE_VERIFY_SECRET;
    else process.env.TOLLGATE_VERIFY_SECRET = previousVerifySecret;
  });

  it("is disabled when the ORCID credentials are unset", async () => {
    const response = await GET(
      new NextRequest("https://tollgate.test/api/sources/paper/verify/orcid"),
      context(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "ORCID verification is not configured.",
    });
    expect(mocks.findSource).not.toHaveBeenCalled();
  });

  it("redirects to ORCID authenticate with source-bound state", async () => {
    process.env.ORCID_CLIENT_ID = "APP-TEST";
    process.env.ORCID_CLIENT_SECRET = "test-secret";
    process.env.TOLLGATE_VERIFY_SECRET = "verify-secret";
    mocks.findSource.mockResolvedValue({ id: "paper", doi: "10.5555/paper" });

    const response = await GET(
      new NextRequest("https://tollgate.test/api/sources/paper/verify/orcid"),
      context(),
    );
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(307);
    expect(location.origin).toBe("https://orcid.org");
    expect(location.pathname).toBe("/oauth/authorize");
    expect(location.searchParams.get("scope")).toBe("/authenticate");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain(
      "tollgate_orcid_state=",
    );
  });
});
