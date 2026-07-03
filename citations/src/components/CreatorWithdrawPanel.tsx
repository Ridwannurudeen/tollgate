"use client";

import { useState } from "react";
import { createWalletClient, custom, getAddress, type Hex } from "viem";
import { ARC_CHAIN_ID, arcTestnet } from "@/lib/chain";
import { FEE_ROUTER_ADDRESS, feeRouterV1Abi } from "@/lib/fee-router-contract";
import { arcscanTxUrl, formatDollars, shortHash } from "@/lib/format";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

type Props = {
  wallet: `0x${string}`;
  claimableAtomicUsdc: string | null;
  custody: "self" | "circle-w3s";
};

export function CreatorWithdrawPanel({
  wallet,
  claimableAtomicUsdc,
  custody,
}: Props) {
  const [status, setStatus] = useState("");
  const [tx, setTx] = useState<Hex | null>(null);
  const claimable = claimableAtomicUsdc ? BigInt(claimableAtomicUsdc) : null;
  const disabled = claimable === null || claimable === 0n;

  async function claimSelfCustody() {
    if (!window.ethereum) {
      throw new Error("No injected wallet found.");
    }
    const walletClient = createWalletClient({
      chain: arcTestnet,
      transport: custom(window.ethereum),
    });
    const [account] = await walletClient.requestAddresses();
    if (!account || getAddress(account) !== getAddress(wallet)) {
      throw new Error("Connect the payout wallet for this creator page.");
    }
    await walletClient.switchChain({ id: ARC_CHAIN_ID });
    return walletClient.writeContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterV1Abi,
      functionName: "claim",
      account,
      chain: arcTestnet,
    });
  }

  async function claimCustodial() {
    const response = await fetch(`/api/creators/${wallet}/claim`, {
      method: "POST",
    });
    const body = (await response.json()) as {
      claimed?: boolean;
      message?: string;
      transaction?: Hex;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
    if (body.claimed === false) {
      throw new Error(body.message ?? "Nothing to claim yet.");
    }
    if (!body.transaction) {
      throw new Error(body.error ?? "Claim did not return a transaction.");
    }
    return body.transaction;
  }

  async function claim() {
    setStatus("Preparing claim...");
    setTx(null);
    try {
      const transaction =
        custody === "circle-w3s"
          ? await claimCustodial()
          : await claimSelfCustody();
      setTx(transaction);
      setStatus("Claim submitted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Claim failed.");
    }
  }

  return (
    <section className="receipt-context profile-section">
      <div className="panel-heading">
        <p className="eyebrow">withdraw</p>
        <h3>Claim FeeRouter earnings</h3>
      </div>
      <div className="reader-payment-card receipt-payment-card">
        <div>
          <span>available</span>
          <strong>
            {claimable === null ? "RPC unavailable" : formatDollars(claimable)}
          </strong>
        </div>
        <div>
          <span>custody</span>
          <strong>{custody === "circle-w3s" ? "Circle W3S" : "self"}</strong>
        </div>
        <div>
          <span>claim tx</span>
          <strong>
            {tx ? (
              <a
                className="receipt-link inline-link"
                href={arcscanTxUrl(tx)}
                rel="noreferrer"
                target="_blank"
              >
                {shortHash(tx)}
              </a>
            ) : (
              "none"
            )}
          </strong>
        </div>
        <div>
          <span>action</span>
          <button
            type="button"
            className="source-register-button"
            disabled={disabled}
            onClick={claim}
          >
            Withdraw
          </button>
        </div>
      </div>
      <p className="status-line" aria-live="polite">
        {status ||
          (disabled
            ? "No claimable FeeRouter balance is available."
            : "Claim sends accrued FeeRouter earnings to the payout wallet.")}
      </p>
    </section>
  );
}
