import type { Address, Hex, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_USDC, arcChain } from "./chain";
import {
  createFeeRouterPublicClient,
  createFeeRouterSigner,
  usdcRouterAbi,
  waitForSuccessfulTransaction,
  type FeeRouterWalletClient,
} from "./fee-router";
import { FEE_ROUTER_ADDRESS } from "./fee-router-contract";
import {
  retireFeeRouterNonceState,
  withReservedNonce,
} from "./fee-router-nonce";
import { blockFeeRouterSignerOperations } from "./fee-router-signer-lifecycle";
import { payGateAddress } from "./pay-gate";

export type FeeRouterKeyRotationOptions = {
  publicClient?: PublicClient;
  walletClient?: FeeRouterWalletClient;
};

export type FeeRouterKeyRotationResult = {
  outgoingAddress: Address;
  incomingAddress: Address;
  revokedSpenders: Address[];
};

function rotationPrivateKey(value: string | undefined, name: string): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex key.`);
  }
  return value as Hex;
}

export async function rotateFeeRouterKeystoreSigner(
  nextPrivateKey: Hex,
  options: FeeRouterKeyRotationOptions = {},
): Promise<FeeRouterKeyRotationResult> {
  if ((process.env.TOLLGATE_SIGNER ?? "keystore") !== "keystore") {
    throw new Error("FeeRouter key rotation requires keystore mode.");
  }
  if (
    process.env.LEPTONWEB_USE_INTENT_ENABLED === "1" &&
    !process.env.LEPTONWEB_USE_INTENT_PRIVATE_KEY
  ) {
    throw new Error(
      "LEPTONWEB_USE_INTENT_PRIVATE_KEY is required before rotating the FeeRouter key while use-intent signing is enabled.",
    );
  }
  const outgoingPrivateKey = rotationPrivateKey(
    process.env.LEPTONWEB_FEE_ROUTER_PRIVATE_KEY,
    "LEPTONWEB_FEE_ROUTER_PRIVATE_KEY",
  );
  const incomingPrivateKey = rotationPrivateKey(
    nextPrivateKey,
    "incoming FeeRouter private key",
  );
  const outgoing = privateKeyToAccount(outgoingPrivateKey);
  const incoming = privateKeyToAccount(incomingPrivateKey);
  if (outgoing.address.toLowerCase() === incoming.address.toLowerCase()) {
    throw new Error("FeeRouter rotation requires a different account.");
  }
  const publicClient = options.publicClient ?? createFeeRouterPublicClient();
  const signer = createFeeRouterSigner({
    privateKey: outgoingPrivateKey,
    publicClient,
    walletClient: options.walletClient,
  });
  const configuredPayGate = payGateAddress();
  const spenders = configuredPayGate
    ? [FEE_ROUTER_ADDRESS, configuredPayGate]
    : [FEE_ROUTER_ADDRESS];

  return blockFeeRouterSignerOperations(outgoing.address, async () => {
    const revokedSpenders: Address[] = [];
    for (const spender of spenders) {
      const allowance = await publicClient.readContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "allowance",
        args: [outgoing.address, spender],
      });
      if (allowance === 0n) continue;
      const transaction = await withReservedNonce(
        publicClient,
        outgoing,
        (nonce) =>
          signer.walletClient.writeContract({
            address: ARC_USDC,
            abi: usdcRouterAbi,
            functionName: "approve",
            args: [spender, 0n],
            account: outgoing,
            chain: arcChain,
            nonce,
          }),
      );
      await waitForSuccessfulTransaction(
        publicClient,
        transaction,
        "FeeRouter outgoing allowance revocation",
      );
      revokedSpenders.push(spender);
    }
    await retireFeeRouterNonceState(outgoing);
    await retireFeeRouterNonceState(incoming);
    process.env.LEPTONWEB_FEE_ROUTER_PRIVATE_KEY = incomingPrivateKey;
    return {
      outgoingAddress: outgoing.address,
      incomingAddress: incoming.address,
      revokedSpenders,
    };
  });
}
