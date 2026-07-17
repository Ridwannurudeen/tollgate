import { describe, expect, it } from "vitest";
import { assertLicenseDownloadRateLimit } from "./link-rate-limit";

describe("license-download rate limit", () => {
  it("allows twenty requests per minute for one trusted IP", () => {
    const now = 10_000_000;
    const ip = "198.51.100.221";

    for (let index = 0; index < 20; index += 1) {
      expect(() => assertLicenseDownloadRateLimit(ip, now)).not.toThrow();
    }
    expect(() => assertLicenseDownloadRateLimit(ip, now)).toThrow(
      /Too many license-download requests/,
    );
    expect(() =>
      assertLicenseDownloadRateLimit(ip, now + 60_001),
    ).not.toThrow();
  });
});
