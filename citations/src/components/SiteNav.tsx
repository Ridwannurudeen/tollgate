"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

type Props = {
  proofOk?: boolean;
};

// "/" has no dedicated nav item (the hash link to #how is a same-page
// anchor, not a route), so it never carries an active state of its own.
const NAV_LINKS = [
  { href: "/#how", label: "How it works", match: null as string | null },
  { href: "/core", label: "Integrations", match: "/core" },
  { href: "/sources", label: "Sources", match: "/sources" },
  { href: "/ask", label: "Ask the AI", match: "/ask" },
  { href: "/creators", label: "Creators", match: "/creators" },
  { href: "/proof", label: "Proof", match: "/proof" },
];

export function SiteNav({ proofOk = true }: Props) {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDetailsElement>(null);

  function isActive(match: string | null): boolean {
    if (!match) return false;
    return pathname === match || pathname.startsWith(`${match}/`);
  }

  function closeMenu() {
    if (menuRef.current) menuRef.current.open = false;
  }

  const registerActive = pathname === "/register";

  return (
    <header className="site-nav" aria-label="Site header">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Link className="nav-brand" href="/" aria-label="Tollgate home">
        <span>Tollgate</span>
        <small>Pay creators per citation</small>
      </Link>
      <nav className="site-nav-links" aria-label="Primary">
        <span
          className="network-pill"
          aria-label={
            proofOk ? "Payments live and verified" : "Payments need review"
          }
        >
          <span className={proofOk ? "live-dot" : "live-dot alert-dot"} />
          {proofOk ? "Live" : "Review"}
        </span>
        {NAV_LINKS.map((link) => (
          <Link
            className={
              isActive(link.match) ? "wallet-button is-active" : "wallet-button"
            }
            aria-current={isActive(link.match) ? "page" : undefined}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
        <Link
          className={
            registerActive
              ? "wallet-button primary is-active"
              : "wallet-button primary"
          }
          aria-current={registerActive ? "page" : undefined}
          href="/register"
        >
          Register your work
        </Link>
      </nav>
      <details className="site-nav-menu" ref={menuRef}>
        <summary aria-label="Open navigation menu">Menu</summary>
        <div className="site-nav-menu-panel">
          {NAV_LINKS.map((link) => (
            <Link
              aria-current={isActive(link.match) ? "page" : undefined}
              className={isActive(link.match) ? "is-active" : undefined}
              href={link.href}
              key={link.href}
              onClick={closeMenu}
            >
              {link.label}
            </Link>
          ))}
          <Link
            aria-current={registerActive ? "page" : undefined}
            className={registerActive ? "primary is-active" : "primary"}
            href="/register"
            onClick={closeMenu}
          >
            Register your work
          </Link>
        </div>
      </details>
    </header>
  );
}
