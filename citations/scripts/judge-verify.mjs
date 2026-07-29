import { verifyLedger } from "./verify-ledger.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  encodeFunctionData,
  hashTypedData,
  keccak256,
  recoverAddress,
  toHex,
} from "viem";
import {
  allTransactionsFollow,
  confirmedReceiptPosition,
} from "./transaction-order.mjs";
import {
  PAY_GATE_GETTER_SELECTORS,
  feeRouterSplitAtAbi,
  verifyPayGateConfigurationEvidence,
  verifyPayGateEvidence,
} from "./pay-gate-evidence.mjs";

const DEFAULT_TARGET_URL = "https://tollgate.gudman.xyz";
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const RPC_MAX_ATTEMPTS = 5;
const RPC_RETRY_BASE_MS = 400;
const RETRYABLE_NULL_METHODS = new Set([
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
]);
const FEE_ROUTER_ADDRESS =
  "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59".toLowerCase();
const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000".toLowerCase();
const USE_INTENT_DOMAIN_NAME = "Tollgate UseReceipt Registry";
const USE_INTENT_DOMAIN_VERSION = "1";
const USE_INTENT_TYPES = {
  TollgateUseIntent: [
    { name: "queryHash", type: "bytes32" },
    { name: "candidateSetRoot", type: "bytes32" },
    { name: "selectedSourcesRoot", type: "bytes32" },
    { name: "decisionTraceHash", type: "bytes32" },
    { name: "claimSupportRoot", type: "bytes32" },
    { name: "maxSpendAtomicUsdc", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};
const USE_INTENT_ANCHORED_TOPIC = keccak256(
  toHex("UseIntentAnchored(bytes32,bytes32,address)"),
).toLowerCase();
const AGENT_WALLET_SELECTOR = keccak256(toHex("tollgateAgentWallet()")).slice(
  0,
  10,
);
const ACTOR_CLASSES = [
  "operator",
  "fixture",
  "volume-engine",
  "reciprocal-partner",
  "sponsored-cold-human",
  "self-funded-cold-human",
  "external-agent",
  "external-integrator",
  "unclassified",
];
const ACTOR_CLASS_MAP = Object.fromEntries(
  Object.entries(
    JSON.parse(
      await readFile(
        new URL("../data/actor-classes.json", import.meta.url),
        "utf8",
      ),
    ).wallets,
  ).map(([wallet, actorClass]) => [wallet.toLowerCase(), actorClass]),
);

function targetUrlFromArgs() {
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--url" || argument === "--target-url") {
      const value = process.argv[index + 1];
      if (!value) throw new Error(`${argument} requires a URL.`);
      return value;
    }
    if (argument.startsWith("--url=") || argument.startsWith("--target-url=")) {
      return argument.slice(argument.indexOf("=") + 1);
    }
  }
  return DEFAULT_TARGET_URL;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${url} returned HTTP ${response.status}: ${text.slice(0, 240)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} returned invalid JSON.`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpcAttempt(method, params) {
  const response = await fetch(ARC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`Arc RPC returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`Arc RPC ${method} failed: ${payload.error.message}`);
  }
  return payload.result;
}

