import { describe, expect, it } from "vitest";
import { parseJsonObject } from "./json-parse";

describe("parseJsonObject", () => {
  it("parses a JSON object directly", () => {
    expect(parseJsonObject('{"ok":true}')).toEqual({ ok: true });
  });

  it("extracts a JSON object from surrounding text", () => {
    expect(parseJsonObject('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });
});
