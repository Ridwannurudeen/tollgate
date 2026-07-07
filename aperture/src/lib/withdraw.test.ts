import { describe, expect, it, vi } from "vitest";
import { ARC_USDC } from "./chain";
import { usdcRouterAbi } from "./fee-router";
import { withdrawCustodialUsdc } from "./withdraw";

const walletAddress = "0x1111111111111111111111111111111111111111";
const toAddress = "0x2222222222222222222222222222222222222222";

describe("withdrawCustodialUsdc", () => {
  it("rejects non-positive amounts before reading balance", async () => {
    const publicClient = { readContract: vi.fn() };

    await expect(
      withdrawCustodialUsdc(
        {
          walletId: "wallet-id",
          walletAddress,
          toAddress,
          amountAtomicUsdc: 0n,
        },
        { publicClient },
      ),
    ).rejects.toThrow("positive integer");
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it("rejects amounts above the live on-chain balance", async () => {
    const publicClient = { readContract: vi.fn().mockResolvedValue(500n) };
    const executeContract = vi.fn();

    await expect(
      withdrawCustodialUsdc(
        {
          walletId: "wallet-id",
          walletAddress,
          toAddress,
          amountAtomicUsdc: 501n,
        },
        { publicClient, executeContract },
      ),
    ).rejects.toThrow("exceeds custodial USDC balance");
    expect(executeContract).not.toHaveBeenCalled();
  });

  it("executes USDC transfer from the custodial wallet when valid", async () => {
    const publicClient = { readContract: vi.fn().mockResolvedValue(1_000n) };
    const executeContract = vi.fn().mockResolvedValue("0xtransfer");

    await expect(
      withdrawCustodialUsdc(
        {
          walletId: "wallet-id",
          walletAddress,
          toAddress,
          amountAtomicUsdc: 750n,
        },
        { publicClient, executeContract },
      ),
    ).resolves.toBe("0xtransfer");

    expect(publicClient.readContract).toHaveBeenCalledWith({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "balanceOf",
      args: [walletAddress],
    });
    expect(executeContract).toHaveBeenCalledWith({
      walletId: "wallet-id",
      walletAddress,
      contractAddress: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "transfer",
      functionArgs: [toAddress, 750n],
    });
  });

  it("propagates Circle execution errors", async () => {
    const publicClient = { readContract: vi.fn().mockResolvedValue(1_000n) };
    const executeContract = vi.fn().mockRejectedValue(new Error("Circle down"));

    await expect(
      withdrawCustodialUsdc(
        {
          walletId: "wallet-id",
          walletAddress,
          toAddress,
          amountAtomicUsdc: 750n,
        },
        { publicClient, executeContract },
      ),
    ).rejects.toThrow("Circle down");
  });
});
