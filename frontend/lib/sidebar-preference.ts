export const sidebarCollapsedCookieName = "seo_sidebar_collapsed";
export const sidebarCollapsedStorageKey = "seo-sidebar-collapsed";

export function sidebarCollapsedFromCookie(value: string | undefined): boolean {
  return value === "1";
}
