export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export type JellyfinWebhookPayload = Record<string, unknown>;

export type PlaybackEventKind = "playback-start" | "playback-stop";

export type CreatorRegistryEntry = {
  itemId: string;
  itemIds?: string[];
  title?: string;
  displayName: string;
  wallet: Address;
  priceAtomicUsdcPerMinute?: number;
  approvalStatus?: "pending" | "operator-approved" | "wallet-signed";
};

export type CreatorRegistry = {
  videos: CreatorRegistryEntry[];
};

export type NormalizedPlaybackEvent = {
  kind: PlaybackEventKind;
  notificationType: string;
  itemId: string;
  itemName: string;
  itemType: string;
  userId: string;
  sessionId: string | null;
  deviceId: string | null;
  clientName: string | null;
  timestamp: string;
  playbackPositionTicks: number | null;
  runTimeTicks: number | null;
  playedToCompletion: boolean | null;
  rawHash: Hex;
  raw: JellyfinWebhookPayload;
};

export type ActivePlaybackSession = {
  key: string;
  itemId: string;
  itemName: string;
  itemType: string;
  userId: string;
  sessionId: string | null;
  deviceId: string | null;
  clientName: string | null;
  startedAt: string;
  startPlaybackPositionTicks: number;
  rawStartHash: Hex;
};

export type SessionStore = {
  sessions: ActivePlaybackSession[];
};

export type SettlementMode = "dry-run" | "forum-routed";

export type SettlementEvidence = {
  settlementMode: SettlementMode;
  paymentResource: string;
  wallet: Address;
  amountAtomicUsdc: number;
  feeRouterSplitId: string;
  dryRun?: true;
  payer?: Address;
  transaction?: Hex;
  feeRouterCreateSplitTx?: Hex;
  feeRouterPayTx?: Hex;
};

export type FeeRouterSettlementInput = {
  wallet: Address;
  amountAtomicUsdc: number;
  itemId: string;
  eventId: Hex;
  watchedMinutes: number;
};

export type FeeRouterAdapter = {
  settle(input: FeeRouterSettlementInput): Promise<SettlementEvidence>;
};

export type PlaybackReceipt = {
  id: string;
  eventId: Hex;
  itemId: string;
  itemName: string;
  itemType: string;
  userId: string;
  sessionId: string | null;
  creator: string;
  wallet: Address;
  watchedSeconds: number;
  watchedMinutes: number;
  priceAtomicUsdcPerMinute: number;
  amountAtomicUsdc: number;
  settlement: SettlementEvidence;
  startedAt: string;
  stoppedAt: string;
  rawStartHash: Hex | null;
  rawStopHash: Hex;
  previousHash: Hex;
  receiptHash: Hex;
  createdAt: string;
};

export type PlaybackLedger = {
  receipts: PlaybackReceipt[];
};

export type LedgerVerification = {
  ok: boolean;
  receiptCount: number;
  latestHash: Hex;
  issues: { index: number; receiptHash: Hex; reason: string }[];
};

export type ProcessWebhookResult =
  | { kind: "ignored"; reason: string }
  | { kind: "started"; session: ActivePlaybackSession }
  | { kind: "settled"; receipt: PlaybackReceipt; created: boolean }
  | { kind: "unresolved"; event: NormalizedPlaybackEvent; reason: string };
