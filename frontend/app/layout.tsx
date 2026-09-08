import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { webPublicOrigin } from "../lib/server-runtime-origin";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(webPublicOrigin()),
  title: "SEOньорита",
  description: "SEOньорита — единое рабочее пространство для SEO-команд",
  icons: {
    icon: [{ url: "/brand/seonorita-mark.svg", type: "image/svg+xml" }],
    shortcut: "/brand/seonorita-mark.svg",
    apple: "/brand/seonorita-mark.svg"
  }
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fafaf8"
};

export default async function RootLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  const locale = (await headers()).get("x-ui-locale") === "en" ? "en" : "ru";
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
