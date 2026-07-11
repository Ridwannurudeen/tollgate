import actorClassData from "../../data/actor-classes.json";
import type { ActorClass, QueryPaymentEvidence } from "./types";

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const actorClasses = Object.fromEntries(
  Object.entries(actorClassData.wallets).map(([wallet, actorClass]) => [
    wallet.toLowerCase(),
    actorClass,
  ]),
) as Record<string, ActorClass>;

const ACTOR_CLASSES: ActorClass[] = [
  "operator",
  "fixture",
  "volume-engine",
  "reciprocal-partner",
  "sponsored-cold-human",
  "self-funded-cold-human",
  "external-agent",
  "external-integrator",
  "unclassified",
];

export type ActorPaymentMetric = {
  paymentCount: number;
  atomicUsdc: number;
  uniquePayerWallets: number;
};

export type ActorPaymentMetrics = {
  byClass: Record<ActorClass, ActorPaymentMetric>;
  independent: ActorPaymentMetric;
  total: ActorPaymentMetric;
  unclassified: ActorPaymentMetric;
};

export function actorClassForPayer(payer?: string): ActorClass {
  if (!payer || !WALLET_PATTERN.test(payer)) return "unclassified";
  return actorClasses[payer.toLowerCase()] ?? "unclassified";
}

export function actorClassForPayment(
  payment: Pick<QueryPaymentEvidence, "payer" | "actorClass">,
): ActorClass {
  return payment.actorClass ?? actorClassForPayer(payment.payer);
}

export function isIndependentActorClass(actorClass: ActorClass): boolean {
  return (
    actorClass !== "operator" &&
    actorClass !== "fixture" &&
    actorClass !== "volume-engine" &&
    actorClass !== "reciprocal-partner" &&
    actorClass !== "unclassified"
  );
}

export function actorClassCounts(
  payments: Array<Pick<QueryPaymentEvidence, "payer" | "actorClass">>,
): Record<ActorClass, number> {
  const metrics = summarizeActorPayments(payments);
  return Object.fromEntries(
    ACTOR_CLASSES.map((actorClass) => [
      actorClass,
      metrics.byClass[actorClass].paymentCount,
    ]),
  ) as Record<ActorClass, number>;
}

export function summarizeActorPayments(
  payments: Array<
    Pick<QueryPaymentEvidence, "payer" | "actorClass"> & {
      amountAtomicUsdc?: number;
    }
  >,
): ActorPaymentMetrics {
  const byClass = Object.fromEntries(
    ACTOR_CLASSES.map((actorClass) => [
      actorClass,
      { paymentCount: 0, atomicUsdc: 0, uniquePayerWallets: 0 },
    ]),
  ) as Record<ActorClass, ActorPaymentMetric>;
  const walletsByClass = new Map(
    ACTOR_CLASSES.map((actorClass) => [actorClass, new Set<string>()]),
  );
  const independentWallets = new Set<string>();
  const totalWallets = new Set<string>();
  let independentPaymentCount = 0;
  let independentAtomicUsdc = 0;
  let totalAtomicUsdc = 0;

  for (const payment of payments) {
    const actorClass = actorClassForPayment(payment);
    const amountAtomicUsdc = payment.amountAtomicUsdc ?? 0;
    const metric = byClass[actorClass];
    metric.paymentCount += 1;
    metric.atomicUsdc += amountAtomicUsdc;
    totalAtomicUsdc += amountAtomicUsdc;
    if (payment.payer && WALLET_PATTERN.test(payment.payer)) {
      const payer = payment.payer.toLowerCase();
      walletsByClass.get(actorClass)?.add(payer);
      totalWallets.add(payer);
      if (isIndependentActorClass(actorClass)) independentWallets.add(payer);
    }
    if (isIndependentActorClass(actorClass)) {
      independentPaymentCount += 1;
      independentAtomicUsdc += amountAtomicUsdc;
    }
  }

  for (const actorClass of ACTOR_CLASSES) {
    byClass[actorClass].uniquePayerWallets =
      walletsByClass.get(actorClass)?.size ?? 0;
  }

  return {
    byClass,
    independent: {
      paymentCount: independentPaymentCount,
      atomicUsdc: independentAtomicUsdc,
      uniquePayerWallets: independentWallets.size,
    },
    total: {
      paymentCount: payments.length,
      atomicUsdc: totalAtomicUsdc,
      uniquePayerWallets: totalWallets.size,
    },
    unclassified: { ...byClass.unclassified },
  };
}
