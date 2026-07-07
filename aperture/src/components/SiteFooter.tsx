import React from "react";
import Link from "next/link";
import { ARC_EXPLORER_URL } from "../lib/chain";

export function SiteFooter() {
  return (
    <footer className="siteFooter">
      <div>
        <strong>Aperture</strong>
        <span>media licensing receipts on Arc</span>
      </div>
      <nav aria-label="Operator links">
        <Link href="/proof">Proof</Link>
        <Link href="/install">Install</Link>
        <Link href="/onboarding">Onboarding</Link>
        <a href="https://tollgate.gudman.xyz">Citations app</a>
        <a href={ARC_EXPLORER_URL}>Arcscan</a>
      </nav>
    </footer>
  );
}
