import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
} from "viem";
import solc from "solc";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const FEE_ROUTER_ADDRESS = "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const MAX_UINT256 = 2n ** 256n - 1n;
const execute = process.env.PAY_GATE_EXECUTE === "1";

const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

const feeRouterAbi = [
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];

const usdcAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

function requiredAddress(name) {
  const configured = process.env[name];
  if (!configured || !isAddress(configured)) {
    throw new Error(`${name} must be a 20-byte EVM address.`);
  }
  const address = getAddress(configured);
  if (address === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${name} must not be the zero address.`);
  }
  return address;
}

function compilePayGate(payGateSource, registrySource) {
  const input = {
    language: "Solidity",
    sources: {
      "PayGate.sol": { content: payGateSource },
      "UseReceiptRegistry.sol": { content: registrySource },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (output.errors ?? []).filter(
    (error) => error.severity === "error",
  );
  if (fatal.length > 0) {
    throw new Error(fatal.map((error) => error.formattedMessage).join("\n"));
  }
  const contract = output.contracts?.["PayGate.sol"]?.PayGate;
  const bytecode = contract?.evm?.bytecode?.object;
  if (!contract?.abi || !bytecode) {
    throw new Error("PayGate compilation returned no ABI or bytecode.");
  }
  return { abi: contract.abi, bytecode: `0x${bytecode}` };
}

function hasCode(code) {
  return typeof code === "string" && code !== "0x";
}

const [payGateSource, registrySource] = await Promise.all([
  readFile(new URL("../contracts/PayGate.sol", import.meta.url), "utf8"),
  readFile(
    new URL("../contracts/UseReceiptRegistry.sol", import.meta.url),
    "utf8",
  ),
]);
const { abi, bytecode } = compilePayGate(payGateSource, registrySource);
const registry = requiredAddress("LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS");
const payer = requiredAddress("LEPTONWEB_PAYGATE_PAYER_ADDRESS");
const feeRouter = getAddress(FEE_ROUTER_ADDRESS);
const usdc = getAddress(ARC_USDC);

if (!execute) {
  console.log(
    JSON.stringify(
      {
        chainId: ARC_CHAIN_ID,
        rpcUrl: ARC_RPC_URL,
        registry,
        feeRouter,
        usdc,
        payer,
        bytecodeBytes: (bytecode.length - 2) / 2,
        execute: false,
        nextStep:
          "Set PAY_GATE_EXECUTE=1 to deploy PayGate with the configured local deployer role.",
      },
      null,
      2,
    ),
  );
} else {
  const role =
    process.env.LEPTONWEB_PAYGATE_DEPLOYER_ROLE ?? "tollgate-agent-payee";
  const wallet = await loadWallet(role);
  const publicClient = createPublicClient({
    chain: arcChain,
    transport: http(ARC_RPC_URL),
  });
  const walletClient = createWalletClient({
    account: wallet.account,
    chain: arcChain,
    transport: http(ARC_RPC_URL),
  });
  const [chainId, registryCode, feeRouterCode, usdcCode, feeRouterAsset] =
    await Promise.all([
      publicClient.getChainId(),
      publicClient.getCode({ address: registry }),
      publicClient.getCode({ address: feeRouter }),
      publicClient.getCode({ address: usdc }),
      publicClient.readContract({
        address: feeRouter,
        abi: feeRouterAbi,
        functionName: "usdc",
      }),
    ]);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(`Connected chain ${chainId} is not Arc testnet.`);
  }
  if (!hasCode(registryCode)) {
    throw new Error("UseReceiptRegistry address has no deployed bytecode.");
  }
  if (!hasCode(feeRouterCode)) {
    throw new Error("FeeRouter address has no deployed bytecode.");
  }
  if (!hasCode(usdcCode)) {
    throw new Error("USDC address has no deployed bytecode.");
  }
  if (feeRouterAsset.toLowerCase() !== usdc.toLowerCase()) {
    throw new Error("FeeRouter asset does not match the configured USDC.");
  }

  const deployTx = await walletClient.deployContract({
    abi,
    bytecode,
    args: [registry, feeRouter, usdc, payer],
    account: wallet.account,
    chain: arcChain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deployTx,
  });
  if (receipt.transactionHash.toLowerCase() !== deployTx.toLowerCase()) {
    throw new Error("PayGate deployment transaction was replaced.");
  }
  if (receipt.status !== "success") {
    throw new Error(`PayGate deployment failed with status ${receipt.status}.`);
  }
  if (!receipt.contractAddress) {
    throw new Error("PayGate deployment returned no contract address.");
  }
  const address = getAddress(receipt.contractAddress);
  const [
    deployedCode,
    deployedRegistry,
    deployedFeeRouter,
    deployedUsdc,
    deployedPayer,
    allowance,
  ] = await Promise.all([
    publicClient.getCode({ address }),
    publicClient.readContract({
      address,
      abi,
      functionName: "registry",
    }),
    publicClient.readContract({
      address,
      abi,
      functionName: "feeRouter",
    }),
    publicClient.readContract({ address, abi, functionName: "usdc" }),
    publicClient.readContract({ address, abi, functionName: "payer" }),
    publicClient.readContract({
      address: usdc,
      abi: usdcAbi,
      functionName: "allowance",
      args: [address, feeRouter],
    }),
  ]);
  if (!hasCode(deployedCode)) {
    throw new Error("Deployed PayGate address has no bytecode.");
  }
  const expectedAddresses = [registry, feeRouter, usdc, payer];
  const deployedAddresses = [
    deployedRegistry,
    deployedFeeRouter,
    deployedUsdc,
    deployedPayer,
  ];
  if (
    deployedAddresses.some(
      (value, index) =>
        value.toLowerCase() !== expectedAddresses[index].toLowerCase(),
    )
  ) {
    throw new Error(
      "PayGate immutable configuration differs from deployment inputs.",
    );
  }
  if (allowance !== MAX_UINT256) {
    throw new Error(
      "PayGate did not grant FeeRouter the expected USDC allowance.",
    );
  }

  console.log(
    JSON.stringify(
      {
        chainId: ARC_CHAIN_ID,
        deployerRole: role,
        deployer: wallet.address,
        registry,
        feeRouter,
        usdc,
        payer,
        address,
        deployTx,
        blockNumber: receipt.blockNumber.toString(),
        feeRouterAllowanceAtomicUsdc: allowance.toString(),
      },
      null,
      2,
    ),
  );
}
