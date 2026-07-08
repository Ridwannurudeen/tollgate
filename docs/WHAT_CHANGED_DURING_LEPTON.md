# What Changed During Lepton

This project evolved from a citation-payment wedge into a shared creator nanopayment settlement core.

## Built During The Sprint

- Citations app: x402 paid answers, source purchase receipts, creator proof pages, and Forum accountability surfaces.
- Aperture app: Immich sidecar that maps shared-photo downloads to photographer payouts.
- PeerTube plugin: permissionless plugin that gates video downloads and exposes config/proof endpoints for per-download USDC routing on Arc, installable from the npm plugin index; download gating and the `/proof` router shape are validated locally (see `peertube-plugin-tollgate/demo/VALIDATION.md`). The listed Arc tx proves the shared FeeRouter rail through plugin settlement code, not a public PeerTube-instance receipt.
- Unified Tollgate positioning: three integrations on real open-source communities (feeds, photo, video), one settlement core.
- Public proof surfaces for receipts, answer evidence, source pages, creator pages, Aperture license receipts, and the PeerTube plugin `/proof` receipt chain.

## Audit-Driven Hardening

- Unit economics moved to a non-negative reader-price model.
- Proof pages now surface reader paid, creator payouts, retained amount, and utilization.
- Remaining hardening scope tracks content hashes, ownership verification, ledger write serialization, FeeRouter split reuse, and real Aperture x402 download gating.

## User-Only Finalization

- Refresh live traction values.
- Run credentialed `x402-settled` proof paths on the VPS.
- Record the demo video.
- Submit only after explicit approval.
