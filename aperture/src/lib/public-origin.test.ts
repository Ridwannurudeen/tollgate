import { afterEach, describe, expect, it } from "vitest";
import { aperturePublicOrigin } from "./public-origin";

describe("aperturePublicOrigin", () => {
  const saved = process.env.APERTURE_PUBLIC_ORIGIN;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.APERTURE_PUBLIC_ORIGIN;
    } else {
      process.env.APERTURE_PUBLIC_ORIGIN = saved;
    }
  });

  it("returns the configured canonical HTTP origin without path data", () => {
    process.env.APERTURE_PUBLIC_ORIGIN =
      "https://canonical.example/ignored/path?query=1";

    expect(aperturePublicOrigin()).toBe("https://canonical.example");
  });

  it("rejects non-HTTP public origins", () => {
    process.env.APERTURE_PUBLIC_ORIGIN = "javascript:alert(1)";

    expect(() => aperturePublicOrigin()).toThrow(
      "APERTURE_PUBLIC_ORIGIN must be an HTTP(S) origin.",
    );
  });
});
