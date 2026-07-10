# Toy paywall Arc testnet proof

Verified on 2026-07-10 against Arc testnet chain `5042002` with a fresh in-memory payer key. The key was passed only to the loopback toy process and discarded after the run.

- Ephemeral payer: `0x37E844B6e739A082934325147a42F3E9BD99C2f7`
- Recipient: `0xc9F2A6146cff81735925825b192ad6cdA4059c3c`
- Funding: `0.02` Arc testnet USDC ([transaction](https://testnet.arcscan.app/tx/0x4f5416a1e382992334fec545198eb6545867eef11e64495136d034a55647d3f6))
- Split: `178`, one recipient at `10,000` bps ([creation transaction](https://testnet.arcscan.app/tx/0xdd0afb3751af3157966efba73d4995b4be8863fef472867eebe622f9d8edafdc))
- Routed amount: `1,000` atomic USDC ([payment transaction](https://testnet.arcscan.app/tx/0x1c2dc07704705b7fbc43839488b277ddf689c84df6e114d910ea53de4a715e42))

Post-run RPC verification:

- Arcscan indexed all three linked transactions with status `ok`
- Payment receipt status: `success`
- Split `totalRouted`: `1,000`
- Recipient `totalClaimableOf` delta: `+1,000`
- Payer nonce: `3` (`createSplit` -> `approve` -> `pay`)
- Remaining allowance: `9,999,999,000` atomic USDC
- Full article returned only after the SDK validated the successful payment receipt and matching `Routed` event
