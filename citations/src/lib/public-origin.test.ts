import { afterEach, describe, expect, it } from "vitest";
import { leptonwebPublicOrigin } from "./public-origin";

describe("leptonwebPublicOrigin", () => {
  const saved = process.env.LEPTONWEB_PUBLIC_URL;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.LEPTONWEB_PUBLIC_URL;
    } else {
      process.env.LEPTONWEB_PUBLIC_URL = saved;
    }
  });

  it("returns the configured canonical HTTP origin without path data", () => {
    process.env.LEPTONWEB_PUBLIC_URL =
      "https://canonical.example/ignored/path?query=1";

    expect(leptonwebPublicOrigin()).toBe("https://canonical.example");
  });

  it("rejects non-HTTP public origins", () => {
    process.env.LEPTONWEB_PUBLIC_URL = "javascript:alert(1)";

    expect(() => leptonwebPublicOrigin()).toThrow(
      "LEPTONWEB_PUBLIC_URL must be an HTTP(S) origin.",
    );
  });
});
