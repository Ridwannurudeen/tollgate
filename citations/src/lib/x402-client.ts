"use client";

import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import {
  createWalletClient,
  custom,
  type Address,
  type SignTypedDataParameters,
  type WalletClient,
} from "viem";
import { ARC_CAIP2, ARC_CHAIN_ID, ARC_RPC_URL, arcTestnet } from "./chain";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function chainIdHex(): `0x${string}` {
  return `0x${ARC_CHAIN_ID.toString(16)}`;
}

export function shortAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
}

export async function connectArcWallet(): Promise<WalletClient> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No injected wallet found.");

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as Address[];
  const account = accounts[0];
  if (!account) throw new Error("Wallet returned no account.");

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex() }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex(),
          chainName: "Arc Testnet",
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: [ARC_RPC_URL],
          blockExplorerUrls: ["https://testnet.arcscan.app"],
        },
      ],
    });
  }

  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: custom(provider),
  });
}

export function makePaidFetch(walletClient: WalletClient): typeof fetch {
  const account = walletClient.account;
  if (!account) throw new Error("Wallet client has no account.");

  const signer = {
    address: account.address,
    signTypedData: (message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) =>
      walletClient.signTypedData({
        account,
        ...message,
      } as unknown as SignTypedDataParameters),
  };

  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: ARC_CAIP2, client: new ExactEvmScheme(signer) }],
  });
}
