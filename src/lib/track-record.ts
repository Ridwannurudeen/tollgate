import {
  createWalletClient,
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_RPC_URL, arcTestnet } from "./chain";
import { FORUM_ADDRESSES } from "./forum";
import { stableStringify } from "./hash";
import type { PaymentReceipt, QueryRecord, TrackRecordEvidence } from "./types";

export const TRACK_RECORD_ADDRESS = FORUM_ADDRESSES.trackRecordV2;
export const TOLLGATE_BOT_ID =
  "0x434f104d66bd47acc44e9a77f3653075cbd18071da675682189101e96f316223";
export const TRACK_RECORD_BOT_KIND_OTHER = 3;
export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const RECORD_V2_TYPEHASH = keccak256(
  toHex(
    "RecordV2(bytes32 botId,uint8 kind,uint64 seq,uint64 periodStart,uint64 periodEnd,int128 pnlMicros,uint64 fills,bytes32 metaHash,bytes32 evidenceUriHash,bytes32 evidenceHash,bytes32 prevRecordHash)",
  ),
);

export const trackRecordV2Abi = [
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
    name: "recordAt",
    stateMutability: "view",
    inputs: [
      { name: "botId", type: "bytes32" },
      { name: "idx", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "seq", type: "uint64" },
          { name: "periodStart", type: "uint64" },
          { name: "periodEnd", type: "uint64" },
          { name: "pnlMicros", type: "int128" },
          { name: "fills", type: "uint64" },
          { name: "metaHash", type: "bytes32" },
          { name: "evidenceUriHash", type: "bytes32" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "recordHash", type: "bytes32" },
        ],
      },
    ],
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
] as const;

export type TrackRecordV2PublishInput = {
  seq: number;
  periodStart: number;
  periodEnd: number;
  pnlMicros: bigint;
  fills: number;
  metaHash: Hex;
  evidenceUri: string;
  evidenceHash: Hex;
  prevRecordHash: Hex;
};

export type TrackRecordState = {
  botId: Hex;
  signer: Address;
  registered: boolean;
  lastSeq: number;
  lastPeriodEnd: number;
  lastRecordHash: Hex;
  recordCount: bigint;
};

export type TrackRecordPublishOptions = {
  enabled?: boolean;
  privateKey?: Hex;
  botId?: Hex;
  publicUrl?: string;
};

export function createTrackRecordPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
}

export async function readTrackRecordState(
  botId: Hex = TOLLGATE_BOT_ID,
  publicClient: PublicClient = createTrackRecordPublicClient(),
): Promise<TrackRecordState> {
  const [signer, lastSeq, lastPeriodEnd, lastRecordHash, recordCount] =
    await Promise.all([
      publicClient.readContract({
        address: TRACK_RECORD_ADDRESS,
        abi: trackRecordV2Abi,
        functionName: "botSigner",
        args: [botId],
      }),
      publicClient.readContract({
        address: TRACK_RECORD_ADDRESS,
        abi: trackRecordV2Abi,
        functionName: "lastSeq",
        args: [botId],
      }),
      publicClient.readContract({
        address: TRACK_RECORD_ADDRESS,
        abi: trackRecordV2Abi,
        functionName: "lastPeriodEnd",
        args: [botId],
      }),
      publicClient.readContract({
        address: TRACK_RECORD_ADDRESS,
        abi: trackRecordV2Abi,
        functionName: "lastRecordHash",
        args: [botId],
      }),
      publicClient.readContract({
        address: TRACK_RECORD_ADDRESS,
        abi: trackRecordV2Abi,
        functionName: "recordCount",
        args: [botId],
      }),
    ]);

  return {
    botId,
    signer,
    registered: signer.toLowerCase() !== ZERO_ADDRESS,
    lastSeq: Number(lastSeq),
    lastPeriodEnd: Number(lastPeriodEnd),
    lastRecordHash,
    recordCount,
  };
}

