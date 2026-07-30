import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isLocale } from "../../lib/locales";

interface LocaleLayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params
}: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <div lang={locale}>{children}</div>;
}
