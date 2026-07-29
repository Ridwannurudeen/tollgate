import { rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, toHex } from "viem";
import {
  hasSqliteLedger,
  ledgerJsonPath,
  readLedger,
  updateSqliteQuery,
} from "./ledger-store.mjs";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const TRACK_RECORD_ADDRESS = "0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66";
const BOT_ID =
  process.env.LEPTONWEB_TRACK_RECORD_BOT_ID ??
  "0x434f104d66bd47acc44e9a77f3653075cbd18071da675682189101e96f316223";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const BOT_KIND_OTHER = 3;
const RECORD_V2_TYPEHASH = keccak256(
  toHex(
    "RecordV2(bytes32 botId,uint8 kind,uint64 seq,uint64 periodStart,uint64 periodEnd,int128 pnlMicros,uint64 fills,bytes32 metaHash,bytes32 evidenceUriHash,bytes32 evidenceHash,bytes32 prevRecordHash)",
  ),
);

const arcChain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
};

const trackRecordV2Abi = [
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "botSigner",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "lastSeq",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "lastPeriodEnd",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "lastRecordHash",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "recordCount",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "registerBot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "botId", type: "bytes32" },
      { name: "kind", type: "uint8" },
      { name: "signer", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "botId", type: "bytes32" },
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "seq", type: "uint64" },
          { name: "periodStart", type: "uint64" },
          { name: "periodEnd", type: "uint64" },
          { name: "pnlMicros", type: "int128" },
          { name: "fills", type: "uint64" },
          { name: "metaHash", type: "bytes32" },
          { name: "evidenceUri", type: "string" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "prevRecordHash", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
];

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(value) {
  return keccak256(toHex(stableStringify(value)));
}

function structHash(record) {
  const evidenceUriHash = keccak256(toHex(record.evidenceUri));
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "int128" },
        { type: "uint64" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        RECORD_V2_TYPEHASH,
        BOT_ID,
        BOT_KIND_OTHER,
        BigInt(record.seq),
        BigInt(record.periodStart),
        BigInt(record.periodEnd),
        record.pnlMicros,
        BigInt(record.fills),
        record.metaHash,
        evidenceUriHash,
        record.evidenceHash,
        record.prevRecordHash,
      ],
    ),
  );
}

function digest(domainSeparator, hash) {
  return keccak256(`0x1901${domainSeparator.slice(2)}${hash.slice(2)}`);
}

function evidenceUri(queryId) {
  const publicUrl = process.env.LEPTONWEB_PUBLIC_URL;
  if (!publicUrl) return `leptonweb://answers/${queryId}`;
  return new URL(`/answers/${queryId}`, publicUrl).toString();
}

function pickQuery(ledger) {
  const queryId = process.env.LEPTONWEB_TRACK_QUERY_ID;
  if (queryId) {
    const query = ledger.queries.find((candidate) => candidate.id === queryId);
    if (!query) throw new Error(`No query found for ${queryId}.`);
    return query;
  }
  const query = ledger.queries.find(
    (candidate) =>
      candidate.citations.length > 0 &&
      !candidate.question.startsWith("Paid source access:") &&
      (!candidate.trackRecord || process.env.LEPTONWEB_TRACK_RECORD_FORCE === "1"),
  );
  if (!query) {
    throw new Error("No unpublished answer query with citations was found.");
  }
  return query;
}

function receiptsForQuery(ledger, query) {
  const hashes = new Set(query.receiptHashes);
  return ledger.receipts.filter(
    (receipt) => receipt.queryId === query.id || hashes.has(receipt.receiptHash),
  );
}

function buildRecord(query, receipts, state) {
  const createdAt = Math.floor(new Date(query.createdAt).getTime() / 1000);
  const periodStart =
    state.lastSeq === 0 ? Math.max(1, createdAt) : state.lastPeriodEnd + 1;
  const periodEnd = Math.max(periodStart, createdAt);
  return {
    seq: state.lastSeq + 1,
    periodStart,
    periodEnd,
    pnlMicros: -BigInt(query.totalAtomicUsdc),
    fills: receipts.length,
    metaHash: hashPayload({
      agentMode: query.agentMode ?? "unknown",
      answerHash: query.answerHash,
      citationCount: query.citations.length,
      queryHash: query.queryHash,
      totalAtomicUsdc: query.totalAtomicUsdc,
    }),
    evidenceUri: evidenceUri(query.id),
    evidenceHash: hashPayload({
      answerHash: query.answerHash,
      citations: query.citations,
      queryHash: query.queryHash,
      receiptHashes: receipts.map((receipt) => receipt.receiptHash),
    }),
    prevRecordHash: state.lastRecordHash,
  };
}

const roleId = process.env.LEPTONWEB_TRACK_RECORD_ROLE ?? "demo-payer";
const wallet = await loadWallet(roleId);
const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(ARC_RPC_URL),
});
const walletClient = createWalletClient({
  account: wallet.account,
  chain: arcChain,
  transport: http(ARC_RPC_URL),
});