export function trackRecordStructHash(
  botId: Hex,
  botKind: number,
  record: TrackRecordV2PublishInput,
): Hex {
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
        botId,
        botKind,
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

export function trackRecordDigest(domainSeparator: Hex, structHash: Hex): Hex {
  return keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}`);
}

export function trackRecordHashPayload(value: unknown): Hex {
  return keccak256(toHex(stableStringify(value)));
}

function trackRecordEnabled(options: TrackRecordPublishOptions): boolean {
  if (options.enabled !== undefined) return options.enabled;
  if (process.env.LEPTONWEB_TRACK_RECORD_ENABLED === "0") return false;
  return Boolean(process.env.LEPTONWEB_TRACK_RECORD_PRIVATE_KEY);
}

function trackRecordPrivateKey(options: TrackRecordPublishOptions): Hex {
  const privateKey =
    options.privateKey ??
    (process.env.LEPTONWEB_TRACK_RECORD_PRIVATE_KEY as Hex | undefined);
  if (!privateKey) {
    throw new Error(
      "LEPTONWEB_TRACK_RECORD_PRIVATE_KEY is required when TrackRecord publishing is enabled.",
    );
  }
  return privateKey;
}

function trackRecordBotId(options: TrackRecordPublishOptions): Hex {
  return (
    options.botId ??
    (process.env.LEPTONWEB_TRACK_RECORD_BOT_ID as Hex | undefined) ??
    TOLLGATE_BOT_ID
  );
}

export function buildTrackRecordEvidenceUri(
  queryId: string,
  publicUrl?: string,
): string {
  if (!publicUrl) return `leptonweb://answers/${queryId}`;
  return new URL(`/answers/${queryId}`, publicUrl).toString();
}

export function buildTrackRecordForAnswer(
  query: QueryRecord,
  receipts: PaymentReceipt[],
  state: Pick<TrackRecordState, "lastSeq" | "lastPeriodEnd" | "lastRecordHash">,
  evidenceUri = buildTrackRecordEvidenceUri(query.id),
): TrackRecordV2PublishInput {
  const queryCreatedAt = Math.floor(new Date(query.createdAt).getTime() / 1000);
  const periodStart =
    state.lastSeq === 0 ? Math.max(1, queryCreatedAt) : state.lastPeriodEnd + 1;
  const periodEnd = Math.max(periodStart, queryCreatedAt);

  return {
    seq: state.lastSeq + 1,
    periodStart,
    periodEnd,
    pnlMicros: -BigInt(query.totalAtomicUsdc),
    fills: receipts.length,
    metaHash: trackRecordHashPayload({
      agentMode: query.agentMode ?? "unknown",
      answerHash: query.answerHash,
      citationCount: query.citations.length,
      queryHash: query.queryHash,
      totalAtomicUsdc: query.totalAtomicUsdc,
      traceHash: query.traceHash ?? "none",
    }),
    evidenceUri,
    evidenceHash: trackRecordHashPayload({
      answerHash: query.answerHash,
      citations: query.citations,
      queryHash: query.queryHash,
      receiptHashes: receipts.map((receipt) => receipt.receiptHash),
    }),
    prevRecordHash: state.lastRecordHash,
  };
}

export async function publishTrackRecordForAnswer(
  query: QueryRecord,
  receipts: PaymentReceipt[],
  options: TrackRecordPublishOptions = {},
): Promise<TrackRecordEvidence | null> {
  if (!trackRecordEnabled(options)) return null;
  if (receipts.length === 0) {
    throw new Error(`Query ${query.id} has no receipts to anchor.`);
  }

  const privateKey = trackRecordPrivateKey(options);
  const botId = trackRecordBotId(options);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createTrackRecordPublicClient();
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });

  let state = await readTrackRecordState(botId, publicClient);
  if (!state.registered) {
    const registerTx = await walletClient.writeContract({
      address: TRACK_RECORD_ADDRESS,
      abi: trackRecordV2Abi,
      functionName: "registerBot",
      args: [botId, TRACK_RECORD_BOT_KIND_OTHER, account.address],
      account,
      chain: arcTestnet,
    });
    await publicClient.waitForTransactionReceipt({ hash: registerTx });
    state = await readTrackRecordState(botId, publicClient);
  }

  if (state.signer.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `TrackRecord bot signer is ${state.signer}; configured wallet is ${account.address}.`,
    );
  }

  const domainSeparator = await publicClient.readContract({
    address: TRACK_RECORD_ADDRESS,
    abi: trackRecordV2Abi,
    functionName: "DOMAIN_SEPARATOR",
  });
  const record = buildTrackRecordForAnswer(
    query,
    receipts,
    state,
    buildTrackRecordEvidenceUri(query.id, options.publicUrl),
  );
  const recordHash = trackRecordDigest(
    domainSeparator,
    trackRecordStructHash(botId, TRACK_RECORD_BOT_KIND_OTHER, record),
  );
  const signature = await account.sign({ hash: recordHash });
  const publishTx = await walletClient.writeContract({
    address: TRACK_RECORD_ADDRESS,
    abi: trackRecordV2Abi,
    functionName: "publish",
    args: [
      botId,
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
    account,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash: publishTx });

  return {
    botId,
    seq: record.seq,
    recordHash,
    transaction: publishTx,
    evidenceUri: record.evidenceUri,
    evidenceHash: record.evidenceHash,
    publishedAt: new Date().toISOString(),
  };
}
