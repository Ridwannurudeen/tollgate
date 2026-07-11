export type SettlementMode =
  | "local-proof"
  | "x402-verified"
  | "x402-settled"
  | "forum-routed"
  | "escrowed"
  | "refunded";

export type PayoutPolicy =
  | "standard"
  | "escrow-unverified"
  | "escrow-release"
  | "refund-unused";

export type SourceKind = "external" | "seed" | "internal-test";

export type CreatorKind = "external" | "seed" | "internal-test";

export type SourceOwnershipProof = {
  method:
    | "wallet-signature"
    | "seed-demo"
    | "operator-approved"
    | "meta-tag"
    | "dns-txt"
    | "creator-claimed";
  signer?: `0x${string}`;
  signatureHash?: string;
  verifiedAt: string;
};

export type SourceContributor = {
  wallet: `0x${string}`;
  shareBps: number;
};

export type CreatorSource = {
  id: string;
  title: string;
  creator: string;
  handle: string;
  wallet: `0x${string}`;
  url: string;
  summary: string;
  tags: string[];
  priceAtomicUsdc: number;
  sourceKind: SourceKind;
  creatorKind: CreatorKind;
  verifiedCreator: boolean;
  creatorClaimed?: boolean;
  ownershipProof?: SourceOwnershipProof;
  custody?: "self" | "circle-w3s";
  walletId?: string;
  probation?: boolean;
  registeredAt?: string;
  contentHash?: string;
  contentFetchedAt?: string;
  contentExcerpt?: string;
  notifyEmail?: string;
  contributors?: SourceContributor[];
  origin?: "registered" | "discovered" | "rss-import";
};

export type SourceRegistrationInput = {
  id?: string;
  title?: string;
  creator?: string;
  handle?: string;
  wallet?: string;
  url?: string;
  summary?: string;
  tags?: string[] | string;
  priceAtomicUsdc?: number | string;
  ownershipSignature?: string;
  ownershipTimestamp?: string;
  custody?: "self" | "circle-w3s";
  walletId?: string;
  notifyEmail?: string;
  contributors?: SourceContributor[];
  origin?: "registered" | "discovered" | "rss-import";
};

export type Citation = {
  sourceId: string;
  title: string;
  creator: string;
  handle: string;
  wallet: `0x${string}`;
  url: string;
  amountAtomicUsdc: number;
  reason: string;
  canonicalUrl?: string;
  previewExcerpt?: string;
  paidExcerpt?: string;
  sourceContentHash?: string;
  sourceExcerptHash?: string;
  contentFetchedAt?: string;
  sourceKind?: SourceKind;
  creatorKind?: CreatorKind;
  verifiedCreator?: boolean;
  creatorClaimed?: boolean;
  ownershipProof?: SourceOwnershipProof;
  payoutPolicy?: PayoutPolicy;
  contributors?: SourceContributor[];
};

export type SourceDecision = {
  sourceId: string;
  title: string;
  creator: string;
  priceAtomicUsdc: number;
  score: number;
  valuePerAtomicUsdc: number;
  selected: boolean;
  reason: string;
};

export type AgentBudget = {
  sourceBudgetAtomicUsdc: number;
  spentAtomicUsdc: number;
  remainingAtomicUsdc: number;
  candidateCount: number;
  purchasedCount: number;
};

export type AgentStep = {
  index: number;
  name: "appraise" | "allocate" | "draft" | "critique" | "reflect" | "escalate";
  summary: string;
  detail: string;
  spentAtomicUsdc?: number;
};

export type ExternalAssist = {
  provider: string;
  endpoint: string;
  amountAtomicUsdc: number;
  transaction: `0x${string}`;
  answerHash: string;
  queryId?: string;
  queryHash?: string;
};

export type PaymentReceipt = {
  id: string;
  queryId: string;
  sourceId: string;
  creator: string;
  wallet: `0x${string}`;
  amountAtomicUsdc: number;
  settlementMode: SettlementMode;
  queryPaymentHash?: string;
  payer?: string;
  transaction?: string;
  paymentResource?: string;
  feeRouterSplitId?: string;
  feeRouterCreateSplitTx?: string;
  feeRouterPayTx?: string;
  canonicalUrl?: string;
  sourceContentHash?: string;
  sourceExcerptHash?: string;
  contentFetchedAt?: string;
  ownershipProof?: SourceOwnershipProof;
  payoutPolicy?: PayoutPolicy;
  contributors?: SourceContributor[];
  releasedReceiptHashes?: string[];
  refundReason?: string;
  previousHash: string;
  receiptHash: string;
  createdAt: string;
};

