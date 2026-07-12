const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

function rpcQuantity(value) {
  if (typeof value !== "string" || !QUANTITY_PATTERN.test(value)) return null;
  return BigInt(value);
}

export function confirmedReceiptPosition(receipt, expectedTransaction) {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    receipt.status !== "0x1" ||
    typeof expectedTransaction !== "string" ||
    !HASH_PATTERN.test(expectedTransaction) ||
    typeof receipt.transactionHash !== "string" ||
    receipt.transactionHash.toLowerCase() !==
      expectedTransaction.toLowerCase() ||
    typeof receipt.blockHash !== "string" ||
    !HASH_PATTERN.test(receipt.blockHash)
  ) {
    return null;
  }
  const blockNumber = rpcQuantity(receipt.blockNumber);
  const transactionIndex = rpcQuantity(receipt.transactionIndex);
  if (blockNumber === null || transactionIndex === null) return null;
  return {
    blockHash: receipt.blockHash.toLowerCase(),
    blockNumber,
    transactionIndex,
  };
}

export function transactionPrecedes(anchor, payout) {
  if (!anchor || !payout) return false;
  if (anchor.blockNumber < payout.blockNumber) return true;
  if (anchor.blockNumber > payout.blockNumber) return false;
  return (
    anchor.blockHash === payout.blockHash &&
    anchor.transactionIndex < payout.transactionIndex
  );
}

export function allTransactionsFollow(
  anchorReceipt,
  anchorTransaction,
  payouts,
) {
  if (!Array.isArray(payouts) || payouts.length === 0) return false;
  const anchor = confirmedReceiptPosition(anchorReceipt, anchorTransaction);
  if (!anchor) return false;
  return payouts.every((payout) => {
    if (!payout || typeof payout !== "object") return false;
    const position = confirmedReceiptPosition(
      payout.receipt,
      payout.transaction,
    );
    return position ? transactionPrecedes(anchor, position) : false;
  });
}
