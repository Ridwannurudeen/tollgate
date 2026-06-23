export type SettlementMode =
  | "local-proof"
  | "x402-verified"
  | "x402-settled"
  | "forum-routed";

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
};

export type QueryPaymentEvidence = {
  amountAtomicUsdc: number;
  settlementMode: SettlementMode;
  payTo: `0x${string}`;
  payer?: string;
  transaction?: string;
  paymentResource: string;
  paymentHash: string;
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
  agentRationale?: string;
  sourceDecisions?: SourceDecision[];
  agentBudget?: AgentBudget;
  receiptHashes: string[];
  readerPayment?: QueryPaymentEvidence;
  trackRecord?: TrackRecordEvidence;
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
