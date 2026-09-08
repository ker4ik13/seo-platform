import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { UiLocaleProvider, AuthLanguageSwitcher } from "../../components/ui-locale";
import { uiLocaleCookie } from "../../lib/ui-i18n";
import "./styles.css";
import "./settings.css";

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

export default async function ProductLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  const store = await cookies();
  const requestHeaders = await headers();
  return <UiLocaleProvider initialLocale={requestHeaders.get("x-ui-locale") ?? store.get(uiLocaleCookie)?.value ?? "ru"} authenticated={false}><AuthLanguageSwitcher />{children}</UiLocaleProvider>;
}
