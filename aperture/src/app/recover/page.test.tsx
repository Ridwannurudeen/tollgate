import { describe, expect, it, vi } from "vitest";
import RecoverPage from "./page";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

describe("recover page", () => {
  it("redirects to the primary login flow", () => {
    RecoverPage();

    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
});
