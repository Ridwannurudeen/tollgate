"use client";

import { useEffect, useState } from "react";

type WithdrawFormProps = {
  basePath: string;
  wallet: string;
  initialBalanceAtomicUsdc: string | null;
};

function formatUsdc(value: string | null): string {
  if (!isAtomicAmount(value)) return "unavailable";
  const atomic = BigInt(value);
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(4, "0");
  return `${whole.toLocaleString("en-US")}.${fraction}`;
}

function isAtomicAmount(value: string | null): value is string {
  return typeof value === "string" && /^[0-9]+$/.test(value);
}

function portionAmount(
  balanceAtomicUsdc: string | null,
  percent: number,
): string {
  if (!isAtomicAmount(balanceAtomicUsdc)) return "";
  const balance = BigInt(balanceAtomicUsdc);
  if (balance <= 0n || percent <= 0) return "";
  const amount = (balance * BigInt(percent)) / 100n;
  return (amount > 0n ? amount : 1n).toString();
}

function selectedPercent(
  amountAtomicUsdc: string,
  balanceAtomicUsdc: string | null,
) {
  if (!isAtomicAmount(amountAtomicUsdc) || !isAtomicAmount(balanceAtomicUsdc)) {
    return 0;
  }
  const amount = BigInt(amountAtomicUsdc);
  const balance = BigInt(balanceAtomicUsdc);
  if (amount <= 0n || balance <= 0n) return 0;
  const percent = Number((amount * 100n) / balance);
  return Math.max(0, Math.min(100, percent));
}

function arcscanTxUrl(tx: string): string {
  return `https://testnet.arcscan.app/tx/${tx}`;
}

export function WithdrawForm({
  basePath,
  wallet,
  initialBalanceAtomicUsdc,
}: WithdrawFormProps) {
  const [toAddress, setToAddress] = useState("");
  const [amountAtomicUsdc, setAmountAtomicUsdc] = useState(
    initialBalanceAtomicUsdc ?? "",
  );
  const [balanceAtomicUsdc, setBalanceAtomicUsdc] = useState(
    initialBalanceAtomicUsdc,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [transaction, setTransaction] = useState("");
  const balanceAvailable =
    isAtomicAmount(balanceAtomicUsdc) && BigInt(balanceAtomicUsdc) > 0n;
  const selectedShare = selectedPercent(amountAtomicUsdc, balanceAtomicUsdc);

  function selectPortion(percent: number) {
    if (percent <= 0) {
      setAmountAtomicUsdc("");
      return;
    }
    const nextAmount = portionAmount(balanceAtomicUsdc, percent);
    if (nextAmount) setAmountAtomicUsdc(nextAmount);
  }

  useEffect(() => {
    let cancelled = false;
    async function refreshBalance() {
      const response = await fetch(`${basePath}/api/account/withdraw`).catch(
        () => null,
      );
      if (!response?.ok) return;
      const body = (await response.json().catch(() => null)) as {
        balanceAtomicUsdc?: unknown;
      } | null;
      const nextBalance = body?.balanceAtomicUsdc;
      if (
        !cancelled &&
        typeof nextBalance === "string" &&
        /^[0-9]+$/.test(nextBalance)
      ) {
        setBalanceAtomicUsdc(nextBalance);
        setAmountAtomicUsdc((current) => current || nextBalance);
      }
    }
    refreshBalance();
    return () => {
      cancelled = true;
    };
  }, [basePath]);

  async function withdraw(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setStatus("");
    setTransaction("");
    try {
      const response = await fetch(`${basePath}/api/account/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toAddress: toAddress.trim(),
          amountAtomicUsdc: amountAtomicUsdc.trim(),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
        transaction?: unknown;
      } | null;
      if (!response.ok) {
        setStatus(
          typeof body?.error === "string"
            ? body.error
            : "Custodial withdraw failed.",
        );
        return;
      }
      if (typeof body?.transaction === "string") {
        setTransaction(body.transaction);
        setStatus("Withdraw submitted.");
      } else {
        setStatus("Withdraw completed, but no transaction hash was returned.");
      }
    } catch {
      setStatus("Network error - please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="registerForm withdrawForm" onSubmit={withdraw}>
      <div className="walletPills">
        <span>Custodial wallet {wallet}</span>
        <span>Live balance {formatUsdc(balanceAtomicUsdc)} USDC</span>
      </div>
      <label>
        Destination wallet
        <span className="hint">
          Withdraw to an external wallet you control. Transfers cannot be
          reversed.
        </span>
        <input
          autoComplete="off"
          onChange={(event) => setToAddress(event.target.value)}
          placeholder="0x..."
          required
          value={toAddress}
        />
      </label>
      <label>
        Amount in atomic USDC
        <span className="hint">
          USDC uses 6 decimals; 2500 means 0.0025 USDC.
        </span>
        <div className="amountControls">
          <div className="quickAmountGrid" aria-label="Withdraw portion">
            {[25, 50, 75].map((percent) => (
              <button
                aria-pressed={selectedShare === percent}
                disabled={!balanceAvailable || pending}
                key={percent}
                onClick={() => selectPortion(percent)}
                type="button"
              >
                {percent}%
              </button>
            ))}
            <button
              aria-pressed={selectedShare === 100}
              disabled={!balanceAvailable || pending}
              onClick={() => selectPortion(100)}
              type="button"
            >
              Max
            </button>
          </div>
          <input
            aria-label="Select withdraw percentage"
            className="amountSlider"
            disabled={!balanceAvailable || pending}
            max="100"
            min="0"
            onChange={(event) =>
              selectPortion(Number.parseInt(event.target.value, 10))
            }
            step="1"
            type="range"
            value={selectedShare}
          />
          <span className="amountSummary">
            {selectedShare}% of balance - {formatUsdc(amountAtomicUsdc || null)}{" "}
            USDC
          </span>
        </div>
        <input
          inputMode="numeric"
          onChange={(event) => setAmountAtomicUsdc(event.target.value)}
          pattern="[0-9]*"
          placeholder="2500"
          required
          value={amountAtomicUsdc}
        />
      </label>
      <label className="confirmRow">
        <input
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          required
          type="checkbox"
        />
        <span>Confirm the destination address is correct.</span>
      </label>
      <button type="submit" disabled={pending || !confirmed}>
        {pending ? "Submitting" : "Withdraw to wallet"}
      </button>
      {status && (
        <p className={transaction ? "formStatus" : "formStatus badText"}>
          {status}
          {transaction && (
            <>
              {" "}
              <a
                href={arcscanTxUrl(transaction)}
                rel="noreferrer"
                target="_blank"
              >
                View tx
              </a>
            </>
          )}
        </p>
      )}
    </form>
  );
}