const appDir = fileURLToPath(new URL("..", import.meta.url));
const ledgerPath = ledgerJsonPath(appDir);
const ledger = await readLedger(appDir);
const query = pickQuery(ledger);
const receipts = receiptsForQuery(ledger, query);
if (receipts.length === 0) {
  throw new Error(`Query ${query.id} has no receipts to anchor.`);
}
if (query.trackRecord && process.env.LEPTONWEB_TRACK_RECORD_FORCE !== "1") {
  console.log(
    JSON.stringify(
      {
        queryId: query.id,
        skipped: true,
        reason: "Query already has TrackRecord evidence.",
        trackRecord: query.trackRecord,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

let signer = await publicClient.readContract({
  address: TRACK_RECORD_ADDRESS,
  abi: trackRecordV2Abi,
  functionName: "botSigner",
  args: [BOT_ID],
});
let registerTx = null;
if (signer.toLowerCase() === ZERO_ADDRESS) {
  registerTx = await walletClient.writeContract({
    address: TRACK_RECORD_ADDRESS,
    abi: trackRecordV2Abi,
    functionName: "registerBot",
    args: [BOT_ID, BOT_KIND_OTHER, wallet.address],
    account: wallet.account,
    chain: arcChain,
  });
  await publicClient.waitForTransactionReceipt({ hash: registerTx });
  signer = wallet.address;
}

if (signer.toLowerCase() !== wallet.address.toLowerCase()) {
  throw new Error(
    `TrackRecord bot signer is ${signer}; wallet role ${wallet.id} is ${wallet.address}.`,
  );
}

const [domainSeparator, lastSeq, lastPeriodEnd, lastRecordHash, recordCount] =
  await Promise.all([
    publicClient.readContract({
      address: TRACK_RECORD_ADDRESS,
      abi: trackRecordV2Abi,
      functionName: "DOMAIN_SEPARATOR",
    }),
    publicClient.readContract({
      address: TRACK_RECORD_ADDRESS,
      abi: trackRecordV2Abi,
      functionName: "lastSeq",
      args: [BOT_ID],
    }),
    publicClient.readContract({
      address: TRACK_RECORD_ADDRESS,
      abi: trackRecordV2Abi,
      functionName: "lastPeriodEnd",
      args: [BOT_ID],
    }),
    publicClient.readContract({
      address: TRACK_RECORD_ADDRESS,
      abi: trackRecordV2Abi,
      functionName: "lastRecordHash",
      args: [BOT_ID],
    }),
    publicClient.readContract({
      address: TRACK_RECORD_ADDRESS,
      abi: trackRecordV2Abi,
      functionName: "recordCount",
      args: [BOT_ID],
    }),
  ]);

const record = buildRecord(query, receipts, {
  lastSeq: Number(lastSeq),
  lastPeriodEnd: Number(lastPeriodEnd),
  lastRecordHash: lastRecordHash || ZERO_BYTES32,
});
const recordHash = digest(domainSeparator, structHash(record));
const signature = await wallet.account.sign({ hash: recordHash });
const publishTx = await walletClient.writeContract({
  address: TRACK_RECORD_ADDRESS,
  abi: trackRecordV2Abi,
  functionName: "publish",
  args: [
    BOT_ID,
    {
      seq: BigInt(record.seq),
      periodStart: BigInt(record.periodStart),
      periodEnd: BigInt(record.periodEnd),
      pnlMicros: record.pnlMicros,
      fills: BigInt(record.fills),
      metaHash: record.metaHash,
      evidenceUri: record.evidenceUri,
      evidenceHash: record.evidenceHash,
      prevRecordHash: record.prevRecordHash,
    },
    signature,
  ],
  account: wallet.account,
  chain: arcChain,
});
const publishReceipt = await publicClient.waitForTransactionReceipt({
  hash: publishTx,
});

const publishedAt = new Date().toISOString();
query.trackRecord = {
  botId: BOT_ID,
  seq: record.seq,
  recordHash,
  transaction: publishTx,
  evidenceUri: record.evidenceUri,
  evidenceHash: record.evidenceHash,
  publishedAt,
};

if (await hasSqliteLedger(appDir)) {
  await updateSqliteQuery(appDir, query);
} else {
  const tmpPath = `${ledgerPath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await rename(tmpPath, ledgerPath);
}

console.log(
  JSON.stringify(
    {
      role: wallet.id,
      signer: wallet.address,
      botId: BOT_ID,
      queryId: query.id,
      registerTx,
      publishTx,
      blockNumber: publishReceipt.blockNumber.toString(),
      seq: record.seq,
      previousRecordCount: recordCount.toString(),
      recordHash,
      evidenceUri: record.evidenceUri,
      evidenceHash: record.evidenceHash,
    },
    null,
    2,
  ),
);
