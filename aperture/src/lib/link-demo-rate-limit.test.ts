import { describe, expect, it } from "vitest";
import {
  assertDemoUnlockWithinLimits,
  recordDemoUnlock,
} from "./link-rate-limit";

const DAY = 24 * 60 * 60 * 1000;

describe("BYO-link custodial unlock caps", () => {
  it("blocks a 3rd free unlock from the same IP within 24h", () => {
    const now = 1_000 * DAY;
    const ip = "203.0.113.7";
    assertDemoUnlockWithinLimits(ip, now);
    recordDemoUnlock(ip, now);
    recordDemoUnlock(ip, now);
    expect(() => assertDemoUnlockWithinLimits(ip, now)).toThrow(/2\/day/);
  });

  it("blocks a 31st free unlock globally even from a fresh IP", () => {
    const now = 2_000 * DAY;
    for (let index = 0; index < 30; index += 1) {
      recordDemoUnlock(`198.51.100.${index}`, now);
    }
    expect(() => assertDemoUnlockWithinLimits("198.51.100.250", now)).toThrow(
      /budget/,
    );
  });

  it("checking does not consume quota", () => {
    const now = 3_000 * DAY;
    const ip = "192.0.2.42";
    for (let index = 0; index < 10; index += 1) {
      expect(() => assertDemoUnlockWithinLimits(ip, now)).not.toThrow();
    }
  });

  it("allows again after the 24h window elapses", () => {
    const now = 4_000 * DAY;
    const ip = "203.0.113.99";
    recordDemoUnlock(ip, now);
    recordDemoUnlock(ip, now);
    expect(() => assertDemoUnlockWithinLimits(ip, now)).toThrow(/2\/day/);
    expect(() => assertDemoUnlockWithinLimits(ip, now + DAY + 1)).not.toThrow();
  });
});
