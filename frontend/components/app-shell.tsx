"use client";
import { OperationConfirmationHost } from "./operation-confirmation-host";

import { WorkspaceUsageProvider } from "./workspace-usage-provider";
import { SidebarUsage } from "./sidebar-usage";
import { canViewWorkspaceBilling } from "../lib/app-permissions";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { ProtectedAppContext } from "../lib/app-types";
import { appNavigationSection } from "../lib/app-navigation";
import { projectPagesReturnTo } from "../lib/project-pages";
import { AccountMenu } from "./account-menu";
import { GlobalSearch } from "./global-search";
import { Icon, type IconName } from "./icon";
import { NotificationBell } from "./notification-bell";
import { TenantSwitcher } from "./tenant-switcher";
import { DropdownCoordinator } from "./dropdown-coordinator";
import { SidebarCollapseButton } from "./sidebar-collapse-button";
import { ProjectOperationActivityProvider } from "./project-operation-activity-provider";
import { ProjectPresenceAvatars } from "./project-presence-avatars";
import { ProjectPresenceOverlay } from "./project-presence-overlay";
import { ProjectPresenceProvider } from "./project-presence-provider";
import { useUiLocale, UiText } from "./ui-locale";


const navigation: readonly {
  readonly label: string;
  readonly icon: IconName;
  readonly href: string;
  readonly section: string;
  readonly available: boolean;
  readonly projectScoped?: boolean;
  readonly workspaceScoped?: boolean;
}[] = [
  {
    label: "Обзор",
    icon: "dashboard",
    href: "/app",
    section: "overview",
    available: true
  },
  {
    label: "Семантика",
    icon: "semantic",
    href: "/app/semantics",
    section: "semantics",
    available: true
  },
  {
    label: "Позиции",
    icon: "positions",
    href: "/app/rankings",
    section: "rankings",
    available: true
  },
  {
    label: "Поисковая выдача",
    icon: "search",
    href: "/app/tools",
    section: "serp",
    projectScoped: true,
    available: true
  },
  {
    label: "Карта страниц",
    icon: "pages",
    href: "/app/pages",
    section: "pages",
    available: true,
    projectScoped: true
  },
  {
    label: "Операции",
    icon: "tasks",
    href: "/app/tasks",
    section: "tasks",
    available: true
  },
  {
    label: "Заметки",
    icon: "note",
    href: "/app/notes",
    section: "notes",
    available: true,
    projectScoped: true
  }
];

const mobileNavigationSections = new Set([
  "overview",
  "serp",
  "pages",
  "semantics",
  "rankings",
  "tasks"
]);

import { ProductAnalyticsTracker } from "./product-analytics-tracker";

