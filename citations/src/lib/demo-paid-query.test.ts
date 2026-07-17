import { describe, expect, it } from "vitest";
import { reserveDemoPaidQuery } from "./rate-limit";

// Buckets are module-level singletons, so each case uses a distinct `now` epoch
// (windows are 24h) to isolate the shared global counter from other cases.
const DAY = 24 * 60 * 60 * 1000;

describe("custodial demo paid-query caps", () => {
  it("blocks a 3rd paid demo from the same IP within 24h", () => {
    const now = 1_000 * DAY;
    const ip = "203.0.113.7";
    reserveDemoPaidQuery(ip, now);
    reserveDemoPaidQuery(ip, now);
    expect(() => reserveDemoPaidQuery(ip, now)).toThrow(/2\/day/);
  });

  it("blocks a 31st paid demo globally even from a fresh IP", () => {
    const now = 2_000 * DAY; // fresh window resets the global counter
    for (let i = 0; i < 30; i += 1) {
      reserveDemoPaidQuery(`198.51.100.${i}`, now);
    }
    expect(() =>
      reserveDemoPaidQuery("198.51.100.250", now),
    ).toThrow(/budget/);
  });

  it("reserves quota atomically and can release a pre-settlement failure", () => {
    const now = 3_000 * DAY;
    const ip = "192.0.2.42";
    const first = reserveDemoPaidQuery(ip, now);
    reserveDemoPaidQuery(ip, now);
    expect(() => reserveDemoPaidQuery(ip, now)).toThrow(/2\/day/);

    first.release();

    expect(() => reserveDemoPaidQuery(ip, now)).not.toThrow();
  });

  it("allows again after the 24h window elapses", () => {
    const ip = "203.0.113.99";
    const now = 4_000 * DAY;
    reserveDemoPaidQuery(ip, now);
    reserveDemoPaidQuery(ip, now);
    expect(() => reserveDemoPaidQuery(ip, now)).toThrow(/2\/day/);
    expect(() => reserveDemoPaidQuery(ip, now + DAY + 1)).not.toThrow();
  });
});
