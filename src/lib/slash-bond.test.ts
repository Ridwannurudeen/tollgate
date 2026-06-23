import { describe, expect, it } from "vitest";
import { canSlashBond, type SlashBondStatus } from "./slash-bond";

const status: SlashBondStatus = {
  address: "0x1111111111111111111111111111111111111111",
  operator: "0x2222222222222222222222222222222222222222",
  attestor: "0x3333333333333333333333333333333333333333",
  recipient: "0x4444444444444444444444444444444444444444",
  botId: `0x${"5".repeat(64)}`,
  unbondDelay: 86_400n,
  bondBalance: 1000n,
  totalSlashed: 0n,
  unbondAmount: 0n,
  unbondRequestedAt: 0n,
};

describe("canSlashBond", () => {
  it("allows only the configured attestor", () => {
    expect(canSlashBond(status, status.attestor)).toBe(true);
    expect(
      canSlashBond(status, "0x3333333333333333333333333333333333333333"),
    ).toBe(true);
    expect(canSlashBond(status, status.operator)).toBe(false);
  });
});
