import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("WordPress registration onboarding", () => {
  it("keeps the server registration capability out of the public browser flow", async () => {
    const [panel, page] = await Promise.all([
      readFile(new URL("./WordPressRegisterPanel.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/wordpress/register/page.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(panel).not.toContain('fetch("/api/wordpress/sites/register"');
    expect(panel).not.toContain("registrationCapability");
    expect(panel).not.toContain("<form");
    expect(panel).toContain("operator-issued");
    expect(page).toMatch(/server-held\s+registration capability/);
  });
});
