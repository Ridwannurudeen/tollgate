export function formatUsdc(atomicUsdc: number): string {
  return (atomicUsdc / 1_000_000).toFixed(6);
}

export function formatAtomicUsdc(value: bigint | string): string {
  return formatUsdc(Number(value));
}

export function shortHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

export function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export function settlementLabel(mode: string): string {
  if (mode === "forum-routed") return "forum routed";
  if (mode === "x402-settled") return "x402 settled";
  if (mode === "x402-verified") return "x402 verified";
  return "local proof";
}

export function arcscanTxUrl(tx: string): string {
  return `https://testnet.arcscan.app/tx/${tx}`;
}
