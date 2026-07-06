import React from "react";
import Link from "next/link";
import { getSessionOwner } from "../lib/account";
import { SiteNavLinks } from "./SiteNavLinks";

export async function SiteNav() {
  const owner = await getSessionOwner();
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";

  return (
    <nav className="topbar">
      <Link className="brand" href="/">
        Aperture
      </Link>
      <SiteNavLinks basePath={basePath} ownerName={owner?.displayName} />
    </nav>
  );
}
