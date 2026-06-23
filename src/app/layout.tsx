import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeptonWeb",
  description:
    "A paid knowledge network for AI agents. Tollgate pays creators per cited source and writes attribution receipts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
