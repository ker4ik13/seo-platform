import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { UiLocaleProvider, LanguageSwitcher } from "../../components/ui-locale";
import { uiLocaleCookie } from "../../lib/ui-i18n";
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

export default async function AdminLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  const store = await cookies();
  return <UiLocaleProvider initialLocale={store.get(uiLocaleCookie)?.value ?? "ru"}><div className="admin-root"><div className="admin-language-switcher"><LanguageSwitcher /></div>{children}</div></UiLocaleProvider>;
}
