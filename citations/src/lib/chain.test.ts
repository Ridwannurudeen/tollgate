import { afterEach, describe, expect, it, vi } from "vitest";

const OVERRIDES = [
  "NEXT_PUBLIC_ARC_CHAIN_ID",
  "NEXT_PUBLIC_ARC_CHAIN_NAME",
  "NEXT_PUBLIC_ARC_EXPLORER_URL",
  "NEXT_PUBLIC_ARC_IS_TESTNET",
  "NEXT_PUBLIC_ARC_USDC",
] as const;

function clearOverrides(): void {
  for (const key of OVERRIDES) delete process.env[key];
}

async function loadChain() {
  vi.resetModules();
  return import("./chain");
}

afterEach(() => {
  clearOverrides();
  vi.resetModules();
});

describe("arc chain configuration", () => {
  it("defaults to Arc testnet when nothing is configured", async () => {
    clearOverrides();
    const chain = await loadChain();
    expect(chain.ARC_CHAIN_ID).toBe(5042002);
    expect(chain.ARC_CAIP2).toBe("eip155:5042002");
    expect(chain.ARC_USDC).toBe("0x3600000000000000000000000000000000000000");
    expect(chain.arcChain.testnet).toBe(true);
    expect(chain.arcChain.name).toBe("Arc Testnet");
  });

  it("retargets the chain from environment alone", async () => {
    process.env.NEXT_PUBLIC_ARC_CHAIN_ID = "5042";
    process.env.NEXT_PUBLIC_ARC_CHAIN_NAME = "Arc";
    process.env.NEXT_PUBLIC_ARC_EXPLORER_URL = "https://explorer.arc.io";
    process.env.NEXT_PUBLIC_ARC_IS_TESTNET = "0";
    const chain = await loadChain();
    expect(chain.ARC_CHAIN_ID).toBe(5042);
    expect(chain.ARC_CAIP2).toBe("eip155:5042");
    expect(chain.arcChain.id).toBe(5042);
    expect(chain.arcChain.name).toBe("Arc");
    expect(chain.arcChain.testnet).toBe(false);
    expect(chain.arcChain.blockExplorers?.default.url).toBe(
      "https://explorer.arc.io",
    );
  });

  it("rejects a malformed chain id", async () => {
    process.env.NEXT_PUBLIC_ARC_CHAIN_ID = "not-a-chain";
    await expect(loadChain()).rejects.toThrow(
      "NEXT_PUBLIC_ARC_CHAIN_ID must be a positive integer.",
    );
  });

  it("rejects a malformed USDC address", async () => {
    process.env.NEXT_PUBLIC_ARC_USDC = "0xdeadbeef";
    await expect(loadChain()).rejects.toThrow(
      "NEXT_PUBLIC_ARC_USDC must be a 20-byte hex address.",
    );
  });
});
