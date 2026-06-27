import { describe, expect, it } from "vitest";
import { covenantStateName } from "./covenant";

describe("covenantStateName", () => {
  it("maps known CovenantVault states", () => {
    expect(covenantStateName(0)).toBe("ACTIVE");
    expect(covenantStateName(1)).toBe("PAUSED");
  });

  it("rejects unknown states", () => {
    expect(() => covenantStateName(2)).toThrow("Unknown CovenantVault state");
  });
});
