"use client";

import { useEffect } from "react";

export function LegacyHashRedirect() {
  useEffect(() => {
    if (window.location.hash === "#register") {
      window.location.replace("/register");
    }
    if (window.location.hash === "#ask") {
      window.location.replace("/ask");
    }
  }, []);

  return null;
}
