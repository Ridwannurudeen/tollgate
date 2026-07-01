"use strict";

const { defineChain } = require("viem");

// Arc testnet defaults (Circle's L1). Overridable via plugin settings so an
// operator can point at a different deployment without editing code.
const DEFAULTS = {
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  usdc: "0x3600000000000000000000000000000000000000",
  feeRouter: "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59",
  explorerUrl: "https://testnet.arcscan.app",
  usdcDecimals: 6,
};

function buildChain(config) {
  const chainId = config.chainId || DEFAULTS.chainId;
  const rpcUrl = config.rpcUrl || DEFAULTS.rpcUrl;
  const explorerUrl = config.explorerUrl || DEFAULTS.explorerUrl;
  return defineChain({
    id: chainId,
    name: `Arc (${chainId})`,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Arcscan", url: explorerUrl } },
    testnet: true,
  });
}

function explorerTxUrl(explorerUrl, tx) {
  const base = explorerUrl || DEFAULTS.explorerUrl;
  return `${base}/tx/${tx}`;
}

function formatUsdc(atomicUsdc) {
  return (Number(atomicUsdc) / 1_000_000).toFixed(6);
}

module.exports = { DEFAULTS, buildChain, explorerTxUrl, formatUsdc };
