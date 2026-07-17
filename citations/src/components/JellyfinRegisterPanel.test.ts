import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Jellyfin registration onboarding", () => {
  it("keeps the server registration capability out of the public browser flow", async () => {
    const [panel, page] = await Promise.all([
      readFile(new URL("./JellyfinRegisterPanel.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/jellyfin/register/page.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(panel).not.toContain('fetch("/jellyfin/api/operators/register"');
    expect(panel).not.toContain("<form");
    expect(panel).toContain("operator-issued");
    expect(page).not.toContain("returned by this page");
    expect(page).toContain("server-held registration capability");
  });
});
