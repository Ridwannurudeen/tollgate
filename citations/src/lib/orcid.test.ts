import { describe, expect, it, vi } from "vitest";
import {
  fetchOrcidWorks,
  normalizeDoi,
  normalizeOrcidId,
  orcidRecordListsDoi,
  orcidWorkDois,
} from "./orcid";

// Shaped after the live pub.orcid.org/v3.0/0000-0002-1825-0097/works response
// read on 2026-08-05: external-ids appear at both levels, external-id-normalized
// is sometimes null, and non-DOI identifier types sit alongside DOIs.
const WORKS_FIXTURE = {
  "last-modified-date": { value: 1_600_000_000_000 },
  group: [
    {
      "external-ids": {
        "external-id": [
          {
            "external-id-type": "doi",
            "external-id-value": "10.1109/TPS.1987.4316723",
            "external-id-normalized": {
              value: "10.1109/tps.1987.4316723",
              transient: true,
            },
          },
          {
            "external-id-type": "eid",
            "external-id-value": "2-s2.0-0023398608",
            "external-id-normalized": null,
          },
        ],
      },
      "work-summary": [
        {
          "external-ids": {
            "external-id": [
              {
                "external-id-type": "doi",
                "external-id-value": "10.1109/TPS.1987.4316723",
                "external-id-normalized": null,
              },
            ],
          },
        },
      ],
    },
    {
      "external-ids": null,
      "work-summary": [
        {
          "external-ids": {
            "external-id": [
              {
                "external-id-type": "doi",
                "external-id-value": "10.5555/12345680",
                "external-id-normalized": { value: "10.5555/12345680" },
              },
            ],
          },
        },
      ],
    },
  ],
  path: "/0000-0002-1825-0097/works",
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("normalizeDoi", () => {
  it("strips the prefixes a creator is likely to paste", () => {
    expect(normalizeDoi("https://doi.org/10.1109/TPS.1987.4316723")).toBe(
      "10.1109/tps.1987.4316723",
    );
    expect(normalizeDoi("http://dx.doi.org/10.5555/12345680")).toBe(
      "10.5555/12345680",
    );
    expect(normalizeDoi("doi:10.5555/12345680")).toBe("10.5555/12345680");
    expect(normalizeDoi("  10.5555/12345680  ")).toBe("10.5555/12345680");
  });
});

describe("normalizeOrcidId", () => {
  it("accepts a bare iD and the orcid.org URL form", () => {
    expect(normalizeOrcidId("0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(normalizeOrcidId("https://orcid.org/0000-0002-1825-0097")).toBe(
      "0000-0002-1825-0097",
    );
  });

  it("accepts the X checksum character", () => {
    expect(normalizeOrcidId("0000-0002-1825-009x")).toBe("0000-0002-1825-009X");
  });

  it("rejects anything that is not an ORCID iD", () => {
    expect(() => normalizeOrcidId("0000-0002-1825")).toThrow("valid ORCID iD");
    expect(() => normalizeOrcidId("../../etc/passwd")).toThrow(
      "valid ORCID iD",
    );
  });
});

describe("orcidWorkDois", () => {
  it("collects DOIs from both group and work-summary levels, deduplicated", () => {
    expect(orcidWorkDois(WORKS_FIXTURE).sort()).toEqual([
      "10.1109/tps.1987.4316723",
      "10.5555/12345680",
    ]);
  });

  it("ignores identifier types that are not DOIs", () => {
    expect(orcidWorkDois(WORKS_FIXTURE)).not.toContain("2-s2.0-0023398608");
  });

  it("survives an empty or absent record", () => {
    expect(orcidWorkDois({})).toEqual([]);
    expect(orcidWorkDois({ group: null })).toEqual([]);
    expect(orcidWorkDois({ group: [{ "work-summary": null }] })).toEqual([]);
  });
});

describe("fetchOrcidWorks", () => {
  it("asks the public API for JSON, with no token", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(WORKS_FIXTURE),
    );

    await fetchOrcidWorks("https://orcid.org/0000-0002-1825-0097", fetchImpl);

    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error("ORCID fetch was never called");
    const [url, init] = call;
    expect(url).toBe("https://pub.orcid.org/v3.0/0000-0002-1825-0097/works");
    const headers = init?.headers as Record<string, string>;
    expect(headers.accept).toBe("application/json");
    expect(headers).not.toHaveProperty("authorization");
  });

  it("throws on a non-ok response rather than reporting no works", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(
      fetchOrcidWorks("0000-0002-1825-0097", fetchImpl),
    ).rejects.toThrow("HTTP 404");
  });
});

describe("orcidRecordListsDoi", () => {
  it("matches a DOI regardless of case or prefix", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(WORKS_FIXTURE));

    await expect(
      orcidRecordListsDoi(
        "0000-0002-1825-0097",
        "https://doi.org/10.1109/TPS.1987.4316723",
        fetchImpl,
      ),
    ).resolves.toBe(true);
  });

  it("does not match a DOI the record never claimed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(WORKS_FIXTURE));

    await expect(
      orcidRecordListsDoi("0000-0002-1825-0097", "10.9999/not-mine", fetchImpl),
    ).resolves.toBe(false);
  });

  it("treats an empty DOI as no match without calling ORCID", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(WORKS_FIXTURE));

    await expect(
      orcidRecordListsDoi("0000-0002-1825-0097", "   ", fetchImpl),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
