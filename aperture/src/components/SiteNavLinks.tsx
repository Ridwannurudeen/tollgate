"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./DashboardActions";

type SiteNavLinksProps = {
  basePath: string;
  ownerName?: string;
};

function pathMatches(
  pathname: string,
  basePath: string,
  href: string,
): boolean {
  const normalized = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length) || "/"
    : pathname;
  return normalized === href || normalized.startsWith(`${href}/`);
}

export function SiteNavLinks({ basePath, ownerName }: SiteNavLinksProps) {
  const pathname = usePathname();
  const browseActive = pathMatches(pathname, basePath, "/browse");
  const linkActive = pathMatches(pathname, basePath, "/link");
  const dashboardActive = pathMatches(pathname, basePath, "/dashboard");
  const loginActive = pathMatches(pathname, basePath, "/login");

  return (
    <>
      <div className="navlinks primaryNav">
        <Link
          aria-current={browseActive ? "page" : undefined}
          className={browseActive ? "active" : undefined}
          href="/browse"
        >
          Browse
        </Link>
        <Link
          aria-current={linkActive ? "page" : undefined}
          className={linkActive ? "active primaryLink" : "primaryLink"}
          href="/link"
        >
          Sell your photos
        </Link>
      </div>
      <div className="navlinks navAuth">
        {ownerName ? (
          <>
            <span className="navIdentity">{ownerName}</span>
            <Link
              aria-current={dashboardActive ? "page" : undefined}
              className={dashboardActive ? "active" : undefined}
              href="/dashboard"
            >
              Dashboard
            </Link>
            <LogoutButton basePath={basePath} />
          </>
        ) : (
          <Link
            aria-current={loginActive ? "page" : undefined}
            className={loginActive ? "active" : undefined}
            href="/login"
          >
            Sign in
          </Link>
        )}
      </div>
    </>
  );
}
