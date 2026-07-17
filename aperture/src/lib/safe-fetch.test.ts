import type Dispatcher from "undici/types/dispatcher";
import { describe, expect, it, vi } from "vitest";
import {
  assertSafeFetchTarget,
  isUnsafeFetchHost,
  safeFetch,
  type SafeFetchOptions,
} from "./safe-fetch";

const publicResolve = async () => ["93.184.216.34"];

const nonGlobalAddresses = [
  "0.1.2.3",
  "100.64.0.1",
  "100.127.255.254",
  "192.0.0.1",
  "192.0.2.1",
  "192.88.99.2",
  "198.18.0.1",
  "198.19.255.254",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "239.255.255.250",
  "240.0.0.1",
  "255.255.255.255",
  "64:ff9b:1::1",
  "64:ff9b::7f00:1",
  "64:ff9b::a9fe:a9fe",
  "100::1",
  "100:0:0:1::1",
  "2001:2::1",
  "2001:10::1",
  "2001:db8::1",
  "2002:c000:204::1",
  "3fff::1",
  "5f00::1",
  "4000::1",
  "fec0::1",
  "ff02::1",
];

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
      "::ffff:7f00:1",
      "[::ffff:7f00:1]",
      "0:0:0:0:0:ffff:7f00:1",
      "[::ffff:a9fe:a9fe]",
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
      "192.0.0.9",
      "64:ff9b::808:808",
      "2001:3::1",
      "2001:20::1",
      "2606:4700::1111",
    ]) {
      expect(isUnsafeFetchHost(host), host).toBe(false);
    }
  });

  it("blocks every non-global-use address range", () => {
    expect(
      nonGlobalAddresses.filter((host) => !isUnsafeFetchHost(host)),
    ).toEqual([]);
  });

  it("rejects hostnames whose DNS answers are non-global-use addresses", async () => {
    const allowed = (
      await Promise.all(
        nonGlobalAddresses.map(async (address) => {
          try {
            await assertSafeFetchTarget(
              new URL("https://rebind.example.com/"),
              async () => [address],
            );
            return address;
          } catch {
            return null;
          }
        }),
      )
    ).filter((address) => address !== null);

    expect(allowed).toEqual([]);
  });

  it("blocks URL-normalized IPv4-mapped IPv6 literals", async () => {
    for (const raw of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:169.254.169.254]/",
    ]) {
      await expect(
        assertSafeFetchTarget(new URL(raw), async () => {
          throw new Error("should have been blocked before resolving");
        }),
      ).rejects.toThrow(/not allowed/);
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

  it("blocks integer/short-form loopback hosts", async () => {
    for (const raw of [
      "http://2130706433/",
      "http://127.1/",
      "http://0x7f000001/",
    ]) {
      await expect(
        assertSafeFetchTarget(new URL(raw), async () => {
          throw new Error("should have been blocked before resolving");
        }),
      ).rejects.toThrow(/not allowed/);
    }
    await expect(
      assertSafeFetchTarget(new URL("http://93.184.216.34/"), async () => {
        throw new Error("should not resolve a canonical literal");
      }),
    ).resolves.toBeUndefined();
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

  it("rejects redirects whose hostname resolves to a non-global-use address", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://redirect.example.com/admin" },
      }),
    ) as unknown as typeof fetch;
    const resolveHost = async (hostname: string) =>
      hostname === "redirect.example.com"
        ? ["2001:db8::1"]
        : ["93.184.216.34"];

    await expect(
      safeFetch(
        "https://public.example.com/feed",
        {},
        { fetchImpl, resolveHost },
      ),
    ).rejects.toThrow(/blocked address/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects to hex-form mapped loopback targets", async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://[::ffff:7f00:1]/admin" },
      })) as unknown as typeof fetch;

    await expect(
      safeFetch(
        "https://public.example.com/feed",
        {},
        { fetchImpl, resolveHost: publicResolve },
      ),
    ).rejects.toThrow(/not allowed/);
  });

  it("passes the validated DNS answer to the connection dispatcher", async () => {
    const dispatcher = {
      close: vi.fn(async () => {}),
    } as unknown as Dispatcher;
    const createDispatcher = vi.fn(() => dispatcher);
    const resolveHost = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["127.0.0.1"]);
    const fetchImpl = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        expect(
          (init as RequestInit & { dispatcher?: Dispatcher }).dispatcher,
        ).toBe(dispatcher);
        return new Response("ok");
      },
    ) as unknown as typeof fetch;
    const options = {
      createDispatcher,
      fetchImpl,
      resolveHost,
    } as SafeFetchOptions & {
      createDispatcher: (address: {
        address: string;
        family: 4 | 6;
      }) => Dispatcher;
    };

    const response = await safeFetch(
      "https://rebind.example.com/feed",
      {},
      options,
    );

    expect(await response.text()).toBe("ok");
    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(createDispatcher).toHaveBeenCalledWith({
      address: "93.184.216.34",
      family: 4,
    });
  });

  it("applies a default timeout when the caller provides no signal", async () => {
    let signal: AbortSignal | null | undefined;
    const fetchImpl = (async (
      _input: URL | RequestInfo,
      init?: RequestInit,
    ) => {
      signal = init?.signal;
      return new Response("ok");
    }) as unknown as typeof fetch;

    const response = await safeFetch(
      "https://public.example.com/feed",
      {},
      { fetchImpl, resolveHost: publicResolve },
    );
    await response.text();

    expect(signal).toBeInstanceOf(AbortSignal);
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
