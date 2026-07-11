import judgeDemo from "../../data/judge-demo.json";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const JUDGE_DEMO_QUESTION = judgeDemo.question;
export const JUDGE_DEMO_CANDIDATES = judgeDemo.candidates;
export const JUDGE_DEMO_SOURCE_IDS = judgeDemo.candidates.map(
  (candidate) => candidate.sourceId,
);

export function isSponsoredJudgePayment(
  question: string,
  payer?: string,
): boolean {
  const operatorWallet = process.env.CIRCLE_PAYER_ADDRESS;
  return Boolean(
    question === JUDGE_DEMO_QUESTION &&
      payer &&
      ADDRESS_PATTERN.test(payer) &&
      operatorWallet &&
      ADDRESS_PATTERN.test(operatorWallet) &&
      payer.toLowerCase() === operatorWallet.toLowerCase(),
  );
}
