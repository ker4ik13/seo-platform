import type { Metadata } from "next";
import type { ReactNode } from "react";
import { UiLocaleProvider } from "../../components/ui-locale";
import "./admin.css";

export const metadata: Metadata = {
  title: "Администрирование · SEOньорита",
  description: "Внутренняя административная панель платформы",
  robots: {
    index: false,
    follow: false,
    nocache: true
  }
};

export default async function AdminLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  return <UiLocaleProvider initialLocale="ru" persistLocale={false}><div className="admin-root" data-dropdown-portal-root>{children}</div></UiLocaleProvider>;
}