export function AppShell({
  children,
  context,
  initiallyCollapsed
}: Readonly<{
  children: ReactNode;
  context: ProtectedAppContext;
  initiallyCollapsed: boolean;
}>) {
  const { t: uiText } = useUiLocale();
  const pathname = usePathname();
  const activeSection = appNavigationSection(pathname);
  const navigationSection = activeSection === "crawl" ? "pages" : activeSection;
  const isSerpWorkbench = /^\/app\/projects\/[0-9a-f-]+\/tools\/serp\/?$/u.test(pathname ?? "");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initiallyCollapsed);
  const hasProject = Boolean(context.project);
  const hasWorkspace = Boolean(context.workspace);
  const usesWorkspaceLayout = ["notes", "pages", "semantics", "rankings", "tasks", "serp"].includes(
    activeSection
  );
  const isNavigationAvailable = (
    item: (typeof navigation)[number]
  ): boolean =>
    item.available &&
    (item.section === "overview" ||
      (item.workspaceScoped ? hasWorkspace : hasProject));
  const navigationHref = (
    item: (typeof navigation)[number]
  ): string =>
    item.projectScoped && context.project
      ? item.section === "pages"
        ? projectPagesReturnTo(context.project.id)
        : `/app/projects/${encodeURIComponent(context.project.id)}/${item.section === "serp" ? "tools/serp" : item.section === "crawl" ? "tools/http-status-checker" : item.section}`
      : item.href;
  return (
    <WorkspaceUsageProvider workspace={context.workspace}>
    <ProductAnalyticsTracker userId={context.user.id} {...(context.workspace?{workspaceId:context.workspace.id}:{})} {...(context.project?{projectId:context.project.id}:{})} />
    <OperationConfirmationHost workspaceId={context.workspace?.id} locale={context.user.locale} />
    <ProjectOperationActivityProvider
      projects={context.projects}
      {...(context.workspace ? { workspaceId: context.workspace.id } : {})}
    >
    <ProjectPresenceProvider
      {...(context.project ? { projectId: context.project.id } : {})}
      user={context.user}
    >
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <DropdownCoordinator />
      <aside
        className="sidebar"
        data-presence-cursor-anchor="true"
        data-presence-key="app-sidebar"
      >
        <div className="sidebar-heading">
          <Link className="app-brand" href="/app" aria-label={uiText("SEOньорита")}>
            <img
              alt=""
              aria-hidden="true"
              className="brand-mark"
              height={29}
              src="/brand/seonorita-mark.svg"
              width={29}
            />
            <span><UiText text="SEOньорита" /></span>
          </Link>
          <SidebarCollapseButton
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
          />
        </div>

        <TenantSwitcher
          currentUserId={context.user.id}
          project={context.project}
          projectCapabilities={context.projectCapabilities}
          projects={context.projects}
          workspace={context.workspace}
          workspaces={context.workspaces}
        />

        <nav aria-label={uiText("Навигация проекта")}>
          {navigation.map((item) =>
            isNavigationAvailable(item) ? (
              <Link
                aria-current={
                  item.section === navigationSection ? "page" : undefined
                }
                className={
                  item.section === navigationSection
                    ? "nav-item active"
                    : "nav-item"
                }
                data-presence-key={`nav:${item.section}`}
                data-presence-cursor-anchor="true"
                href={navigationHref(item)}
                key={item.label}
                title={uiText(item.label)}
              >
                <Icon name={item.icon} />
                <span><UiText text={item.label} /></span>
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="nav-item disabled"
                key={item.label}
                title={!item.available ? uiText("Раздел временно недоступен") : hasProject ? uiText("Раздел появится в следующем функциональном срезе") : uiText("Сначала создайте проект")}
              >
                <Icon name={item.icon} />
                <span><UiText text={item.label} /></span>
              </span>
            )
          )}
        </nav>

        <div className="sidebar-spacer" />
        <Link
          aria-current={activeSection === "settings" ? "page" : undefined}
          className={
            activeSection === "settings" ? "nav-item active" : "nav-item"
          }
          data-presence-key="nav:settings"
          data-presence-cursor-anchor="true"
          href="/app/settings/workspace"
          title={uiText("Настройки")}
        >
          <Icon name="settings" />
          <span><UiText text="Настройки" /></span>
        </Link>
        <SidebarUsage canView={canViewWorkspaceBilling(context.workspace?.roleCode)} locale={context.user.locale} />
      </aside>

      <div
        className={
          usesWorkspaceLayout
            ? `main-column workspace-main-column section-${activeSection}${isSerpWorkbench ? " route-serp-workbench" : ""}`
            : `main-column section-${activeSection}${isSerpWorkbench ? " route-serp-workbench" : ""}`
        }
      >
        <header
          className="topbar"
          data-presence-cursor-anchor="true"
          data-presence-key="app-topbar"
        >
          <div className="app-mobile-brand">
            <img
              alt=""
              aria-hidden="true"
              className="brand-mark"
              height={27}
              src="/brand/seonorita-mark.svg"
              width={27}
            />
            <strong><UiText text="SEOньорита" /></strong>
          </div>
          <GlobalSearch context={context} />
          <div className="topbar-actions">
            <ProjectPresenceAvatars />
            <NotificationBell {...(context.project ? { projectId: context.project.id } : {})} />
            <AccountMenu
              roleCode={context.workspace?.roleCode}
              user={context.user}
            />
          </div>
        </header>

        <main
          className={
            usesWorkspaceLayout
              ? `content content-workspace content-${activeSection}${isSerpWorkbench ? " content-serp-workbench" : ""}`
              : `content content-${activeSection}${isSerpWorkbench ? " content-serp-workbench" : ""}`
          }
          data-presence-key={`screen:${activeSection}`}
          data-presence-cursor-anchor="true"
        >
          {children}
        </main>

        <nav className="mobile-nav" aria-label={uiText("Мобильная навигация")}>
          {navigation
            .filter((item) => mobileNavigationSections.has(item.section))
            .map((item) =>
              isNavigationAvailable(item) ? (
                <Link
                  aria-current={
                    item.section === navigationSection ? "page" : undefined
                  }
                  className={
                    item.section === navigationSection ? "active" : undefined
                  }
                  href={navigationHref(item)}
                  key={item.label}
                >
                  <Icon name={item.icon} />
                  <span><UiText text={item.label} /></span>
                </Link>
              ) : (
                <span aria-disabled="true" key={item.label}>
                  <Icon name={item.icon} />
                  <span><UiText text={item.label} /></span>
                </span>
              )
            )}
        </nav>
        <ProjectPresenceOverlay />
      </div>
    </div>
    </ProjectPresenceProvider>
    </ProjectOperationActivityProvider>
    </WorkspaceUsageProvider>
  );
}
