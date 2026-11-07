import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "../lib/site.ts";
// Wallet selector modal styling (loaded with the app shell; the modal itself
// is a client-only dynamic import and only opens on user action).
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: siteMetadata.title,
  description: siteMetadata.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
