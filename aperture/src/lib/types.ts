import type { Address, Hex } from "viem";

export type DownloadArchiveEvent = {
  remoteAddress: string;
  method: "POST";
  path: "/api/download/archive" | `/api/links/${string}/download`;
  sharedLinkKey: string;
  status: number | null;
  userAgent: string | null;
  referer: string | null;
  createdAt: string;
  rawLine: string;
};

export type ImmichAsset = {
  id: string;
  ownerId: string;
  originalFileName: string;
  originalPath?: string;
};

export type ImmichSharedLink = {
  id: string;
  key: string;
  assets: ImmichAsset[];
};

export type ExifCredit = {
  sourcePath: string;
  artist: string | null;
  copyright: string | null;
};

export type OwnershipProof = {
  method: "wallet-signature";
  signer: Address;
  signatureHash: `0x${string}`;
  verifiedAt: string;
};

export type WalletRegistryEntry = {
  ownerId: string;
  displayName: string;
  wallet: Address;
  createdAt: string;
  approvalStatus: "pending" | "operator-approved" | "wallet-signed";
  /** "self" = creator supplied their own wallet; "circle-w3s" = we minted a custodial one. */
  custody?: "self" | "circle-w3s";
  /** Circle W3S wallet id, present only for custodial (circle-w3s) entries. */
  walletId?: string;
  /** Hash of the one-time Aperture account key; plaintext is shown only once. */
  accountKeyHash?: `0x${string}`;
  /** Optional login address, stored lowercased. */
  email?: string;
  /** Hash of the single-use email login token. */
  loginTokenHash?: `0x${string}`;
  /** ISO expiry for the email login token. */
  loginTokenExpiresAt?: string;
  /** Extra public creator wallets this account tracks across Tollgate. */
  linkedWallets?: string[];
  /** Present only when the creator proved wallet control with a signature. */
  ownershipProof?: OwnershipProof;
};

export type WalletRegistry = {
  photographers: WalletRegistryEntry[];
};

export type SettlementMode =
  | "local-proof"
  | "forum-routed"
  | "x402-verified"
  | "x402-settled";

export type LicenseSettlementEvidence = {
  settlementMode: SettlementMode;
  payer?: Address;
  transaction?: Hex;
  paymentResource: string;
  feeRouterSplitId?: string;
  feeRouterCreateSplitTx?: Hex;
  feeRouterPayTx?: Hex;
};

export type LicenseReceipt = {
  id: string;
  eventId: Hex;
  assetId: string;
  sharedLinkId: string;
  sharedLinkKeyHash: Hex;
  ownerId: string;
  photographer: string;
  wallet: Address;
  amountAtomicUsdc: number;
  settlementMode: SettlementMode;
  payer?: Address;
  transaction?: Hex;
  paymentResource: string;
  feeRouterSplitId?: string;
  feeRouterCreateSplitTx?: Hex;
  feeRouterPayTx?: Hex;
  exifArtist?: string;
  exifCopyright?: string;
  exifSourcePath?: string;
  rawAccessLogHash: Hex;
  previousHash: Hex;
  receiptHash: Hex;
  createdAt: string;
};

export type LicenseLedger = {
  receipts: LicenseReceipt[];
};

export type LedgerVerification = {
  ok: boolean;
  receiptCount: number;
  latestHash: Hex;
  issues: { index: number; receiptHash: Hex; reason: string }[];
};
