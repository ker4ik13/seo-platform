import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: "Operations · SEO Workspace",
  description: "Внутренняя административная панель платформы"
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#111318"
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
