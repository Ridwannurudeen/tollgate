import type { ClientEvmSigner } from "@x402/evm";
import { describe, expect, it, vi } from "vitest";
import { createX402PaidFetch } from "./x402.js";

describe("createX402PaidFetch", () => {
  it("passes non-payment responses through the caller-supplied fetch", async () => {
    const fetcher = vi.fn(async () => new Response("public", { status: 200 }));
    const signer: ClientEvmSigner = {
      address: "0x7777777777777777777777777777777777777777",
      signTypedData: vi.fn(async () => `0x${"a".repeat(130)}` as `0x${string}`),
    };
    const paidFetch = createX402PaidFetch({ signer, fetch: fetcher });

    const response = await paidFetch("https://example.test/article");

    expect(await response.text()).toBe("public");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });
});
