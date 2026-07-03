import { describe, expect, it } from "vitest";
import {
  assertSafeFetchTarget,
  isUnsafeFetchHost,
  safeFetch,
} from "./safe-fetch";

const publicResolve = async () => ["93.184.216.34"];

describe("safe fetch guards", () => {
  it("blocks loopback, private, link-local, and metadata hosts", () => {
    const unsafe = [
      "localhost",
      "api.localhost",
      "0.0.0.0",
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.169.254",
      "::1",
      "::",
      "[::1]",
      "fe80::1",
      "fd00::2",
      "fc00::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
    ];
    for (const host of unsafe) {
      expect(isUnsafeFetchHost(host), host).toBe(true);
    }
  });

  it("allows normal public hosts", () => {
    for (const host of [
      "example.com",
      "8.8.8.8",
      "172.32.0.1",
      "2606:4700::1111",
    ]) {
      expect(isUnsafeFetchHost(host), host).toBe(false);
    }
  });

  it("rejects hostnames that resolve to blocked addresses", async () => {
    await expect(
      assertSafeFetchTarget(
        new URL("https://rebind.example.com/"),
        async () => ["169.254.169.254"],
      ),
    ).rejects.toThrow(/blocked address/);
  });

  it("rejects redirects to blocked targets", async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })) as unknown as typeof fetch;

    await expect(
      safeFetch(
        "https://public.example.com/feed",
        {},
        { fetchImpl, resolveHost: publicResolve },
      ),
    ).rejects.toThrow(/not allowed/);
  });

  it("follows safe redirects and returns the final response", async () => {
    let calls = 0;
    const fetchImpl = (async (input: URL | RequestInfo) => {
      calls += 1;
      const url = new URL(String(input));
      if (url.pathname === "/start") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://public.example.com/final" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const response = await safeFetch(
      "https://public.example.com/start",
      {},
      { fetchImpl, resolveHost: publicResolve },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(calls).toBe(2);
  });

  it("gives up after too many redirects", async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://public.example.com/loop" },
      })) as unknown as typeof fetch;

    await expect(
      safeFetch(
        "https://public.example.com/loop",
        {},
        { fetchImpl, resolveHost: publicResolve },
      ),
    ).rejects.toThrow(/too many redirects/);
  });
});
