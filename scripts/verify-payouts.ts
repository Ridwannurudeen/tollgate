/**
 * Independent on-chain verification of Aperture's photographer payouts.
 *
 * verify:ledger only proves the receipt hash-chain is internally consistent.
 * This goes a step further and proves each `forum-routed` receipt against the
 * chain itself: it fetches the Arc transaction, confirms it succeeded, and
 * decodes the real USDC Transfer log to confirm the amount actually moved.
 * Turns "trust our JSON" into "check it yourself".
 *
 * Run: npm run verify:payouts        (reads data/ledger.json, hits Arc RPC)
 */

import { createPublicClient, http, parseEventLogs, type Hex } from "viem";
import { ARC_RPC_URL, ARC_USDC, arcTestnet } from "../src/lib/chain";
import { readLicenseLedger } from "../src/lib/ledger";

const TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});

type Check = {
  receiptHash: string;
  tx: string | null;
  ok: boolean;
  detail: string;
};

async function verifyReceipt(
  receiptHash: string,
  tx: string | undefined,
  recipient: string,
  amountAtomicUsdc: number,
): Promise<Check> {
  if (!tx) {
    return { receiptHash, tx: null, ok: false, detail: "no on-chain tx hash" };
  }
  let txReceipt;
  try {
    txReceipt = await client.getTransactionReceipt({ hash: tx as Hex });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { receiptHash, tx, ok: false, detail: `tx not found: ${message}` };
  }
  if (txReceipt.status !== "success") {
    return {
      receiptHash,
      tx,
      ok: false,
      detail: `tx reverted (status ${txReceipt.status})`,
    };
  }
  const transfers = parseEventLogs({
    abi: TRANSFER_ABI,
    logs: txReceipt.logs,
    eventName: "Transfer",
  }).filter((log) => log.address.toLowerCase() === ARC_USDC.toLowerCase());

  const expected = BigInt(amountAtomicUsdc);
  const match = transfers.find((log) => log.args.value === expected);
  if (!match) {
    return {
      receiptHash,
      tx,
      ok: false,
      detail: `no USDC Transfer of ${amountAtomicUsdc} atomic found in ${transfers.length} transfer(s)`,
    };
  }
  const toCreator = match.args.to.toLowerCase() === recipient.toLowerCase();
  return {
    receiptHash,
    tx,
    ok: true,
    detail: `USDC ${amountAtomicUsdc} ${match.args.from} -> ${match.args.to}${
      toCreator ? " (creator)" : " (router/split)"
    }`,
  };
}

async function main() {
  const ledger = await readLicenseLedger();
  const onchain = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "forum-routed",
  );

  if (onchain.length === 0) {
    console.log("No forum-routed receipts to verify on-chain.");
    return;
  }

  const checks: Check[] = [];
  for (const receipt of onchain) {
    checks.push(
      await verifyReceipt(
        receipt.receiptHash,
        receipt.feeRouterPayTx ?? receipt.transaction,
        receipt.wallet,
        receipt.amountAtomicUsdc,
      ),
    );
  }

  for (const check of checks) {
    const mark = check.ok ? "PASS" : "FAIL";
    console.log(`${mark}  ${check.receiptHash}  ${check.detail}`);
  }
  const passed = checks.filter((check) => check.ok).length;
  console.log(`\n${passed}/${checks.length} on-chain payouts verified.`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
