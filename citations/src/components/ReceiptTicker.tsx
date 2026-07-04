"use client";

import { useMemo, useState } from "react";
import { formatDollars } from "@/lib/format";
import { recentReceiptTickerReceipts } from "@/lib/first-load";
import type { PaymentReceipt } from "@/lib/types";

type Props = {
  receipts: PaymentReceipt[];
};

export function ReceiptTicker({ receipts }: Props) {
  const [tickerPaused, setTickerPaused] = useState(false);
  const tickerReceipts = useMemo(
    () => recentReceiptTickerReceipts(receipts),
    [receipts],
  );

  return (
    <section className="ticker" aria-label="Live receipt ticker">
      <div className="ticker-viewport">
        <div className={`ticker-track${tickerPaused ? " is-paused" : ""}`}>
          {[...tickerReceipts, ...tickerReceipts].map((receipt, index) => (
            <span key={`${receipt.receiptHash}-${index}`}>
              {receipt.creator} +{formatDollars(receipt.amountAtomicUsdc)}
            </span>
          ))}
          {receipts.length === 0 && (
            <>
              <span>Awaiting the first paid citation</span>
              <span>Registered works are ready to earn</span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        className="ticker-pause"
        aria-pressed={tickerPaused}
        aria-label={
          tickerPaused
            ? "Resume live receipt ticker"
            : "Pause live receipt ticker"
        }
        onClick={() => setTickerPaused((paused) => !paused)}
      >
        {tickerPaused ? "Play" : "Pause"}
      </button>
    </section>
  );
}
