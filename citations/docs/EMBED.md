# Tollgate Embed Kit

Creators can add the Tollgate answer box to any page with one script tag. The widget keeps the creator wallet in the URL, opens Tollgate inside an iframe, and sends questions to the creator-scoped query path.

```html
<div style="max-width:420px">
  <script async src="https://tollgate.gudman.xyz/widget.js?creator=0xCREATOR_WALLET"></script>
</div>
```

## Verification

- Cross-origin fixture: `docs/embed/widget-prod-fixture.html`
- Screenshot: `docs/embed/widget-prod-fixture.png`
- Widget script: `https://tollgate.gudman.xyz/widget.js?creator=0x53896882...`
- Embed page: `https://tollgate.gudman.xyz/embed?creator=0x53896882...`
- Verified `/embed` response has no `X-Frame-Options` header, so the iframe is not blocked.

The creator dashboard also renders an exact wallet-specific copy-paste snippet on `/creators/[wallet]`.
