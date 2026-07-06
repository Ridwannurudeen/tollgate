import { describe, expect, it } from "vitest";
import { encodeEip712 } from "./circle-w3s";

describe("encodeEip712", () => {
  it("adds the domain type and serializes bigint fields as strings", () => {
    const encoded = encodeEip712({
      domain: {
        name: "USDC",
        version: "2",
        chainId: 5042002n,
        verifyingContract: "0x3600000000000000000000000000000000000000",
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "value", type: "uint256" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: "0x1111111111111111111111111111111111111111",
        value: 2500n,
      },
    });
    const parsed = JSON.parse(encoded) as {
      types: { EIP712Domain: Array<{ name: string; type: string }> };
      domain: { chainId: string };
      message: { value: string };
    };

    expect(parsed.types.EIP712Domain).toContainEqual({
      name: "chainId",
      type: "uint256",
    });
    expect(parsed.domain.chainId).toBe("5042002");
    expect(parsed.message.value).toBe("2500");
  });
});
