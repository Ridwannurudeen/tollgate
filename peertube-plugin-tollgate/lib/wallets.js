"use strict";

const { isAddress, getAddress } = require("viem");

// Parse the admin textarea into a videoId -> wallet map. One entry per line:
//   <videoUuidOrId>=0xWallet
// Blank lines and lines starting with "#" are ignored; invalid addresses skip.
function parseWalletMap(raw) {
  const map = {};
  if (typeof raw !== "string") return map;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key && isAddress(value)) map[key] = getAddress(value);
  }
  return map;
}

module.exports = { parseWalletMap };
