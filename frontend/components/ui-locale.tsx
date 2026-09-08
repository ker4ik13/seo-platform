"use client";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ComponentPropsWithRef, type JSX, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { normalizedUiLocale, translateUi, uiLocaleCookie, type UiLocale, type UiMessage } from "../lib/ui-i18n";

interface LocaleState { locale: UiLocale; t: (text: string, values?: readonly string[]) => string; change: (locale: UiLocale) => Promise<void>; saving: boolean; error?: string | undefined }
const LocaleContext = createContext<LocaleState>({ locale: "ru", t: (text, values) => translateUi("ru", text, values), change: async () => {}, saving: false });
export function UiLocaleProvider({ initialLocale, authenticated, children }: { initialLocale: string; authenticated?: boolean; children: ReactNode }) {
  const [locale, setLocale] = useState<UiLocale>(() => normalizedUiLocale(initialLocale));
  const [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => { setLocale(normalizedUiLocale(initialLocale)); }, [initialLocale]);
  useEffect(() => {
    if (authenticated === false && !/^\/app\/(?:login|register|mfa|forgot-password|reset-password|verify-email|workspace-invites)(?:\/|$)/u.test(pathname)) return;
    document.documentElement.lang = locale; document.cookie = `${uiLocaleCookie}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
  }, [locale, authenticated, pathname]);
  const t = useCallback((text: string, values: readonly string[] = []) => translateUi(locale, text, values), [locale]);
  const change = useCallback(async (next: UiLocale) => {
    setLocale(next); setError(undefined); setSaving(true);
    document.cookie = `${uiLocaleCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    try {
      if (authenticated !== false) await browserApiRequest("/app/api/me/preferences", { method: "PATCH", body: { locale: next } });
      router.refresh();
    } catch (cause) {
      if (!(authenticated === undefined && cause instanceof BrowserApiError && cause.status === 401)) setError(next === "en" ? "Saved in this browser. Could not update the account preference." : "Сохранено в этом браузере. Не удалось обновить настройку аккаунта.");
    } finally { setSaving(false); }
  }, [authenticated, router]);
  const value = useMemo(() => ({ locale, t, change, saving, error }), [locale, t, change, saving, error]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export const useUiLocale = (): LocaleState => useContext(LocaleContext);
export function UiText({ text, values, before = "", after = "" }: UiMessage & { before?: string; after?: string }) { const { t } = useUiLocale(); return <>{before}{t(text, values)}{after}</>; }
export function LanguageSwitcher() {
  const { locale, change, saving, error } = useUiLocale();
  return <div className="ui-language-control"><label><span>{locale === "en" ? "Language" : "Язык"}</span><select aria-label={locale === "en" ? "Interface language" : "Язык интерфейса"} value={locale} disabled={saving} onChange={event => void change(event.target.value as UiLocale)}><option value="ru">Русский</option><option value="en">English</option></select></label>{error && <small role="status">{error}</small>}</div>;
}
export function AuthLanguageSwitcher() { const path = usePathname(); return /^\/app\/(?:login|register|mfa|forgot-password|reset-password|verify-email|workspace-invites)(?:\/|$)/u.test(path) ? <div className="auth-language-switcher"><LanguageSwitcher /></div> : null; }

/** Native controls with explicitly marked UI attributes; dynamic content is untouched. */
export function UiElement<Tag extends keyof JSX.IntrinsicElements>({ tag, uiLabels, ...props }: { tag: Tag; uiLabels: Readonly<Record<string, string | UiMessage>> } & ComponentPropsWithRef<Tag>) {
  const { t } = useUiLocale();
  const labels = Object.fromEntries(Object.entries(uiLabels).map(([key, value]) => [key, typeof value === "string" ? t(value) : t(value.text, value.values)]));
  return createElement(tag, { ...props, ...labels });
}
