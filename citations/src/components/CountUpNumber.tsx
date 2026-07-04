"use client";

import { useEffect, useRef, useState } from "react";
import { formatDollars } from "@/lib/format";

type Props = {
  value: number;
  kind?: "integer" | "dollars";
};

export function CountUpNumber({ value, kind = "integer" }: Props) {
  // Seed the final value so SSR and first client render match exactly (no
  // hydration mismatch, no flash of 0). The mount-only effect below then
  // replays the count from 0 -> value as a client-side visual enhancement.
  const [displayValue, setDisplayValue] = useState(value);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current) return;
    hasAnimated.current = true;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion || value === 0) {
      setDisplayValue(value);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const duration = 900;

    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setDisplayValue(value);
    }

    setDisplayValue(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (kind === "dollars") return <>{formatDollars(displayValue)}</>;
  return <>{displayValue.toLocaleString("en-US")}</>;
}
