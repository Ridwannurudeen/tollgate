import { once } from "node:events";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createToyPaywallServer } from "./server.mjs";

const servers = [];
const TX = `0x${"a".repeat(64)}`;

async function start(options) {
  const server = createToyPaywallServer(options);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Toy server did not bind a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("toy paywall", () => {
  it("serves only the teaser before payment", async () => {
    const baseUrl = await start({
      settle: async () => ({ splitId: "42", txHash: TX }),
    });

    const response = await fetch(baseUrl);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /One article\. One payment\./);
    assert.doesNotMatch(body, /smallest useful payment rail/);
  });

  it("unlocks once and reuses the confirmed settlement", async () => {
    let calls = 0;
    const baseUrl = await start({
      settle: async () => {
        calls += 1;
        return { splitId: "42", txHash: TX };
      },
    });

    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/unlock`, { method: "POST" }),
      fetch(`${baseUrl}/unlock`, { method: "POST" }),
    ]);
    const [firstBody, secondBody] = await Promise.all([
      first.text(),
      second.text(),
    ]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.match(firstBody, /smallest useful payment rail/);
    assert.match(secondBody, new RegExp(TX));
    assert.equal(calls, 1);
  });

  it("keeps the article locked when settlement fails", async () => {
    let calls = 0;
    const baseUrl = await start({
      settle: async () => {
        calls += 1;
        throw new Error("receipt reverted");
      },
    });

    const first = await fetch(`${baseUrl}/unlock`, { method: "POST" });
    const second = await fetch(`${baseUrl}/unlock`, { method: "POST" });
    const [firstBody, secondBody] = await Promise.all([
      first.text(),
      second.text(),
    ]);

    assert.equal(first.status, 502);
    assert.equal(second.status, 502);
    assert.match(firstBody, /Article remains locked/);
    assert.doesNotMatch(secondBody, /smallest useful payment rail/);
    assert.equal(calls, 1);
  });

  it("rejects cross-origin payment triggers", async () => {
    let calls = 0;
    const baseUrl = await start({
      settle: async () => {
        calls += 1;
        return { splitId: "42", txHash: TX };
      },
    });

    const response = await fetch(`${baseUrl}/unlock`, {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });

    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  });

  it("rejects a spoofed host even when the origin matches it", async () => {
    let calls = 0;
    const baseUrl = await start({
      settle: async () => {
        calls += 1;
        return { splitId: "42", txHash: TX };
      },
    });

    const response = await fetch(`${baseUrl}/unlock`, {
      method: "POST",
      headers: {
        host: "attacker.example",
        origin: "http://attacker.example",
      },
    });

    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  });

  it("reports the allowed method for the unlock endpoint", async () => {
    const baseUrl = await start({
      settle: async () => ({ splitId: "42", txHash: TX }),
    });

    const response = await fetch(`${baseUrl}/unlock`);

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });
});
