import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./admin.css";

export const metadata: Metadata = {
  title: "Operations · SEOньорита",
  description: "Внутренняя административная панель платформы",
  robots: {
    index: false,
    follow: false,
    nocache: true
  }
};

export default function AdminLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  return <div className="admin-root">{children}</div>;
}
