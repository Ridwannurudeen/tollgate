import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { ARC_CHAIN_ID, ARC_RPC_URL, arcTestnet } from "./chain";

export const FORUM_ADDRESSES = {
  feeRouterV1: "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59",
} as const satisfies Record<string, Address>;

const feeRouterV1ReadAbi = [
  {
    type: "function",
    name: "splitCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type ForumLiveness = {
  ok: boolean;
  chainId: number;
  expectedChainId: number;
  feeRouterHasCode: boolean;
  feeRouterSplitCount: bigint;
};

export function createForumPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
}

export async function readForumLiveness(
  publicClient: PublicClient = createForumPublicClient(),
): Promise<ForumLiveness> {
  const [chainId, feeRouterCode, feeRouterSplitCount] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getCode({ address: FORUM_ADDRESSES.feeRouterV1 }),
    publicClient.readContract({
      address: FORUM_ADDRESSES.feeRouterV1,
      abi: feeRouterV1ReadAbi,
      functionName: "splitCount",
    }),
  ]);

  return {
    ok: chainId === ARC_CHAIN_ID && Boolean(feeRouterCode),
    chainId,
    expectedChainId: ARC_CHAIN_ID,
    feeRouterHasCode: Boolean(feeRouterCode),
    feeRouterSplitCount,
  };
}
