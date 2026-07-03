import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("/widget.js", () => {
  it("serves an embeddable script that preserves the creator parameter", async () => {
    const response = GET();
    const script = await response.text();

    expect(response.headers.get("content-type")).toContain(
      "application/javascript",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300",
    );
    expect(script).toContain('src.searchParams.get("creator")');
    expect(script).toContain('"/embed?creator="');
    expect(script).toContain("encodeURIComponent(creator)");
  });
});
