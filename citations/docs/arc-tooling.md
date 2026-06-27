# Arc Tooling Verification

Verified on June 23, 2026.

## ARC CLI

Installed with:

```bash
uv tool install git+https://github.com/the-canteen-dev/ARC-cli
```

The installed executable is `arc-canteen`, not `arc`.

On this Windows machine, Application Control blocks the generated shim at `C:\Users\gudma\.local\bin\arc-canteen.exe`. The package itself is installed and usable through the tool venv:

```powershell
& "$env:APPDATA\uv\tools\arc-canteen\Scripts\python.exe" -c "from arc_canteen.cli import app; app()" -- --help
```

Verified command groups include `login`, `rpc`, `rpc-url`, `context`, `status`, `update-traction`, and `update-product`.

## Circle CLI

`circle` is installed and available from:

```text
C:\Users\gudma\AppData\Roaming\npm\circle.ps1
```

The installed CLI reports version `0.0.6`.

## TestMint

`https://testmint.myproceeds.xyz` is live and serves a Vercel app titled `Multichain Testnet USDC Faucet`.

The client bundle verifies this flow:

- Pay mainnet USDC on Base through x402.
- POST `/api/transfer`.
- Request body:

```json
{
  "recipientAddress": "0xYourRecipientAddress",
  "destinationChain": "arc-testnet",
  "mainnetAmount": 1,
  "paymentChainId": 8453
}
```

- Supported destination chains include `base-sepolia`, `avalanche-fuji`, `arc-testnet`, and `ethereum-sepolia`.
- Pricing tiers are `1`, `5`, and `10` mainnet USDC.
- Those tiers mint `1,000`, `5,000`, and `10,000` testnet USDC.
- The response includes a one-time `deliveryToken`; stream the resulting mint tx with `GET /api/tx-stream?token=<deliveryToken>`.

No TestMint purchase was submitted from this repo. The demo wallet is already funded, and live funding can also use Circle Faucet for Arc testnet USDC.
