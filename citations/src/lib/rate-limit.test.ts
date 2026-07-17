import { describe, expect, it } from "vitest";
import { requestIp } from "./rate-limit";

describe("requestIp", () => {
  it("prefers the proxy-set real IP over caller-controlled forwarded values", () => {
    const headers = new Headers({
      "x-real-ip": "198.51.100.20",
      "x-forwarded-for": "203.0.113.1, 198.51.100.20",
    });

    expect(requestIp(headers)).toBe("198.51.100.20");

    headers.set("x-forwarded-for", "203.0.113.99, 198.51.100.20");
    expect(requestIp(headers)).toBe("198.51.100.20");
  });

  it("uses the right-most forwarded address when real IP is unavailable", () => {
    expect(
      requestIp(
        new Headers({
          "x-forwarded-for": "203.0.113.1, 198.51.100.21",
        }),
      ),
    ).toBe("198.51.100.21");
  });
});
