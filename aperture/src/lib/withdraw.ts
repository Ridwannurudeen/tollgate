import type { Address, Hex } from "viem";
import { ARC_USDC } from "./chain";
import { w3sExecuteContract } from "./circle-w3s";
import { createFeeRouterPublicClient, usdcRouterAbi } from "./fee-router";

type UsdcBalanceClient = {
  readContract(request: {
    address: Address;
    abi: typeof usdcRouterAbi;
    functionName: "balanceOf";
    args: readonly [Address];
  }): Promise<bigint>;
};

type WithdrawDeps = {
  publicClient?: UsdcBalanceClient;
  executeContract?: typeof w3sExecuteContract;
};

export async function readCustodialUsdcBalance(
  walletAddress: Address,
  deps: Pick<WithdrawDeps, "publicClient"> = {},
): Promise<bigint> {
  const publicClient = deps.publicClient ?? createFeeRouterPublicClient();
  return publicClient.readContract({
    address: ARC_USDC,
    abi: usdcRouterAbi,
    functionName: "balanceOf",
    args: [walletAddress],
  });
}

export async function withdrawCustodialUsdc(
  {
    walletId,
    walletAddress,
    toAddress,
    amountAtomicUsdc,
  }: {
    walletId: string;
    walletAddress: Address;
    toAddress: Address;
    amountAtomicUsdc: bigint;
  },
  deps: WithdrawDeps = {},
): Promise<Hex> {
  if (amountAtomicUsdc <= 0n) {
    throw new Error("withdraw amount must be a positive integer.");
  }

  const balance = await readCustodialUsdcBalance(walletAddress, deps);
  if (amountAtomicUsdc > balance) {
    throw new Error("withdraw amount exceeds custodial USDC balance.");
  }

  return (deps.executeContract ?? w3sExecuteContract)({
    walletId,
    walletAddress,
    contractAddress: ARC_USDC,
    abi: usdcRouterAbi,
    functionName: "transfer",
    functionArgs: [toAddress, amountAtomicUsdc],
  });
}
