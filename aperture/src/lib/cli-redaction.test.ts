import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";

const PRIVATE_WALLET_ID = "circle-wallet-private-sentinel";
const PRIVATE_WALLET_SET_ID = "circle-wallet-set-private-sentinel";
const PUBLIC_ADDRESS = "0x1111111111111111111111111111111111111111";

describe("register-creator CLI output", () => {
  it("omits private wallet and wallet-set IDs", () => {
    const tempDir = mkdtempSync(
      path.join(os.tmpdir(), "aperture-register-cli-"),
    );
    try {
      const target = path.resolve(
        process.cwd(),
        "scripts",
        "register-creator.ts",
      );
      const compiledTarget = path.join(tempDir, "register-creator.mjs");
      writeFileSync(
        compiledTarget,
        transpileModule(readFileSync(target, "utf8"), {
          compilerOptions: {
            module: ModuleKind.ESNext,
            target: ScriptTarget.ES2022,
          },
        }).outputText,
        "utf8",
      );
      const circleMockPath = path.join(tempDir, "circle-w3s.mjs");
      const onboardingMockPath = path.join(tempDir, "onboarding.mjs");
      writeFileSync(
        circleMockPath,
        `
        export async function w3sCreateWalletSet() {
          return ${JSON.stringify(PRIVATE_WALLET_SET_ID)};
        }
      `,
        "utf8",
      );
      writeFileSync(
        onboardingMockPath,
        `
        export async function registerCreator() {
          return {
            ownerId: "owner-1",
            displayName: "Jane Lens",
            wallet: ${JSON.stringify(PUBLIC_ADDRESS)},
            createdAt: "2026-07-17T00:00:00.000Z",
            approvalStatus: "operator-approved",
            custody: "circle-w3s",
            walletId: ${JSON.stringify(PRIVATE_WALLET_ID)},
          };
        }
      `,
        "utf8",
      );
      const mockModules = {
        "src/lib/circle-w3s": pathToFileURL(circleMockPath).href,
        "src/lib/onboarding": pathToFileURL(onboardingMockPath).href,
      };
      const loaderPath = path.join(tempDir, "loader.mjs");
      writeFileSync(
        loaderPath,
        `
          const mocks = new Map(
            Object.entries(JSON.parse(process.env.CLI_MOCK_MODULES ?? "{}")),
          );

          export async function resolve(specifier, context, nextResolve) {
            for (const [suffix, url] of mocks) {
              if (specifier.endsWith(suffix)) {
                return { url, shortCircuit: true };
              }
            }
            return nextResolve(specifier, context);
          }
        `,
        "utf8",
      );

      const result = spawnSync(
        process.execPath,
        [
          "--experimental-loader",
          pathToFileURL(loaderPath).href,
          compiledTarget,
          "--owner-id",
          "owner-1",
          "--display-name",
          "Jane Lens",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            CIRCLE_WALLET_SET_ID: "",
            CLI_MOCK_MODULES: JSON.stringify(mockModules),
          },
          timeout: 10_000,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(PRIVATE_WALLET_ID);
      expect(result.stdout).not.toContain(PRIVATE_WALLET_SET_ID);
      expect(result.stdout).toContain(PUBLIC_ADDRESS);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
