import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const PRIVATE_WALLET_ID = "circle-wallet-private-sentinel";
const PRIVATE_WALLET_SET_ID = "circle-wallet-set-private-sentinel";
const PUBLIC_ADDRESS = "0x1111111111111111111111111111111111111111";

function runScript(
  scriptName: string,
  mockModules: Record<string, string>,
  cwd = process.cwd(),
  envOverrides: Record<string, string | undefined> = {},
) {
  const target = path.resolve(process.cwd(), "scripts", scriptName);
  const loaderDir = mkdtempSync(path.join(os.tmpdir(), "tollgate-cli-loader-"));
  try {
    const loaderPath = path.join(loaderDir, "loader.mjs");
    writeFileSync(
      loaderPath,
      `
        const mocks = new Map(
          Object.entries(JSON.parse(process.env.CLI_MOCK_MODULES ?? "{}")),
        );

        export async function resolve(specifier, context, nextResolve) {
          for (const [suffix, source] of mocks) {
            if (specifier.endsWith(suffix)) {
              return {
                url: "data:text/javascript;base64," + Buffer.from(source).toString("base64"),
                shortCircuit: true,
              };
            }
          }
          return nextResolve(specifier, context);
        }
      `,
      "utf8",
    );
    return spawnSync(
      process.execPath,
      ["--experimental-loader", pathToFileURL(loaderPath).href, target],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          CIRCLE_PAYER_WALLET_ID: "",
          CIRCLE_PAYER_ADDRESS: "",
          CIRCLE_WALLET_SET_ID: "",
          CLI_MOCK_MODULES: JSON.stringify(mockModules),
          ...envOverrides,
        },
        timeout: 10_000,
      },
    );
  } finally {
    rmSync(loaderDir, { recursive: true, force: true });
  }
}

const circleWalletMock = `
  export function payerWalletId() { return ${JSON.stringify(PRIVATE_WALLET_ID)}; }
  export function payerAddress() { return ${JSON.stringify(PUBLIC_ADDRESS)}; }
`;

const paidFetchMock = `
  export function createW3SPaidFetch() {
    return async function paidFetch() {
      return {
        ok: true,
        async json() {
          return {
            settlementMode: "x402-settled",
            receipt: {
              receiptHash: "0xreceipt",
              amountAtomicUsdc: 1000,
              creator: ${JSON.stringify(PUBLIC_ADDRESS)},
            },
            query: {
              question: "How does Tollgate work?",
              readerPayment: {
                settlementMode: "x402-settled",
                paymentHash: "0xpayment",
                amountAtomicUsdc: 1000,
              },
              receiptHashes: ["0xreceipt"],
              totalAtomicUsdc: 1000,
            },
          };
        },
      };
    };
  }
`;

const circleProvisioningMock = `
  export async function w3sCreateWalletSet() {
    return ${JSON.stringify(PRIVATE_WALLET_SET_ID)};
  }
  export async function w3sCreateWallet() {
    return { id: ${JSON.stringify(PRIVATE_WALLET_ID)} };
  }
  export async function w3sWallet() {
    return {
      id: ${JSON.stringify(PRIVATE_WALLET_ID)},
      address: ${JSON.stringify(PUBLIC_ADDRESS)},
    };
  }
`;

describe("Circle CLI output", () => {
  for (const scriptName of [
    "prove-w3s-source.mjs",
    "prove-w3s-paid-query.mjs",
  ]) {
    it(`${scriptName} omits the private payer wallet ID`, () => {
      const result = runScript(scriptName, {
        "circle-w3s.mjs": circleWalletMock,
        "x402-paid-fetch-w3s.mjs": paidFetchMock,
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(PRIVATE_WALLET_ID);
      expect(result.stdout).not.toContain("payerWalletId");
      expect(result.stdout).toContain(PUBLIC_ADDRESS);
      expect(result.stdout).toContain("0xreceipt");
      if (scriptName === "prove-w3s-paid-query.mjs") {
        expect(result.stdout).toContain("0xpayment");
      }
    });
  }

  it("circle-create-wallets omits private wallet and wallet-set IDs", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "tollgate-circle-cli-"));
    try {
      const result = runScript(
        "circle-create-wallets.mjs",
        { "circle-w3s.mjs": circleProvisioningMock },
        tempDir,
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(PRIVATE_WALLET_ID);
      expect(result.stdout).not.toContain(PRIVATE_WALLET_SET_ID);
      expect(result.stdout).toContain(PUBLIC_ADDRESS);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("circle-create-wallets omits a reused private wallet-set ID", () => {
    const result = runScript(
      "circle-create-wallets.mjs",
      { "circle-w3s.mjs": circleProvisioningMock },
      process.cwd(),
      {
        CIRCLE_WALLET_SET_ID: PRIVATE_WALLET_SET_ID,
        CIRCLE_PAYER_WALLET_ID: PRIVATE_WALLET_ID,
        CIRCLE_PAYER_ADDRESS: PUBLIC_ADDRESS,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain(PRIVATE_WALLET_SET_ID);
    expect(result.stdout).not.toContain(PRIVATE_WALLET_ID);
    expect(result.stdout).toContain(PUBLIC_ADDRESS);
  });
});
