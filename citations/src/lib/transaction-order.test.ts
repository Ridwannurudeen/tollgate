import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type RpcReceipt = Record<string, unknown> | null;

const TRANSACTION_ORDER_URL = pathToFileURL(
  path.join(process.cwd(), "scripts", "transaction-order.mjs"),
).href;

function transactionHash(character: string): string {
  return `0x${character.repeat(64)}`;
}

function receipt(
  transaction: string,
  blockNumber: string,
  transactionIndex: string,
  blockHash = transactionHash("f"),
): RpcReceipt {
  return {
    status: "0x1",
    transactionHash: transaction,
    blockHash,
    blockNumber,
    transactionIndex,
  };
}

function evaluateTransactionOrder(payload: unknown): unknown {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const order = await import(${JSON.stringify(TRANSACTION_ORDER_URL)});
const payload = JSON.parse(await new Promise((resolve) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => resolve(input));
}));
const result = payload.mode === "all"
  ? order.allTransactionsFollow(
      payload.anchorReceipt,
      payload.anchorTransaction,
      payload.payouts,
    )
  : (() => {
      const anchor = order.confirmedReceiptPosition(
        payload.anchorReceipt,
        payload.anchorTransaction,
      );
      const payout = order.confirmedReceiptPosition(
        payload.payoutReceipt,
        payload.payoutTransaction,
      );
      return {
        anchor: Boolean(anchor),
        payout: Boolean(payout),
        precedes: Boolean(anchor && payout && order.transactionPrecedes(anchor, payout)),
      };
    })();
process.stdout.write(JSON.stringify(result));`,
    ],
    { input: JSON.stringify(payload), encoding: "utf8" },
  );
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout) as unknown;
}

describe("confirmed Arc transaction ordering", () => {
  it("accepts a lower block or an earlier transaction in the same block", () => {
    const anchorTransaction = transactionHash("a");
    const payoutTransaction = transactionHash("b");

    expect(
      evaluateTransactionOrder({
        anchorReceipt: receipt(anchorTransaction, "0x10", "0x5"),
        anchorTransaction,
        payoutReceipt: receipt(payoutTransaction, "0x11", "0x0"),
        payoutTransaction,
      }),
    ).toEqual({ anchor: true, payout: true, precedes: true });
    expect(
      evaluateTransactionOrder({
        anchorReceipt: receipt(anchorTransaction, "0x10", "0x5"),
        anchorTransaction,
        payoutReceipt: receipt(payoutTransaction, "0x10", "0x6"),
        payoutTransaction,
      }),
    ).toEqual({ anchor: true, payout: true, precedes: true });
  });

  it("rejects equal, reversed, later-block, and forked positions", () => {
    const anchorTransaction = transactionHash("a");
    const payoutTransaction = transactionHash("b");
    const cases = [
      {
        anchorReceipt: receipt(anchorTransaction, "0x10", "0x5"),
        payoutReceipt: receipt(payoutTransaction, "0x10", "0x5"),
      },
      {
        anchorReceipt: receipt(anchorTransaction, "0x10", "0x6"),
        payoutReceipt: receipt(payoutTransaction, "0x10", "0x5"),
      },
      {
        anchorReceipt: receipt(anchorTransaction, "0x11", "0x0"),
        payoutReceipt: receipt(payoutTransaction, "0x10", "0x5"),
      },
      {
        anchorReceipt: receipt(
          anchorTransaction,
          "0x10",
          "0x5",
          transactionHash("e"),
        ),
        payoutReceipt: receipt(payoutTransaction, "0x10", "0x6"),
      },
    ];

    for (const item of cases) {
      expect(
        evaluateTransactionOrder({
          ...item,
          anchorTransaction,
          payoutTransaction,
        }),
      ).toEqual({ anchor: true, payout: true, precedes: false });
    }
  });

  it("rejects pending, reverted, malformed, and hash-mismatched receipts", () => {
    const anchorTransaction = transactionHash("a");
    const payoutTransaction = transactionHash("b");
    const validPayout = receipt(payoutTransaction, "0x11", "0x0");
    const invalidAnchors: RpcReceipt[] = [
      null,
      { ...receipt(anchorTransaction, "0x10", "0x5"), status: "0x0" },
      receipt(transactionHash("c"), "0x10", "0x5"),
      receipt(anchorTransaction, "16", "0x5"),
      { ...receipt(anchorTransaction, "0x10", "0x5"), transactionIndex: null },
    ];

    for (const anchorReceipt of invalidAnchors) {
      expect(
        evaluateTransactionOrder({
          anchorReceipt,
          anchorTransaction,
          payoutReceipt: validPayout,
          payoutTransaction,
        }),
      ).toEqual({ anchor: false, payout: true, precedes: false });
    }
  });

  it("requires the anchor to precede every payout", () => {
    const anchorTransaction = transactionHash("a");
    const firstPayout = transactionHash("b");
    const secondPayout = transactionHash("c");
    const anchorReceipt = receipt(anchorTransaction, "0x10", "0x5");
    const payouts = [
      {
        transaction: firstPayout,
        receipt: receipt(firstPayout, "0x10", "0x6"),
      },
      {
        transaction: secondPayout,
        receipt: receipt(secondPayout, "0x11", "0x0"),
      },
    ];

    expect(
      evaluateTransactionOrder({
        mode: "all",
        anchorReceipt,
        anchorTransaction,
        payouts,
      }),
    ).toBe(true);
    expect(
      evaluateTransactionOrder({
        mode: "all",
        anchorReceipt,
        anchorTransaction,
        payouts: [
          payouts[0],
          {
            transaction: secondPayout,
            receipt: receipt(secondPayout, "0x10", "0x4"),
          },
        ],
      }),
    ).toBe(false);
  });
});
