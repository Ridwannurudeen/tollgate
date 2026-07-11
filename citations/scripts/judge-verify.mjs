import { verifyLedger } from "./verify-ledger.mjs";
import { createHash } from "node:crypto";
import { hashTypedData, keccak256, recoverAddress, toHex } from "viem";

const DEFAULT_TARGET_URL = "https://tollgate.gudman.xyz";
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const FEE_ROUTER_ADDRESS =
  "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59".toLowerCase();
const ARC_CHAIN_ID = 5042002;
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
    throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} returned invalid JSON.`);
  }
}

async function rpcRequest(method, params) {
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

function actualAgentCounts(ledger) {
  const decisions = ledger.queries.flatMap((query) => query.sourceDecisions ?? []);
  return {
    strictLlmRuns: ledger.queries.filter(
      (query) =>
        query.agentMode === "llm" &&
        query.agentServerMode === "judge-strict",
    ).length,
    llmRuns: ledger.queries.filter((query) => query.agentMode === "llm").length,
    deterministicRuns: ledger.queries.filter(
      (query) => query.agentMode === "deterministic",
    ).length,
    buyDecisions: decisions.filter((decision) => decision.selected).length,
    skipDecisions: decisions.filter((decision) => !decision.selected).length,
    abstentions: ledger.queries.filter((query) => query.citations.length === 0)
      .length,
    refundedSources: ledger.receipts.filter(
      (receipt) => receipt.settlementMode === "refunded",
    ).length,
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
    claimSupportRoot:
      query.claimSupportRoot ?? sha256Hex(query.claimSupport ?? []),
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

async function verifyUseIntent(query, registryAddress, agentWallet, rpc) {
  const record = query.useIntent;
  if (!record) return { ok: true };
  try {
    const message = intentMessage(query);
    const storedRoots = {
      candidateSetRoot: record.candidateSetRoot,
      selectedSourcesRoot: record.selectedSourcesRoot,
      decisionTraceHash: record.decisionTraceHash,
      claimSupportRoot: record.claimSupportRoot,
    };
    for (const [field, value] of Object.entries(storedRoots)) {
      if (normalizedBytes32(value) !== message[field].toLowerCase()) {
        return { ok: false, detail: `${field} differs from ledger recomputation` };
      }
    }
    const digest = hashTypedData({
      domain: {
        name: USE_INTENT_DOMAIN_NAME,
        version: USE_INTENT_DOMAIN_VERSION,
        chainId: ARC_CHAIN_ID,
        verifyingContract: registryAddress,
      },
      types: USE_INTENT_TYPES,
      primaryType: "TollgateUseIntent",
      message,
    });
    if (normalizedBytes32(record.digest) !== digest.toLowerCase()) {
      return { ok: false, detail: "stored digest differs from recomputed digest" };
    }
    if (normalizedBytes32(message.queryHash) === null) {
      return { ok: false, detail: "queryHash is not bytes32" };
    }
    if (BigInt(record.maxSpendAtomicUsdc) < BigInt(intentSpendAtomicUsdc(query))) {
      return { ok: false, detail: "intent max spend is below settled spend" };
    }
    const recovered = await recoverAddress({
      hash: digest,
      signature: record.signature,
    });
    if (recovered.toLowerCase() !== agentWallet.toLowerCase()) {
      return { ok: false, detail: `signature recovers ${recovered}, not agent wallet` };
    }
    const receipt = await rpc("eth_getTransactionReceipt", [record.anchorTx]);
    if (!isSuccessfulReceipt(receipt)) {
      return { ok: false, detail: "anchor transaction is not confirmed" };
    }
    const transaction = await rpc("eth_getTransactionByHash", [record.anchorTx]);
    if (transaction?.to?.toLowerCase() !== registryAddress.toLowerCase()) {
      return { ok: false, detail: "anchor transaction target is not the registry" };
    }
    if (
      !hasIntentAnchorLog(
        receipt,
        registryAddress,
        message.queryHash,
        digest,
        agentWallet,
      )
    ) {
      return { ok: false, detail: "registry anchor event is missing or mismatched" };
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
    receipt &&
      receipt.transactionHash &&
      (receipt.status === undefined || receipt.status === "0x1"),
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
  else fail("local ledger hash chain", JSON.stringify(localVerification.issues));

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
    proof.ledger?.verification?.receiptCount === localVerification.receiptCount &&
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
  if (sameJson(proof.agent, agentCounts)) pass("agent counts agree with ledger");
  else fail("agent counts agree with ledger", `proof=${JSON.stringify(proof.agent)} actual=${JSON.stringify(agentCounts)}`);

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
  if (
    proof.useIntent?.anchoredCount === useIntentQueries.length &&
    (useIntentQueries.length === 0 || proof.useIntent?.registryAddress)
  ) {
    pass("use-intent count agrees with ledger");
  } else {
    fail(
      "use-intent count agrees with ledger",
      `proof=${proof.useIntent?.anchoredCount ?? "missing"} actual=${useIntentQueries.length}`,
    );
  }

  if (useIntentQueries.length === 0) {
    pass("use-intent anchoring has no records to verify");
  } else {
    const registryAddress =
      proof.useIntent?.registryAddress ??
      process.env.LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS;
    const agentWallet = proof.useIntent?.agentWallet;
    if (
      typeof registryAddress !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(registryAddress) ||
      typeof agentWallet !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(agentWallet)
    ) {
      fail("use-intent registry configuration", "public registry and agent addresses are missing");
    } else {
      const registryCode = await rpcRequest("eth_getCode", [
        registryAddress,
        "latest",
      ]);
      if (typeof registryCode === "string" && registryCode !== "0x") {
        pass("use-intent registry has deployed bytecode");
      } else {
        fail("use-intent registry has deployed bytecode");
      }
      for (const query of useIntentQueries) {
        const result = await verifyUseIntent(
          query,
          registryAddress,
          agentWallet,
          rpcRequest,
        );
        if (result.ok) {
          pass(`use-intent digest, signature, and anchor verified for ${query.id}`);
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
    .sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )[0];
  if (!latestPaidQuery) {
    fail("latest settled paid query exists", "no paid query with a transaction was found");
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

    const payoutReceipt = ledger.receipts
      .filter(
        (receipt) =>
          receipt.queryId === latestPaidQuery.id && receipt.feeRouterPayTx,
      )
      .at(-1);
    if (!payoutReceipt) {
      fail("latest paid query has a FeeRouter payout");
    } else {
      pass("latest paid query has a FeeRouter payout");
      const payoutTransactionReceipt = await rpcRequest(
        "eth_getTransactionReceipt",
        [payoutReceipt.feeRouterPayTx],
      );
      if (isSuccessfulReceipt(payoutTransactionReceipt)) {
        pass("latest FeeRouter payout transaction is confirmed on Arc");
      } else {
        fail("latest FeeRouter payout transaction is confirmed on Arc");
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
    console.log(`- ${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? `: ${check.detail}` : ""}`);
  }
  const failed = checks.filter((check) => !check.ok);
  console.log(failed.length === 0 ? "PASS: judge proof verified" : `FAIL: ${failed.length} check(s) failed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.log(`- FAIL verifier execution: ${error instanceof Error ? error.message : String(error)}`);
  console.log("FAIL: judge proof could not be verified");
  process.exitCode = 1;
});
