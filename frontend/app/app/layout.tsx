import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "Рабочее пространство",
    template: "%s · SEOньорита"
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noarchive: true
    }
  }
};

export default function ProductLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  return children;
}
