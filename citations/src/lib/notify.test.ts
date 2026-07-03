import { describe, expect, it, vi } from "vitest";
import { notifyCreatorReceipts } from "./notify";
import type { CreatorSource, PaymentReceipt, QueryRecord } from "./types";

const source: CreatorSource = {
  id: "paid-source",
  title: "Paid Source",
  creator: "Creator",
  handle: "@creator",
  wallet: "0x1111111111111111111111111111111111111111",
  url: "https://example.com/source",
  summary: "A paid source.",
  tags: ["demo"],
  priceAtomicUsdc: 1000,
  sourceKind: "external",
  creatorKind: "external",
  verifiedCreator: true,
  notifyEmail: "creator@example.com",
};

const query: QueryRecord = {
  id: "query-1",
  question: "What did the source say?",
  answer: "The source was cited.",
  citations: [],
  receiptHashes: [],
  totalAtomicUsdc: 1000,
  queryHash: "0xquery",
  answerHash: "0xanswer",
  createdAt: "2026-07-03T00:00:00.000Z",
};

const receipt: PaymentReceipt = {
  id: "receipt-1",
  queryId: query.id,
  sourceId: source.id,
  creator: source.creator,
  wallet: source.wallet,
  amountAtomicUsdc: 1000,
  settlementMode: "local-proof",
  paymentResource: "/api/sources/paid-source",
  previousHash: `0x${"0".repeat(64)}`,
  createdAt: "2026-07-03T00:00:00.000Z",
  receiptHash: `0x${"1".repeat(64)}`,
};

describe("creator notifications", () => {
  it("posts webhook notifications when configured", async () => {
    const fetchImpl = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) => new Response("ok", { status: 200 }),
    );

    await notifyCreatorReceipts(query, [receipt], {
      env: { TOLLGATE_NOTIFY_WEBHOOK: "https://notify.example/hook" },
      fetchImpl,
      readSourcesImpl: async () => [source],
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(String(init?.body)).notifications[0]).toMatchObject({
      notifyEmail: "creator@example.com",
      sourceId: "paid-source",
      queryId: "query-1",
    });
  });

  it("sends SMTP mail when configured", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "message-1" }));
    const createTransport = vi.fn(() => ({ sendMail }));

    await notifyCreatorReceipts(query, [receipt], {
      env: {
        SMTP_HOST: "smtp.example.com",
        SMTP_FROM: "Tollgate <notify@example.com>",
      },
      createTransport,
      readSourcesImpl: async () => [source],
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Tollgate <notify@example.com>",
        to: "creator@example.com",
        subject: "Tollgate paid Paid Source",
      }),
    );
  });

  it("rejects partial SMTP auth config", async () => {
    await expect(
      notifyCreatorReceipts(query, [receipt], {
        env: { SMTP_HOST: "smtp.example.com", SMTP_USER: "user" },
        readSourcesImpl: async () => [source],
      }),
    ).rejects.toThrow("SMTP_USER and SMTP_PASS");
  });
});
