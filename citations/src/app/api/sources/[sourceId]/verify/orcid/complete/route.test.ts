import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => {
  class OrcidVerificationError extends Error {
    constructor(
      message: string,
      public readonly status = 400,
    ) {
      super(message);
    }
  }
  return {
    findSource: vi.fn(),
    OrcidVerificationError,
    releaseEscrowForSource: vi.fn(),
    verifySourceByOrcidSession: vi.fn(),
  };
});

vi.mock("@/lib/catalog", () => ({
  findSource: mocks.findSource,
}));

vi.mock("@/lib/escrow", () => ({
  releaseEscrowForSource: mocks.releaseEscrowForSource,
}));

vi.mock("@/lib/source-verification", () => ({
  OrcidVerificationError: mocks.OrcidVerificationError,
  verifySourceByOrcidSession: mocks.verifySourceByOrcidSession,
}));

vi.mock("@/lib/public-origin", () => ({
  leptonwebPublicOrigin: () => "https://tollgate.test",
}));

function context(sourceId = "paper") {
  return { params: Promise.resolve({ sourceId }) };
}

const previousClientId = process.env.ORCID_CLIENT_ID;
const previousClientSecret = process.env.ORCID_CLIENT_SECRET;

describe("GET /api/sources/[sourceId]/verify/orcid/complete", () => {
  beforeEach(() => {
    process.env.ORCID_CLIENT_ID = "APP-TEST";
    process.env.ORCID_CLIENT_SECRET = "test-secret";
    mocks.findSource.mockReset();
    mocks.releaseEscrowForSource.mockReset();
    mocks.verifySourceByOrcidSession.mockReset();
  });

  afterEach(() => {
    if (previousClientId === undefined) delete process.env.ORCID_CLIENT_ID;
    else process.env.ORCID_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined)
      delete process.env.ORCID_CLIENT_SECRET;
    else process.env.ORCID_CLIENT_SECRET = previousClientSecret;
  });

  it("releases escrow only after session-bound verification succeeds", async () => {
    const source = { id: "paper", doi: "10.5555/paper" };
    const verifiedSource = {
      ...source,
      verifiedCreator: true,
      probation: false,
      ownershipProof: {
        method: "orcid",
        verifiedAt: "2026-08-24T00:00:00.000Z",
      },
    };
    mocks.findSource.mockResolvedValue(source);
    mocks.verifySourceByOrcidSession.mockResolvedValue({
      source: verifiedSource,
      sources: [verifiedSource],
    });
    mocks.releaseEscrowForSource.mockResolvedValue({
      released: true,
      amountAtomicUsdc: 1500,
      releasedReceiptHashes: ["0xrelease"],
    });
    const request = new NextRequest(
      "https://tollgate.test/api/sources/paper/verify/orcid/complete",
      { headers: { cookie: "tollgate_orcid_session=signed-session" } },
    );

    const response = await GET(request, context());

    expect(mocks.verifySourceByOrcidSession).toHaveBeenCalledWith(
      source,
      "signed-session",
    );
    expect(mocks.releaseEscrowForSource).toHaveBeenCalledWith(verifiedSource);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://tollgate.test/sources/paper?orcid=verified#verify",
    );
  });

  it("does not release escrow when the session cookie is missing or invalid", async () => {
    const source = { id: "paper", doi: "10.5555/paper" };
    mocks.findSource.mockResolvedValue(source);
    mocks.verifySourceByOrcidSession.mockRejectedValue(
      new Error("A completed ORCID OAuth session is required."),
    );
    const request = new NextRequest(
      "https://tollgate.test/api/sources/paper/verify/orcid/complete",
    );

    const response = await GET(request, context());

    expect(mocks.verifySourceByOrcidSession).toHaveBeenCalledWith(
      source,
      undefined,
    );
    expect(mocks.releaseEscrowForSource).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "ORCID verification failed.",
    });
  });

  it("returns the DOI guidance without exposing operational errors", async () => {
    const source = { id: "paper", doi: "10.5555/paper" };
    const message =
      "This paper must be listed in your ORCID record (Add works → by DOI) before Tollgate can verify it.";
    mocks.findSource.mockResolvedValue(source);
    mocks.verifySourceByOrcidSession.mockRejectedValue(
      new mocks.OrcidVerificationError(message),
    );
    const request = new NextRequest(
      "https://tollgate.test/api/sources/paper/verify/orcid/complete",
      { headers: { cookie: "tollgate_orcid_session=signed-session" } },
    );

    const response = await GET(request, context());

    expect(mocks.releaseEscrowForSource).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
  });
});