async function rpcRequest(method, params) {
  let lastError = null;
  for (let attempt = 0; attempt < RPC_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(RPC_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
    try {
      const result = await rpcAttempt(method, params);
      // A load-balanced Arc RPC can route a lookup to a backend that has not
      // indexed an older transaction and answer null instead of erroring, so a
      // missing transaction is retried before it is reported as absent.
      if (result === null && RETRYABLE_NULL_METHODS.has(method)) {
        lastError = null;
        continue;
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

function actualAgentCounts(ledger) {
  const decisions = ledger.queries.flatMap(
    (query) => query.sourceDecisions ?? [],
  );
  return {
    strictLlmRuns: ledger.queries.filter(
      (query) =>
        query.agentMode === "llm" && query.agentServerMode === "judge-strict",
    ).length,
    llmRuns: ledger.queries.filter((query) => query.agentMode === "llm").length,
    deterministicRuns: ledger.queries.filter(
      (query) => query.agentMode === "deterministic",
    ).length,
    buyDecisions: decisions.filter((decision) => decision.selected).length,
    skipDecisions: decisions.filter((decision) => !decision.selected).length,
    abstentions: ledger.queries.filter((query) => query.citations.length === 0)
      .length,
    refundedSources: ledger.queries.reduce(
      (sum, query) => sum + (query.refundSummary?.refundedCount ?? 0),
      0,
    ),
  };
}

function isIndependentActorClass(actorClass) {
  return (
    actorClass !== "operator" &&
    actorClass !== "fixture" &&
    actorClass !== "volume-engine" &&
    actorClass !== "reciprocal-partner" &&
    actorClass !== "unclassified"
  );
}

function actorClassForPayment(payment) {
  if (ACTOR_CLASSES.includes(payment?.actorClass)) return payment.actorClass;
  const payer = payment?.payer;
  if (typeof payer !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(payer)) {
    return "unclassified";
  }
  return ACTOR_CLASS_MAP[payer.toLowerCase()] ?? "unclassified";
}

function actualActorMetrics(ledger) {
  const payments = ledger.queries.flatMap((query) =>
    query.readerPayment ? [query.readerPayment] : [],
  );
  const byClass = Object.fromEntries(
    ACTOR_CLASSES.map((actorClass) => [
      actorClass,
      { paymentCount: 0, atomicUsdc: 0, uniquePayerWallets: 0 },
    ]),
  );
  const walletsByClass = new Map(
    ACTOR_CLASSES.map((actorClass) => [actorClass, new Set()]),
  );
  const independentWallets = new Set();
  const totalWallets = new Set();
  let independentPaymentCount = 0;
  let independentAtomicUsdc = 0;
  let totalAtomicUsdc = 0;
  for (const payment of payments) {
    const actorClass = actorClassForPayment(payment);
    byClass[actorClass].paymentCount += 1;
    byClass[actorClass].atomicUsdc += payment.amountAtomicUsdc;
    totalAtomicUsdc += payment.amountAtomicUsdc;
    if (
      typeof payment.payer === "string" &&
      /^0x[0-9a-fA-F]{40}$/.test(payment.payer)
    ) {
      const payer = payment.payer.toLowerCase();
      walletsByClass.get(actorClass).add(payer);
      totalWallets.add(payer);
      if (isIndependentActorClass(actorClass)) independentWallets.add(payer);
    }
    if (isIndependentActorClass(actorClass)) {
      independentPaymentCount += 1;
      independentAtomicUsdc += payment.amountAtomicUsdc;
    }
  }
  for (const actorClass of ACTOR_CLASSES) {
    byClass[actorClass].uniquePayerWallets =
      walletsByClass.get(actorClass).size;
  }
  return {
    byClass,
    independent: {
      paymentCount: independentPaymentCount,
      atomicUsdc: independentAtomicUsdc,
      uniquePayerWallets: independentWallets.size,
    },
    total: {
      paymentCount: payments.length,
      atomicUsdc: totalAtomicUsdc,
      uniquePayerWallets: totalWallets.size,
    },
    unclassified: { ...byClass.unclassified },
  };
}

function actualSettlementCounts(ledger) {
  const paidQueries = ledger.queries.filter((query) => query.readerPayment);
  const feeRouterPayouts = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "forum-routed",
  );
  return {
    readerPayments: {
      count: paidQueries.length,
      atomicUsdc: paidQueries.reduce(
        (sum, query) => sum + (query.readerPayment?.amountAtomicUsdc ?? 0),
        0,
      ),
    },
    feeRouterPayouts: {
      count: feeRouterPayouts.length,
      atomicUsdc: feeRouterPayouts.reduce(
        (sum, receipt) => sum + receipt.amountAtomicUsdc,
        0,
      ),
    },
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stableStringify(value) {
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return `0x${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function claimSupportRoot(query) {
  return query.contributionProof
    ? sha256Hex({
        method: query.contributionProof.method,
        baselineClaimSupport: query.claimSupport ?? [],
        purchasedSourceIds: query.contributionProof.purchasedSourceIds,
        eligibleSourceIds: query.contributionProof.eligibleSourceIds,
        counterfactuals: query.contributionProof.counterfactuals,
      })
    : sha256Hex(query.claimSupport ?? []);
}

function normalizedBytes32(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function intentMessage(query) {
  const record = query.useIntent;
  if (!record) throw new Error(`query ${query.id} has no use intent`);
  return {
    queryHash: query.queryHash,
    candidateSetRoot: sha256Hex(query.sourceDecisions ?? []),
    selectedSourcesRoot: sha256Hex(
      query.citations.map((citation) => citation.sourceId),
    ),
    decisionTraceHash: query.traceHash ?? sha256Hex(query.agentSteps ?? []),
    claimSupportRoot: claimSupportRoot(query),
    maxSpendAtomicUsdc: BigInt(record.maxSpendAtomicUsdc),
    expiry: BigInt(record.expiry),
    nonce: BigInt(record.nonce),
  };
}

function intentSpendAtomicUsdc(query) {
  return query.citations.reduce((sum, citation) => {
    if (citation.payoutPolicy === "refund-unused") return sum;
    return sum + (citation.payoutAtomicUsdc ?? citation.amountAtomicUsdc);
  }, 0);
}

function hasIntentAnchorLog(
  receipt,
  registryAddress,
  queryHash,
  digest,
  signer,
) {
  const paddedSigner = `0x${"0".repeat(24)}${signer.slice(2).toLowerCase()}`;
  return (receipt?.logs ?? []).some((log) => {
    const topics = log?.topics ?? [];
    return (
      log?.address?.toLowerCase() === registryAddress.toLowerCase() &&
      topics[0]?.toLowerCase() === USE_INTENT_ANCHORED_TOPIC &&
      topics[1]?.toLowerCase() === queryHash.toLowerCase() &&
      topics[2]?.toLowerCase() === digest.toLowerCase() &&
      topics[3]?.toLowerCase() === paddedSigner
    );
  });
}

async function verifyUseIntent(query, agentWallet, rpc, paymentReceipts = []) {
  const record = query.useIntent;
  if (!record) return { ok: true };
  try {
    if (
      typeof record.registryAddress !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(record.registryAddress) ||
      !Number.isSafeInteger(record.chainId) ||
      record.chainId <= 0
    ) {
      return {
        ok: false,
        detail: "intent record is missing its registry address or chain ID",
      };
    }
    const registryAddress = record.registryAddress;
    const message = intentMessage(query);
    const storedRoots = {
      candidateSetRoot: record.candidateSetRoot,
      selectedSourcesRoot: record.selectedSourcesRoot,
      decisionTraceHash: record.decisionTraceHash,
      claimSupportRoot: record.claimSupportRoot,
    };
    for (const [field, value] of Object.entries(storedRoots)) {
      if (normalizedBytes32(value) !== message[field].toLowerCase()) {
        return {
          ok: false,
          detail: `${field} differs from ledger recomputation`,
        };
      }
    }
    const digest = hashTypedData({
      domain: {
        name: USE_INTENT_DOMAIN_NAME,
        version: USE_INTENT_DOMAIN_VERSION,
        chainId: record.chainId,
        verifyingContract: registryAddress,
      },
      types: USE_INTENT_TYPES,
      primaryType: "TollgateUseIntent",
      message,
    });
    if (normalizedBytes32(record.digest) !== digest.toLowerCase()) {
      return {
        ok: false,
        detail: "stored digest differs from recomputed digest",
      };
    }
    if (normalizedBytes32(message.queryHash) === null) {
      return { ok: false, detail: "queryHash is not bytes32" };
    }
    if (
      BigInt(record.maxSpendAtomicUsdc) < BigInt(intentSpendAtomicUsdc(query))
    ) {
      return { ok: false, detail: "intent max spend is below settled spend" };
    }
    const recovered = await recoverAddress({
      hash: digest,
      signature: record.signature,
    });
    if (recovered.toLowerCase() !== agentWallet.toLowerCase()) {
      return {
        ok: false,
        detail: `signature recovers ${recovered}, not agent wallet`,
      };
    }
    const registryCode = await rpc("eth_getCode", [registryAddress, "latest"]);
    if (typeof registryCode !== "string" || registryCode === "0x") {
      return { ok: false, detail: "intent registry has no deployed bytecode" };
    }
    const configuredSigner = await rpc("eth_call", [
      { to: registryAddress, data: AGENT_WALLET_SELECTOR },
      "latest",
    ]);
    const onchainSigner =
      typeof configuredSigner === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(configuredSigner)
        ? `0x${configuredSigner.slice(-40)}`
        : null;
    if (onchainSigner?.toLowerCase() !== agentWallet.toLowerCase()) {
      return {
        ok: false,
        detail: "registry authorized signer does not match the proof pack",
      };
    }
    const receipt = await rpc("eth_getTransactionReceipt", [record.anchorTx]);
    if (!isSuccessfulReceipt(receipt)) {
      return { ok: false, detail: "anchor transaction is not confirmed" };
    }
    const transaction = await rpc("eth_getTransactionByHash", [
      record.anchorTx,
    ]);
    if (
      !hasIntentAnchorLog(
        receipt,
        registryAddress,
        message.queryHash,
        digest,
        agentWallet,
      )
    ) {
      return {
        ok: false,
        detail: "registry anchor event is missing or mismatched",
      };
    }
    if (record.payGate === true) {
      if (
        typeof record.payGateAddress !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(record.payGateAddress)
      ) {
        return {
          ok: false,
          detail: "PayGate intent record has no stored PayGate address",
        };
      }
      const payGateAddress = record.payGateAddress;
      const [code, registryResult, feeRouterResult, usdcResult, payerResult] =
        await Promise.all([
          rpc("eth_getCode", [payGateAddress, "latest"]),
          rpc("eth_call", [
            { to: payGateAddress, data: PAY_GATE_GETTER_SELECTORS.registry },
            "latest",
          ]),
          rpc("eth_call", [
            { to: payGateAddress, data: PAY_GATE_GETTER_SELECTORS.feeRouter },
            "latest",
          ]),
          rpc("eth_call", [
            { to: payGateAddress, data: PAY_GATE_GETTER_SELECTORS.usdc },
            "latest",
          ]),
          rpc("eth_call", [
            { to: payGateAddress, data: PAY_GATE_GETTER_SELECTORS.payer },
            "latest",
          ]),
        ]);
      const configuration = verifyPayGateConfigurationEvidence({
        payGateAddress,
        registryAddress,
        feeRouterAddress: FEE_ROUTER_ADDRESS,
        usdcAddress: ARC_USDC_ADDRESS,
        payerAddress: transaction?.from,
        code,
        registryResult,
        feeRouterResult,
        usdcResult,
        payerResult,
      });
      if (!configuration.ok) return configuration;

      const routedPayments = await Promise.all(
        paymentReceipts
          .filter((candidate) => candidate.settlementMode === "forum-routed")
          .map(async (candidate) => ({
            splitId: candidate.feeRouterSplitId,
            amountAtomicUsdc: candidate.amountAtomicUsdc,
            transactionHash: candidate.feeRouterPayTx,
            evidenceTransactionHash: candidate.transaction,
            payer: candidate.payer,
            wallet: candidate.wallet,
            contributors: candidate.contributors,
            splitAtResult: await rpc("eth_call", [
              {
                to: FEE_ROUTER_ADDRESS,
                data: encodeFunctionData({
                  abi: feeRouterSplitAtAbi,
                  functionName: "splitAt",
                  args: [BigInt(candidate.feeRouterSplitId)],
                }),
              },
              "latest",
            ]),
          })),
      );
      return verifyPayGateEvidence({
        payGateAddress,
        registryAddress,
        feeRouterAddress: FEE_ROUTER_ADDRESS,
        transactionHash: record.anchorTx,
        transaction,
        receipt,
        intent: message,
        signature: record.signature,
        digest,
        signer: agentWallet,
        payerAddress: configuration.payerAddress,
        payments: routedPayments,
      });
    }
    if (transaction?.to?.toLowerCase() !== registryAddress.toLowerCase()) {
      return {
        ok: false,
        detail: "anchor transaction target is not the registry",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function isSuccessfulReceipt(receipt) {
  return Boolean(
    receipt && receipt.transactionHash && receipt.status === "0x1",
  );
}

async function main() {
  const baseUrl = normalizeBaseUrl(targetUrlFromArgs());
  const checks = [];
  const pass = (label) => checks.push({ ok: true, label });
  const fail = (label, detail) => checks.push({ ok: false, label, detail });
  const endpoint = (pathname) => new URL(pathname, baseUrl).toString();

  const proof = await fetchJson(endpoint("/api/judge-proof.json"));
  const ledgerEnvelope = await fetchJson(endpoint("/api/ledger"));
  const sourcesEnvelope = await fetchJson(endpoint("/api/sources"));
  const ledger = ledgerEnvelope.ledger;
  const localVerification = verifyLedger(ledger);

  if (proof.project === "tollgate-citations") pass("proof pack project");
  else fail("proof pack project", `got ${proof.project ?? "missing"}`);

  if (localVerification.ok) pass("local ledger hash chain");
  else
    fail("local ledger hash chain", JSON.stringify(localVerification.issues));

  if (ledgerEnvelope.verification?.ok === localVerification.ok) {
    pass("API ledger integrity agrees with local verification");
  } else {
    fail("API ledger integrity agrees with local verification");
  }

  if (
    proof.integrity?.ok === localVerification.ok &&
    proof.integrity?.latestHash === localVerification.latestHash
  ) {
    pass("proof integrity agrees with local verification");
  } else {
    fail("proof integrity agrees with local verification");
  }

  if (
    proof.ledger?.verification?.receiptCount ===
      localVerification.receiptCount &&
    proof.ledger?.verification?.queryCount === localVerification.queryCount
  ) {
    pass("proof counts agree with fetched ledger");
  } else {
    fail(
      "proof counts agree with fetched ledger",
      `proof=${JSON.stringify(proof.ledger?.verification)} local=${JSON.stringify(localVerification)}`,
    );
  }

  const agentCounts = actualAgentCounts(ledger);
  if (sameJson(proof.agent, agentCounts))
    pass("agent counts agree with ledger");
  else
    fail(
      "agent counts agree with ledger",
      `proof=${JSON.stringify(proof.agent)} actual=${JSON.stringify(agentCounts)}`,
    );

  const settlementCounts = actualSettlementCounts(ledger);
  if (
    proof.settlement?.readerPayments &&
    proof.settlement.readerPayments.count ===
      settlementCounts.readerPayments.count &&
    proof.settlement.readerPayments.atomicUsdc ===
      settlementCounts.readerPayments.atomicUsdc &&
    proof.settlement?.feeRouterPayouts &&
    proof.settlement.feeRouterPayouts.count ===
      settlementCounts.feeRouterPayouts.count &&
    proof.settlement.feeRouterPayouts.atomicUsdc ===
      settlementCounts.feeRouterPayouts.atomicUsdc
  ) {
    pass("settlement counts agree with ledger");
  } else {
    fail("settlement counts agree with ledger");
  }

  const actorMetrics = actualActorMetrics(ledger);
  if (
    sameJson(proof.traction?.actorMetrics, actorMetrics) &&
    proof.traction?.paidQueries === actorMetrics.independent.paymentCount &&
    proof.traction?.totalPaidQueries === actorMetrics.total.paymentCount &&
    proof.traction?.uniquePayerWallets ===
      actorMetrics.independent.uniquePayerWallets &&
    proof.traction?.totalUniquePayerWallets ===
      actorMetrics.total.uniquePayerWallets
  ) {
    pass("actor-class counts, volume, and payer totals agree with ledger");
  } else {
    fail(
      "actor-class counts, volume, and payer totals agree with ledger",
      `proof=${JSON.stringify(proof.traction?.actorMetrics)} actual=${JSON.stringify(actorMetrics)}`,
    );
  }

  const creatorClaimedCount = (sourcesEnvelope.sources ?? []).filter(
    (source) => source.creatorClaimed === true,
  ).length;
  if (proof.settlement?.creatorClaims?.count === creatorClaimedCount) {
    pass("creator claim count agrees with source registry");
  } else {
    fail(
      "creator claim count agrees with source registry",
      `proof=${proof.settlement?.creatorClaims?.count ?? "missing"} actual=${creatorClaimedCount}`,
    );
  }

  const useIntentQueries = ledger.queries.filter((query) => query.useIntent);
  const payGateQueries = useIntentQueries.filter(
    (query) => query.useIntent?.payGate === true,
  );
  if (proof.useIntent?.anchoredCount === useIntentQueries.length) {
    pass("use-intent count agrees with ledger");
  } else {
    fail(
      "use-intent count agrees with ledger",
      `proof=${proof.useIntent?.anchoredCount ?? "missing"} actual=${useIntentQueries.length}`,
    );
  }

  const proofPayGateCount = proof.useIntent?.payGateSettledCount;
  if (
    proofPayGateCount === payGateQueries.length ||
    (proofPayGateCount === undefined && payGateQueries.length === 0)
  ) {
    pass("PayGate settlement count agrees with ledger");
  } else {
    fail(
      "PayGate settlement count agrees with ledger",
      `proof=${proofPayGateCount ?? "missing"} actual=${payGateQueries.length}`,
    );
  }

  if (useIntentQueries.length === 0) {
    pass("use-intent anchoring has no records to verify");
  } else {
    const agentWallet = proof.useIntent?.agentWallet;
    if (
      typeof agentWallet !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(agentWallet)
    ) {
      fail(
        "use-intent registry configuration",
        "public registry and agent addresses are missing",
      );
    } else {
      for (const query of useIntentQueries) {
        const result = await verifyUseIntent(
          query,
          agentWallet,
          rpcRequest,
          ledger.receipts.filter((receipt) => receipt.queryId === query.id),
        );
        if (result.ok) {
          pass(
            `use-intent digest, signature, and anchor verified for ${query.id}`,
          );
        } else {
          fail(
            `use-intent digest, signature, and anchor verified for ${query.id}`,
            result.detail,
          );
        }
      }
    }
  }

  const latestPaidQuery = ledger.queries
    .filter(
      (query) =>
        query.readerPayment?.transaction && !query.readerPayment.refund,
    )
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!latestPaidQuery) {
    fail(
      "latest settled paid query exists",
      "no paid query with a transaction was found",
    );
  } else {
    pass("latest settled paid query exists");
    const readerReceipt = await rpcRequest("eth_getTransactionReceipt", [
      latestPaidQuery.readerPayment.transaction,
    ]);
    if (isSuccessfulReceipt(readerReceipt)) {
      pass("latest reader payment transaction is confirmed on Arc");
    } else {
      fail("latest reader payment transaction is confirmed on Arc");
    }

    const payoutReceipts = ledger.receipts.filter(
      (receipt) =>
        receipt.queryId === latestPaidQuery.id &&
        receipt.settlementMode === "forum-routed",
    );
    const payoutTransactions = payoutReceipts.map((receipt) =>
      normalizedBytes32(receipt.feeRouterPayTx),
    );
    if (
      payoutReceipts.length === 0 ||
      payoutTransactions.some((transaction) => transaction === null)
    ) {
      fail("latest paid query has a FeeRouter payout");
    } else {
      pass("latest paid query has a FeeRouter payout");
      const payouts = await Promise.all(
        payoutTransactions.map(async (transaction) => {
          const [receipt, transactionRecord] = await Promise.all([
            rpcRequest("eth_getTransactionReceipt", [transaction]),
            rpcRequest("eth_getTransactionByHash", [transaction]),
          ]);
          return { receipt, transaction, transactionRecord };
        }),
      );
      if (
        payouts.every((payout) =>
          confirmedReceiptPosition(payout.receipt, payout.transaction),
        )
      ) {
        pass("latest FeeRouter payout transactions are confirmed on Arc");
      } else {
        fail("latest FeeRouter payout transactions are confirmed on Arc");
      }
      const latestUsesPayGate = latestPaidQuery.useIntent?.payGate === true;
      const storedPayGateAddress = latestPaidQuery.useIntent?.payGateAddress;
      const payoutTargetAddress = latestUsesPayGate
        ? typeof storedPayGateAddress === "string" &&
          /^0x[0-9a-fA-F]{40}$/.test(storedPayGateAddress)
          ? storedPayGateAddress.toLowerCase()
          : null
        : FEE_ROUTER_ADDRESS;
      const payoutTargetLabel = latestUsesPayGate ? "PayGate" : "FeeRouter";
      if (
        payoutTargetAddress &&
        payouts.every(
          (payout) =>
            normalizedBytes32(payout.transactionRecord?.hash) ===
              payout.transaction &&
            payout.transactionRecord?.to?.toLowerCase() === payoutTargetAddress,
        )
      ) {
        pass(
          `latest FeeRouter payout transactions target ${payoutTargetLabel}`,
        );
      } else {
        fail(
          `latest FeeRouter payout transactions target ${payoutTargetLabel}`,
        );
      }

      const anchorTransaction = normalizedBytes32(
        latestPaidQuery.useIntent?.anchorTx,
      );
      if (latestUsesPayGate) {
        if (
          anchorTransaction &&
          payouts.every((payout) => payout.transaction === anchorTransaction)
        ) {
          pass(
            "latest use-intent anchor and FeeRouter payouts share one PayGate transaction",
          );
        } else {
          fail(
            "latest use-intent anchor and FeeRouter payouts share one PayGate transaction",
          );
        }
      } else if (!anchorTransaction) {
        fail(
          "latest use-intent anchor precedes every FeeRouter payout",
          "latest paid query has no valid anchor transaction",
        );
      } else {
        const anchorReceipt = await rpcRequest("eth_getTransactionReceipt", [
          anchorTransaction,
        ]);
        if (
          allTransactionsFollow(
            anchorReceipt,
            anchorTransaction,
            payouts.map((payout) => ({
              receipt: payout.receipt,
              transaction: payout.transaction,
            })),
          )
        ) {
          pass("latest use-intent anchor precedes every FeeRouter payout");
        } else {
          fail("latest use-intent anchor precedes every FeeRouter payout");
        }
      }
    }
  }

  const feeRouterCode = await rpcRequest("eth_getCode", [
    FEE_ROUTER_ADDRESS,
    "latest",
  ]);
  if (typeof feeRouterCode === "string" && feeRouterCode !== "0x") {
    pass("FeeRouter address has deployed bytecode");
  } else {
    fail("FeeRouter address has deployed bytecode");
  }

  for (const check of checks) {
    console.log(
      `- ${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? `: ${check.detail}` : ""}`,
    );
  }
  const failed = checks.filter((check) => !check.ok);
  console.log(
    failed.length === 0
      ? "PASS: judge proof verified"
      : `FAIL: ${failed.length} check(s) failed`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.log(
    `- FAIL verifier execution: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.log("FAIL: judge proof could not be verified");
  process.exitCode = 1;
});
