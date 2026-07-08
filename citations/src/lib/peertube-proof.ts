import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http, type Hex } from "viem";
import { ARC_CAIP2, ARC_RPC_URL, arcTestnet } from "./chain";
import { FEE_ROUTER_ADDRESS } from "./fee-router-contract";

export const PEERTUBE_FEE_ROUTER_TX =
  "0x1ed2e7caa90964100d843095acc4f3e5c5f5bf9203850e91d2cab8f838c1a49d" as Hex;

type PluginPackage = {
  name: string;
  version: string;
  description: string;
  engine?: { peertube?: string };
  engines?: { node?: string };
};

const FALLBACK_PLUGIN: PluginPackage = {
  name: "peertube-plugin-tollgate",
  version: "0.1.0",
  description:
    "Pay the creator in USDC on Arc when their video is downloaded. A permissionless PeerTube payments plugin.",
  engine: { peertube: ">=6.0.0" },
  engines: { node: ">=20" },
};

async function readPluginPackage(): Promise<PluginPackage> {
  try {
    const raw = await readFile(
      path.join(
        process.cwd(),
        "..",
        "peertube-plugin-tollgate",
        "package.json",
      ),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<PluginPackage>;
    if (!parsed.name || !parsed.version || !parsed.description) {
      return FALLBACK_PLUGIN;
    }
    return {
      name: parsed.name,
      version: parsed.version,
      description: parsed.description,
      engine: parsed.engine,
      engines: parsed.engines,
    };
  } catch {
    return FALLBACK_PLUGIN;
  }
}

async function readFeeRouterTx() {
  try {
    const publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(ARC_RPC_URL),
    });
    const [receipt, transaction] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: PEERTUBE_FEE_ROUTER_TX }),
      publicClient.getTransaction({ hash: PEERTUBE_FEE_ROUTER_TX }),
    ]);

    return {
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      from: transaction.from,
      to: transaction.to,
      feeRouterTxVerified:
        receipt.status === "success" &&
        transaction.to?.toLowerCase() === FEE_ROUTER_ADDRESS.toLowerCase(),
    };
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error.message : "unknown error",
      feeRouterTxVerified: false,
    };
  }
}

export async function buildPeerTubeProof() {
  const [pluginPackage, feeRouterTx] = await Promise.all([
    readPluginPackage(),
    readFeeRouterTx(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    status: "PUBLISHED-LOCAL-VALIDATED-PROOF-MIRROR",
    proofMirror: true,
    publicPeerTubeInstanceMounted: false,
    publicInstanceStatus:
      "No public PeerTube instance is mounted on tollgate.gudman.xyz; operators install the plugin on their own PeerTube server.",
    proofEndpoint: "/plugins/tollgate/router/proof",
    plugin: {
      package: pluginPackage.name,
      version: pluginPackage.version,
      peerTube: pluginPackage.engine?.peertube ?? ">=6.0.0",
      node: pluginPackage.engines?.node ?? ">=20",
      npm: `https://www.npmjs.com/package/${pluginPackage.name}`,
    },
    localValidation: {
      source: "peertube-plugin-tollgate/demo/VALIDATION.md",
      status: "DONE-local-Docker-validated",
      peerTubeServedHttp: true,
      routerProofValidated: true,
      downloadGateValidated: true,
      payoutsEnabledDuringLocalValidation: false,
      pluginReceiptCountDuringLocalValidation: 0,
      receiptCountExplanation:
        "The checked-in Docker validation proved the PeerTube hook/router/gate shape with payouts disabled, so it produced zero plugin receipts.",
    },
    settlementRail: {
      network: ARC_CAIP2,
      rpcConfigured: Boolean(ARC_RPC_URL),
      feeRouter: FEE_ROUTER_ADDRESS,
      tx: PEERTUBE_FEE_ROUTER_TX,
      scope:
        "Shared FeeRouter rail proof driven through plugin settlement code; not a public PeerTube-instance receipt.",
      ...feeRouterTx,
    },
  };
}
