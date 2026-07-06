export const CIRCLE_FAUCET_URL = "https://faucet.circle.com";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function errorCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

export function payErrorMessage(error: unknown, priceText: string): string {
  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);

  if (
    message.includes("no injected wallet") ||
    message.includes("no wallet") ||
    message.includes("metamask") ||
    message.includes("ethereum")
  ) {
    return "No wallet detected. Install MetaMask (or any Arc-compatible wallet) and try again.";
  }

  if (
    code === 4001 ||
    message.includes("user rejected") ||
    message.includes("rejected") ||
    message.includes("cancelled") ||
    message.includes("denied")
  ) {
    return "Payment cancelled - approve the wallet prompt to unlock the photo.";
  }

  if (
    message.includes("insufficient") ||
    message.includes("balance") ||
    message.includes("funds")
  ) {
    return `Your wallet needs at least ${priceText} in digital dollars (USDC). Get test USDC free at ${CIRCLE_FAUCET_URL}, then try again.`;
  }

  if (message.includes("chain") || message.includes("network")) {
    return "Switch your wallet to Arc testnet and try again.";
  }

  return "Payment could not be completed. Try again, or use unlock without a wallet.";
}
