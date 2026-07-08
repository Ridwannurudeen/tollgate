import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tollgate — pay creators per citation",
  description:
    "Tollgate is a paid knowledge network for AI agents. An autonomous agent pays creators per cited source in USDC on Arc and writes on-chain attribution receipts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="footer-brand">
              <p className="footer-wordmark">Tollgate</p>
              <p className="footer-tagline">
                A paid knowledge network for AI agents. Creators are paid per
                cited source in USDC on Arc, with on-chain attribution receipts.
              </p>
            </div>
            <nav className="footer-cols" aria-label="Footer">
              <div className="footer-col">
                <p className="footer-head">Product</p>
                <a href="/">Landing</a>
                <a href="/register">Register</a>
                <a href="/wordpress/register">WordPress publishers</a>
                <a href="/sources">Sources</a>
                <a href="/ask">Ask the AI</a>
                <a href="/creators">Creators</a>
                <a href="/core">Settlement core</a>
                <a href="/aperture">Photo licensing</a>
                <a href="/immich">Immich proof</a>
                <a href="/video">Video licensing</a>
                <a href="/jellyfin">Jellyfin proof</a>
              </div>
              <div className="footer-col">
                <p className="footer-head">Proof</p>
                <a href="/proof">Payout ledger</a>
                <a href="/ask">Live demo</a>
                <a href="/demo">Judge demo</a>
              </div>
              <div className="footer-col">
                <p className="footer-head">Network</p>
                <a
                  href="https://testnet.arcscan.app"
                  target="_blank"
                  rel="noreferrer"
                >
                  Arc testnet explorer
                </a>
                <span className="footer-meta">chainId 5042002</span>
                <span className="footer-meta">USDC · 6 decimals</span>
              </div>
            </nav>
          </div>
          <div className="site-footer-bar">
            <div className="site-footer-bar-inner">
              <span>Settled on Arc · x402 + Circle Gateway</span>
              <span className="footer-mono">FeeRouter 0xeff9bc35…98eabf59</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
