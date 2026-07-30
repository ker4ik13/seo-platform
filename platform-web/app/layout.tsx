import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  applicationName: "SEOньорита / SEOnorita",
  title: {
    default: "SEOньорита — единая платформа для системного SEO",
    template: "%s · SEOньорита"
  },
  description:
    "Будущая SEO-платформа для семантики, позиций, SERP, контента, аналитики, автоматизаций и командной работы.",
  category: "technology",
  creator: "@ker4ik13",
  publisher: "SEOньорита",
  formatDetection: {
    address: false,
    email: false,
    telephone: false
  }
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f5f1e8"
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
