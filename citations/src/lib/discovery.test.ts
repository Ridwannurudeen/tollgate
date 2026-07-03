import { describe, expect, it } from "vitest";
import {
  discoveryRegistrations,
  parseTollgateJson,
  parseTollgateMeta,
} from "./discovery";

describe("tollgate discovery", () => {
  it("parses tollgate.json declarations into source registrations", () => {
    const declaration = parseTollgateJson(
      {
        version: "1",
        wallet: "0x7777777777777777777777777777777777777777",
        defaultPriceAtomicUsdc: 1500,
        sources: [
          {
            url: "/research",
            priceAtomicUsdc: 2200,
            title: "Research",
            tags: ["Agents", "Payments"],
          },
        ],
      },
      "https://publisher.example",
    );

    const registrations = discoveryRegistrations(
      declaration,
      "https://publisher.example",
    );

    expect(registrations).toEqual([
      {
        title: "Research",
        creator: "publisher.example",
        handle: "@publisherexample",
        wallet: "0x7777777777777777777777777777777777777777",
        url: "https://publisher.example/research",
        summary: "Open-web Tollgate source declared by publisher.example.",
        tags: ["agents", "payments"],
        priceAtomicUsdc: 2200,
        origin: "discovered",
      },
    ]);
  });

  it("parses the meta tag shorthand", () => {
    const declaration = parseTollgateMeta(
      `<html><head><meta name="tollgate" content="wallet=0x8888888888888888888888888888888888888888; price=1700"></head></html>`,
      "https://writer.example/post",
    );

    expect(declaration?.wallet).toBe(
      "0x8888888888888888888888888888888888888888",
    );
    expect(declaration?.sources[0]).toEqual({
      url: "https://writer.example/post",
      priceAtomicUsdc: 1700,
    });
  });

  it("rejects duplicate or invalid declaration shapes", () => {
    expect(() =>
      parseTollgateJson(
        {
          version: "1",
          wallet: "not-a-wallet",
          defaultPriceAtomicUsdc: 1500,
        },
        "https://publisher.example",
      ),
    ).toThrow("wallet");
  });
});
