import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import OnboardingPage from "./page";

vi.stubGlobal("React", React);

vi.mock("../../lib/registry", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/registry")>(
      "../../lib/registry",
    );
  return {
    ...actual,
    readWalletRegistry: vi.fn(async () => ({
      photographers: [
        {
          ownerId: "archive@example.com",
          displayName: "Archive archive@example.com",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          createdAt: "2026-07-06T00:00:00.000Z",
          approvalStatus: "operator-approved",
        },
      ],
    })),
  };
});

vi.mock("../../components/SiteNav", () => ({
  SiteNav: () => "nav",
}));

vi.mock("../../components/SiteFooter", () => ({
  SiteFooter: () => "footer",
}));

describe("onboarding page", () => {
  it("uses public creator projections for the current registry", async () => {
    const page = await OnboardingPage();
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain("Archive");
    expect(payload).not.toContain("archive@example.com");
    expect(payload).toContain("server-held");
    expect(payload).not.toContain("Register payout mapping");
  });
});
