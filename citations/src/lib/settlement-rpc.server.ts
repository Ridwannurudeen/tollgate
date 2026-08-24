import "server-only";

import { inspect } from "node:util";
import { http, type HttpTransport } from "viem";
import { ARC_RPC_URL } from "./chain";

const HTTP_URL_PATTERN = /https?:\/\/[^\s'"<>]+/g;

// This module is server-only because the configured URL may contain an API key.
// Client-safe chain configuration remains in chain.ts.
export function settlementRpcUrl(): string {
  return process.env.ARC_SETTLEMENT_RPC_URL || ARC_RPC_URL;
}

function assertSettlementRpcUrl(value: string): void {
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new Error("ARC_SETTLEMENT_RPC_URL must be a valid HTTP(S) URL.");
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("ARC_SETTLEMENT_RPC_URL must be a valid HTTP(S) URL.");
  }
}

function redactUrls(value: string): string {
  return value.replace(HTTP_URL_PATTERN, "[redacted rpc url]");
}

function redactErrorUrls(error: unknown): unknown {
  if (!error || typeof error !== "object") {
    return typeof error === "string" ? redactUrls(error) : error;
  }
  const seen = new WeakSet<object>();
  const visit = (value: object): void => {
    if (seen.has(value)) return;
    seen.add(value);
    for (const name of Reflect.ownKeys(value)) {
      const current = Reflect.get(value, name) as unknown;
      if (current instanceof Headers) {
        const headers = new Headers();
        current.forEach((headerValue, headerName) => {
          headers.set(headerName, redactUrls(headerValue));
        });
        Reflect.set(value, name, headers);
      } else if (typeof current === "string") {
        Reflect.set(value, name, redactUrls(current));
      } else if (current && typeof current === "object") {
        visit(current);
      }
    }
  };
  visit(error);
  const inspected = inspect(error, { depth: 8 });
  return redactUrls(inspected) === inspected
    ? error
    : new Error("Settlement RPC request failed.");
}

export function settlementTransport(): HttpTransport {
  const configured = process.env.ARC_SETTLEMENT_RPC_URL;
  if (!configured) return http(ARC_RPC_URL);
  assertSettlementRpcUrl(configured);
  const privateTransport = http(configured);
  return ((options) => {
    const transport = privateTransport(options);
    const request: typeof transport.request = async (...args) => {
      try {
        return await transport.request(...args);
      } catch (error) {
        throw redactErrorUrls(error);
      }
    };
    return {
      ...transport,
      config: { ...transport.config, request },
      request,
      value: { ...transport.value, url: ARC_RPC_URL },
    };
  }) as HttpTransport;
}
