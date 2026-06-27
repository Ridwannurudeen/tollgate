import { GatewayClient } from "@circle-fin/x402-batching/client";
import { loadWallet } from "./wallet-keystore.mjs";

const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3011";
const roleId = process.env.LEPTONWEB_GATEWAY_ROLE ?? "demo-payer";
const sourceId = process.argv[2] ?? "circle-gateway-nano";
const depositAmount = process.env.LEPTONWEB_GATEWAY_DEPOSIT_USDC ?? "0.05";
const minAvailableAtomicUsdc = BigInt(
  process.env.LEPTONWEB_GATEWAY_MIN_AVAILABLE_ATOMIC_USDC ?? "10000",
);

const wallet = await loadWallet(roleId);
const gateway = new GatewayClient({
  chain: "arcTestnet",
  privateKey: wallet.privateKey,
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC_URL,
});

const before = await gateway.getBalances();
let deposit = null;
if (
  depositAmount !== "0" &&
  before.gateway.available < minAvailableAtomicUsdc
) {
  deposit = await gateway.deposit(depositAmount);
}

const target = `${baseUrl}/api/sources/${sourceId}`;
const result = await gateway.pay(target);
const body = result.data;
const after = await gateway.getBalances();

console.log(
  JSON.stringify(
    {
      role: wallet.id,
      payer: wallet.address,
      sourceId,
      target,
      deposit: deposit
        ? {
            tx: deposit.depositTxHash,
            amountAtomicUsdc: deposit.amount.toString(),
            formattedAmount: deposit.formattedAmount,
          }
        : null,
      payment: {
        status: result.status,
        amountAtomicUsdc: result.amount.toString(),
        formattedAmount: result.formattedAmount,
        gatewayTransaction: result.transaction,
      },
      receipt: {
        hash: body.receipt?.receiptHash ?? null,
        settlementMode: body.settlementMode ?? null,
        transaction: body.transaction ?? null,
      },
      gatewayBalance: {
        beforeAtomicUsdc: before.gateway.available.toString(),
        afterAtomicUsdc: after.gateway.available.toString(),
        afterFormatted: after.gateway.formattedAvailable,
      },
    },
    null,
    2,
  ),
);
