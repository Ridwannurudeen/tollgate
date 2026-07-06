import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SiteNav } from "./SiteNav";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  usePathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
}));

vi.mock("../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
}));

vi.mock("./DashboardActions", () => ({
  LogoutButton: () => <button type="button">Log out</button>,
}));

describe("SiteNav", () => {
  it("renders public navigation and login when logged out", async () => {
    mocks.getSessionOwner.mockResolvedValue(null);
    mocks.usePathname.mockReturnValue("/aperture/login");

    const nav = await SiteNav();
    const markup = renderToStaticMarkup(nav as ReactElement);

    expect(markup).toContain("Browse");
    expect(markup).toContain("Sell your photos");
    expect(markup).toContain("Log in");
    expect(markup).not.toContain("Dashboard");
    expect(markup).not.toContain("Log out");
    expect(markup).toContain('aria-current="page"');
  });

  it("renders dashboard and logout when logged in", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
    });
    mocks.usePathname.mockReturnValue("/aperture/dashboard");

    const nav = await SiteNav();
    const markup = renderToStaticMarkup(nav as ReactElement);

    expect(markup).toContain("Jane Lens");
    expect(markup).toContain("Dashboard");
    expect(markup).toContain("Log out");
    expect(markup).not.toContain(">Log in<");
    expect(markup).toContain('aria-current="page"');
  });
});
