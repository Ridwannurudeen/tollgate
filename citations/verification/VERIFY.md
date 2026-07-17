# Tollgate — Arc testnet contract verification package

> **Status: VERIFIED on arcscan (2026-07-16).** UseReceiptRegistry is fully verified; PayGate is
> verified with a partial (metadata-hash) match — source and settings match exactly. This package is
> kept as the reproducible input used for that verification.

Everything needed to source-verify both Tollgate contracts on **testnet.arcscan.app** (Blockscout).
Built from the exact deploy-script settings and the on-chain creation transactions, and validated by
recompiling and matching the deployed bytecode (see "Validation" below).

## Why they're currently unverified
They were deployed with a custom `viem` + `solc` script (`scripts/deploy-*.mjs`) that compiles and ships raw
bytecode but **never calls a verify/publish step** (and there's no Hardhat/Foundry verify plugin). Verification
is a separate post-deploy action that just wasn't run.

## Compiler settings (identical for both — required to match)
- **Compiler:** `solc` v**0.8.35** (exact; pinned in `package-lock.json`)
- **Optimizer:** enabled, **200** runs
- **EVM version:** **cancun**
- **License:** MIT · **Language:** Solidity (Standard-JSON-Input)

## Contract 1 — UseReceiptRegistry
- **Address:** `0xFA44bD7De2C79AB6A52ce4D5aF289718B1DcB56a`
- **What it does:** anchors each use-intent on-chain (`anchor()` → `UseIntentAnchored`), binding every paid
  citation to a hash-linked receipt.
- **Standard-JSON:** `verification/UseReceiptRegistry.standard.json`
- **Constructor arg** (`agentWallet`): `0x5C94b3aBb29c1dFcA24313B9A2D383960Cd69836`
  ABI-encoded (paste as "constructor arguments"): see `verification/UseReceiptRegistry.constructor-args.txt`

## Contract 2 — PayGate
- **Address:** `0x5B0C7ff19e71185843269Bb4f15788c005Ce693c`
- **What it does:** binds a signed use-intent + spend cap into one atomic transaction that anchors the intent
  (Registry) and routes the creator payout (FeeRouter). *(Note: the public/judge deployment runs WS8, in which
  PayGate is not wired in — activate via `LEPTONWEB_PAYGATE_ADDRESS` or state its status to reviewers.)*
- **Standard-JSON:** `verification/PayGate.standard.json` (multi-file: PayGate.sol + UseReceiptRegistry.sol)
- **Constructor args** (`registry_, feeRouter_, usdc_, payer_`):
  - registry_ = `0xFA44bD7De2C79AB6A52ce4D5aF289718B1DcB56a`
  - feeRouter_ = `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59`
  - usdc_     = `0x3600000000000000000000000000000000000000`
  - payer_    = `0x4164F5B52ecc6F847f03071A287b0B59954cbcEe`
  - ABI-encoded (paste as "constructor arguments"): see `verification/PayGate.constructor-args.txt`

## Deployer (for reference)
Both Tollgate contracts were deployed by `0x5c94b3abb29c1dfca24313b9a2d383960cd69836`.
(FeeRouter `0xeff9…` and USDC `0x3600…` are Arc infrastructure — different deployer `0x1358…` — not ours.)

## How to submit — Method A: Blockscout UI (recommended; matches the viem+solc origin)
1. Open the address on `https://testnet.arcscan.app` → **Contract** tab → **Verify & Publish**.
2. Method: **Solidity (Standard JSON Input)**.
3. Compiler: **v0.8.35**. Upload the contract's `*.standard.json`.
4. Paste the **ABI-encoded constructor arguments** from the matching `*.constructor-args.txt`
   (**without** the leading `0x` if the field rejects it).
5. Submit. Repeat for the second contract.

## How to submit — Method B: Foundry (if preferred)
```
forge verify-contract 0xFA44bD7De2C79AB6A52ce4D5aF289718B1DcB56a \
  contracts/UseReceiptRegistry.sol:UseReceiptRegistry \
  --verifier blockscout --verifier-url https://testnet.arcscan.app/api/ \
  --compiler-version 0.8.35 --num-of-optimizations 200 --evm-version cancun \
  --constructor-args $(cat verification/UseReceiptRegistry.constructor-args.txt)
# repeat for PayGate at 0x5B0C7ff19e71185843269Bb4f15788c005Ce693c
# (Method A/Standard-JSON is more reliable since these were built with solc's standard-json, not Foundry.)
```

## Validation (why this will match)
Recompiled `UseReceiptRegistry` with solc 0.8.35 + this Standard-JSON: the runtime bytecode has the **same
length and structure** as the on-chain code (3664 hex sans-metadata, byte-for-byte outside the immutable/metadata
regions). The only differences are the **immutables** (`tollgateAgentWallet`, `DOMAIN_SEPARATOR` — the on-chain
code embeds agent-wallet `0x5c94…`; a fresh compile has zeros) and the **metadata hash** — both are normalized by
Blockscout during verification. PayGate uses the same compiler/settings and is built identically, so the same
holds.
