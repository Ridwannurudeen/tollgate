import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { ARC_CHAIN_ID, ARC_RPC_URL, arcTestnet } from "./chain";

export const FORUM_REFERENCE_BOT_ID =
  "0x826d03b1edbf2c7251b6ff4a521c01cda6c01c1bf84cff2e39fc85b4edd4f6cd";

export const FORUM_ADDRESSES = {
  feeRouterV1: "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59",
  slashBondV1_1: "0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939",
  trackRecordV2: "0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66",
  covenantVaultFactory: "0xc9bbafd02d22dd75a9f043f50f126ac2fe22ca26",
  covenantVaultFactoryV2: "0x4766e3c506a5ff543d12f672ed5f167fabe26fe0",
  riskKernelV3: "0x554cdad3cac1f640b39816193310166afc2bde06",
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

const slashBondReadAbi = [
  {
    type: "function",
    name: "bondBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSlashed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const trackRecordV2ReadAbi = [
  {
    type: "function",
    name: "recordCount",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const covenantVaultFactoryReadAbi = [
  {
    type: "function",
    name: "vaultCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type ForumContractLiveness = {
  name: keyof typeof FORUM_ADDRESSES;
  address: Address;
  hasCode: boolean;
};

export type ForumLiveness = {
  ok: boolean;
  chainId: number;
  expectedChainId: number;
  contracts: ForumContractLiveness[];
  feeRouterSplitCount: bigint;
  trackRecordCount: bigint;
  slashBondBalance: bigint;
  slashBondTotalSlashed: bigint;
  covenantVaultCount: bigint;
};

export function createForumPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
}

export async function readForumLiveness(
  publicClient: PublicClient = createForumPublicClient(),
  botId: Hex = FORUM_REFERENCE_BOT_ID,
): Promise<ForumLiveness> {
  const chainId = await publicClient.getChainId();
  const contracts = await Promise.all(
    Object.entries(FORUM_ADDRESSES).map(async ([name, address]) => ({
      name: name as keyof typeof FORUM_ADDRESSES,
      address,
      hasCode: Boolean(await publicClient.getCode({ address })),
    })),
  );

  const [
    feeRouterSplitCount,
    trackRecordCount,
    slashBondBalance,
    slashBondTotalSlashed,
    covenantVaultCount,
  ] = await Promise.all([
    publicClient.readContract({
      address: FORUM_ADDRESSES.feeRouterV1,
      abi: feeRouterV1ReadAbi,
      functionName: "splitCount",
    }),
    publicClient.readContract({
      address: FORUM_ADDRESSES.trackRecordV2,
      abi: trackRecordV2ReadAbi,
      functionName: "recordCount",
      args: [botId],
    }),
    publicClient.readContract({
      address: FORUM_ADDRESSES.slashBondV1_1,
      abi: slashBondReadAbi,
      functionName: "bondBalance",
    }),
    publicClient.readContract({
      address: FORUM_ADDRESSES.slashBondV1_1,
      abi: slashBondReadAbi,
      functionName: "totalSlashed",
    }),
    publicClient.readContract({
      address: FORUM_ADDRESSES.covenantVaultFactory,
      abi: covenantVaultFactoryReadAbi,
      functionName: "vaultCount",
    }),
  ]);

  return {
    ok:
      chainId === ARC_CHAIN_ID &&
      contracts.every((contract) => contract.hasCode),
    chainId,
    expectedChainId: ARC_CHAIN_ID,
    contracts,
    feeRouterSplitCount,
    trackRecordCount,
    slashBondBalance,
    slashBondTotalSlashed,
    covenantVaultCount,
  };
}
