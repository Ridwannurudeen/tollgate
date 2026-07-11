import { describe, expect, it } from "vitest";
import {
  actorClassCounts,
  actorClassForPayer,
  actorClassForPayment,
  isIndependentActorClass,
  summarizeActorPayments,
} from "./actor-class";
import { createQueryPaymentEvidence } from "./settlement";

describe("actor classification", () => {
  it("uses the committed wallet mapping and keeps unknown wallets unclassified", () => {
    expect(
      actorClassForPayer("0x12F25B721Cc21c38495e33A4c8524dd0B647ba03"),
    ).toBe("fixture");
    expect(
      actorClassForPayer("0x9999999999999999999999999999999999999999"),
    ).toBe("unclassified");
  });

  it("does not let mutable deployment config reclassify historical payments", () => {
    const previous = process.env.CIRCLE_PAYER_ADDRESS;
    process.env.CIRCLE_PAYER_ADDRESS =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    try {
      expect(
        actorClassForPayer("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
      ).toBe("unclassified");
    } finally {
      if (previous === undefined) delete process.env.CIRCLE_PAYER_ADDRESS;
      else process.env.CIRCLE_PAYER_ADDRESS = previous;
    }
  });

  it("does not count fixtures or unknown wallets as independent", () => {
    expect(isIndependentActorClass("external-agent")).toBe(true);
    expect(isIndependentActorClass("fixture")).toBe(false);
    expect(isIndependentActorClass("unclassified")).toBe(false);
    expect(
      actorClassForPayment({
        payer: "0x9999999999999999999999999999999999999999",
        actorClass: "external-integrator",
      }),
    ).toBe("external-integrator");
  });

  it("counts classes without mutating the payment records", () => {
    const payments = [
      { payer: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03" },
      {
        payer: "0x9999999999999999999999999999999999999999",
        actorClass: "external-agent" as const,
      },
    ];
    expect(actorClassCounts(payments)).toMatchObject({
      fixture: 1,
      "external-agent": 1,
      unclassified: 0,
    });
    expect(payments[0]).not.toHaveProperty("actorClass");
  });

  it("summarizes class counts, volume, and unique payer wallets", () => {
    const metrics = summarizeActorPayments([
      {
        payer: "0x1111111111111111111111111111111111111111",
        actorClass: "external-agent",
        amountAtomicUsdc: 1_500,
      },
      {
        payer: "0x1111111111111111111111111111111111111111",
        actorClass: "external-agent",
        amountAtomicUsdc: 500,
      },
      {
        payer: "0x2222222222222222222222222222222222222222",
        amountAtomicUsdc: 700,
      },
    ]);

    expect(metrics.byClass["external-agent"]).toEqual({
      paymentCount: 2,
      atomicUsdc: 2_000,
      uniquePayerWallets: 1,
    });
    expect(metrics.independent).toEqual({
      paymentCount: 2,
      atomicUsdc: 2_000,
      uniquePayerWallets: 1,
    });
    expect(metrics.total).toEqual({
      paymentCount: 3,
      atomicUsdc: 2_700,
      uniquePayerWallets: 2,
    });
    expect(metrics.unclassified.atomicUsdc).toBe(700);
  });

  it("keeps actor classification outside the reader payment hash", () => {
    const payment = {
      amountAtomicUsdc: 1_000,
      settlementMode: "x402-settled" as const,
      payTo: "0x3333333333333333333333333333333333333333" as const,
      payer: "0x4444444444444444444444444444444444444444",
      transaction: `0x${"5".repeat(64)}`,
      paymentResource: "/api/paid-query",
    };
    const operator = createQueryPaymentEvidence({
      ...payment,
      actorClass: "operator",
    });
    const external = createQueryPaymentEvidence({
      ...payment,
      actorClass: "external-agent",
    });

    expect(operator.paymentHash).toBe(external.paymentHash);
    expect(operator.actorClass).toBe("operator");
    expect(external.actorClass).toBe("external-agent");
  });
});
