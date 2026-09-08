import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { AppShell } from "../../../components/app-shell";
import { UiLocaleProvider } from "../../../components/ui-locale";
import { appProjectIdFromPath } from "../../../lib/app-navigation";
import {
  requireProtectedAppContext,
  requireProtectedProjectAppContext
} from "../../../lib/protected-app";
import {
  sidebarCollapsedCookieName,
  sidebarCollapsedFromCookie
} from "../../../lib/sidebar-preference";

export default async function ProtectedAppLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  const requestHeaders = await headers();
  const explicitProjectId = appProjectIdFromPath(
    requestHeaders.get("x-app-path")
  );
  const [context, cookieStore] = await Promise.all([
    explicitProjectId
      ? requireProtectedProjectAppContext(explicitProjectId)
      : requireProtectedAppContext(),
    cookies()
  ]);
  const initiallyCollapsed = sidebarCollapsedFromCookie(
    cookieStore.get(sidebarCollapsedCookieName)?.value
  );
  return (
    <UiLocaleProvider initialLocale={context.user.locale} authenticated><AppShell context={context} initiallyCollapsed={initiallyCollapsed}>
      {children}
    </AppShell></UiLocaleProvider>
  );
}
