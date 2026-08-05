import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
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

export default function RootLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
