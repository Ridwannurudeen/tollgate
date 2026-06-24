import { describe, expect, it } from "vitest";
import { routeLicensePayment } from "./fee-router";

describe("routeLicensePayment", () => {
  it("returns null when FeeRouter settlement is disabled", async () => {
    await expect(
      routeLicensePayment("0x12F25B721Cc21c38495e33A4c8524dd0B647ba03", 2500, {
        enabled: false,
      }),
    ).resolves.toBeNull();
  });

  it("requires a private key when enabled", async () => {
    await expect(
      routeLicensePayment("0x12F25B721Cc21c38495e33A4c8524dd0B647ba03", 2500, {
        enabled: true,
      }),
    ).rejects.toThrow("APERTURE_FEE_ROUTER_PRIVATE_KEY");
  });
});
