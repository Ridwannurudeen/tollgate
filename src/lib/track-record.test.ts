import { describe, expect, it } from "vitest";
import { createQueryRecord } from "./engine";
import {
  RECORD_V2_TYPEHASH,
  ZERO_BYTES32,
  buildTrackRecordForAnswer,
  buildTrackRecordEvidenceUri,
  publishTrackRecordForAnswer,
  trackRecordDigest,
  trackRecordHashPayload,
  trackRecordStructHash,
} from "./track-record";
import type { PaymentReceipt } from "./types";

describe("TrackRecordV2 helpers", () => {
  it("uses Forum's RecordV2 typehash", () => {
    expect(RECORD_V2_TYPEHASH).toBe(
      "0xb876e246bbfbcf0fcd1b73b5d917ac0b61f111fa36bfc09a289aa6685af30790",
    );
  });

  it("builds a monotonic answer attribution record", () => {
    const query = createQueryRecord(
      "How should agents pay creators?",
      "2026-06-23T00:00:00.000Z",
    );
    const receipts = query.citations.map(
      (citation, index): PaymentReceipt => ({
        id: `receipt-${index}`,
        queryId: query.id,
        sourceId: citation.sourceId,
        creator: citation.creator,
        wallet: citation.wallet,
        amountAtomicUsdc: citation.amountAtomicUsdc,
        settlementMode: "local-proof",
        paymentResource: `/api/sources/${citation.sourceId}`,
        previousHash: ZERO_BYTES32,
        receiptHash: trackRecordHashPayload({
          sourceId: citation.sourceId,
          index,
        }),
        createdAt: query.createdAt,
      }),
    );

    const record = buildTrackRecordForAnswer(query, receipts, {
      lastSeq: 4,
      lastPeriodEnd: 2_000,
      lastRecordHash: ZERO_BYTES32,
    });

    expect(record.seq).toBe(5);
    expect(record.periodStart).toBe(2_001);
    expect(record.periodEnd).toBeGreaterThanOrEqual(record.periodStart);
    expect(record.fills).toBe(receipts.length);
    expect(record.pnlMicros).toBe(-BigInt(query.totalAtomicUsdc));
  });

  it("composes the digest from domain separator and struct hash", () => {
    const record = {
      seq: 1,
      periodStart: 10,
      periodEnd: 20,
      pnlMicros: -1000n,
      fills: 1,
      metaHash: trackRecordHashPayload({ meta: true }),
      evidenceUri: buildTrackRecordEvidenceUri("query-1"),
      evidenceHash: trackRecordHashPayload({ evidence: true }),
      prevRecordHash: ZERO_BYTES32,
    };
    const structHash = trackRecordStructHash(
      "0x826d03b1edbf2c7251b6ff4a521c01cda6c01c1bf84cff2e39fc85b4edd4f6cd",
      3,
      record,
    );

    expect(
      trackRecordDigest(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
        structHash,
      ),
    ).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("skips publishing when TrackRecord runtime publishing is disabled", async () => {
    const query = createQueryRecord(
      "How should agents pay creators?",
      "2026-06-23T00:00:00.000Z",
    );
    const receipts = query.citations.map(
      (citation, index): PaymentReceipt => ({
        id: `receipt-${index}`,
        queryId: query.id,
        sourceId: citation.sourceId,
        creator: citation.creator,
        wallet: citation.wallet,
        amountAtomicUsdc: citation.amountAtomicUsdc,
        settlementMode: "local-proof",
        paymentResource: `/api/sources/${citation.sourceId}`,
        previousHash: ZERO_BYTES32,
        receiptHash: trackRecordHashPayload({
          sourceId: citation.sourceId,
          index,
        }),
        createdAt: query.createdAt,
      }),
    );

    await expect(
      publishTrackRecordForAnswer(query, receipts, { enabled: false }),
    ).resolves.toBeNull();
  });

  it("requires a runtime private key when TrackRecord publishing is enabled", async () => {
    const query = createQueryRecord(
      "How should agents pay creators?",
      "2026-06-23T00:00:00.000Z",
    );
    const citation = query.citations[0];
    if (!citation) throw new Error("missing test citation");
    const receipt: PaymentReceipt = {
      id: "receipt-0",
      queryId: query.id,
      sourceId: citation.sourceId,
      creator: citation.creator,
      wallet: citation.wallet,
      amountAtomicUsdc: citation.amountAtomicUsdc,
      settlementMode: "local-proof",
      paymentResource: `/api/sources/${citation.sourceId}`,
      previousHash: ZERO_BYTES32,
      receiptHash: trackRecordHashPayload({ sourceId: citation.sourceId }),
      createdAt: query.createdAt,
    };

    await expect(
      publishTrackRecordForAnswer(query, [receipt], { enabled: true }),
    ).rejects.toThrow("LEPTONWEB_TRACK_RECORD_PRIVATE_KEY");
  });
});
