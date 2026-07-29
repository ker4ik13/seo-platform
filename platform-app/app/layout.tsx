import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "SEO Workspace",
    template: "%s · SEO Workspace"
  },
  description: "Рабочее пространство для SEO-команд"
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f6f7f9"
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