export type ReceiptEvidence = {
  settlementMode: SettlementMode;
  payer?: string;
  transaction?: string;
  paymentResource?: string;
  feeRouterSplitId?: string;
  feeRouterCreateSplitTx?: string;
  feeRouterPayTx?: string;
  canonicalUrl?: string;
  sourceContentHash?: string;
  sourceExcerptHash?: string;
  contentFetchedAt?: string;
  ownershipProof?: SourceOwnershipProof;
  payoutPolicy?: PayoutPolicy;
  contributors?: SourceContributor[];
  releasedReceiptHashes?: string[];
  refundReason?: string;
};

export type QueryPaymentEvidence = {
  amountAtomicUsdc: number;
  settlementMode: SettlementMode;
  payTo: `0x${string}`;
  payer?: string;
  transaction?: string;
  paymentResource: string;
  paymentHash: string;
  // Set post-hoc when a paid query was unanswerable and the reader's payment was
  // returned on-chain. Not part of paymentHash (the ledger verifier ignores it).
  refund?: {
    amountAtomicUsdc: number;
    transaction: string;
    reason: string;
  };
};

export type TrackRecordEvidence = {
  botId: `0x${string}`;
  seq: number;
  recordHash: `0x${string}`;
  transaction: `0x${string}`;
  evidenceUri: string;
  evidenceHash: `0x${string}`;
  publishedAt: string;
};

export type QueryRecord = {
  id: string;
  question: string;
  answer: string;
  queryHash: string;
  answerHash: string;
  totalAtomicUsdc: number;
  citations: Citation[];
  agentMode?: "deterministic" | "llm";
  agentServerMode?: "offline-preview" | "production" | "judge-strict";
  agentModel?: string;
  agentRationale?: string;
  sourceDecisions?: SourceDecision[];
  agentBudget?: AgentBudget;
  agentSteps?: AgentStep[];
  externalAssists?: ExternalAssist[];
  traceHash?: string;
  receiptHashes: string[];
  readerPayment?: QueryPaymentEvidence;
  trackRecord?: TrackRecordEvidence;
  refundSummary?: {
    boughtCount: number;
    citedCount: number;
    refundedCount: number;
    refundedAtomicUsdc: number;
  };
  createdAt: string;
};

export type Ledger = {
  queries: QueryRecord[];
  receipts: PaymentReceipt[];
};

export type CreatorEarnings = {
  creator: string;
  handle: string;
  wallet: `0x${string}`;
  sourceCount: number;
  citationCount: number;
  earnedAtomicUsdc: number;
  sourceKind?: SourceKind;
  creatorKind?: CreatorKind;
  verifiedCreator?: boolean;
  creatorClaimed?: boolean;
};

export type SourceEarnings = {
  sourceId: string;
  title: string;
  creator: string;
  wallet: `0x${string}`;
  citationCount: number;
  earnedAtomicUsdc: number;
};

export type CreatorEvidence = CreatorEarnings & {
  receipts: PaymentReceipt[];
  queries: QueryRecord[];
  sources: SourceEarnings[];
};

export type SourceEvidence = SourceEarnings & {
  receipts: PaymentReceipt[];
  queries: QueryRecord[];
};

export type AnswerEvidence = {
  query: QueryRecord;
  receipts: PaymentReceipt[];
};

export type JudgeDemoEvidence = {
  localAnswer: AnswerEvidence | null;
  paidAnswer: AnswerEvidence | null;
  sourcePurchase: AnswerEvidence | null;
};

export type SettlementResult = {
  query: QueryRecord;
  receipts: PaymentReceipt[];
  ledger: Ledger;
};

export type LedgerVerificationIssue = {
  index: number;
  receiptHash?: string;
  reason: string;
};

export type LedgerVerification = {
  ok: boolean;
  receiptCount: number;
  queryCount: number;
  latestHash: string;
  issues: LedgerVerificationIssue[];
};

export type SettlementStatus = {
  mode: "multi-accept";
  serverAgentMode: "offline-preview" | "production" | "judge-strict";
  agentMode: QueryRecord["agentMode"] | null;
  agentModel: string | null;
  readerSettlement: {
    schemes: string[];
    gatewayBatchedSettlement: boolean;
    selfFacilitator: boolean;
  };
  facilitatorConfigured: boolean;
  forumRouterConfigured: boolean;
  network: string;
  asset: string;
  rpcConfigured: boolean;
  paidQueryPriceAtomicUsdc: number;
  tollgateAgentWallet: string;
  latestReaderPayment: QueryPaymentEvidence | null;
  readerPaymentTotalAtomicUsdc: number;
  latestVerifiedReceipt: string | null;
  latestSettledReceipt: string | null;
  latestForumRoutedReceipt: string | null;
  verification: LedgerVerification;
};
