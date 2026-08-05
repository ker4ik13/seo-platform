import type { ReactNode } from "react";
import type { ProtectedAppContext } from "../lib/app-types";
import { projectPagesReturnTo } from "../lib/project-pages";
import { AccountMenu } from "./account-menu";
import { Icon, type IconName } from "./icon";
import { NotificationBell } from "./notification-bell";
import { TenantSwitcher } from "./tenant-switcher";
import { DropdownCoordinator } from "./dropdown-coordinator";

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
    label: "Инструменты",
    icon: "tools",
    href: "/app/tools",
    section: "tools",
    available: true
  },
  {
    label: "Операции",
    icon: "tasks",
    href: "/app/tasks",
    section: "tasks",
    available: true
  },
  {
    label: "Карта страниц",
    icon: "pages",
    href: "/app/pages",
    section: "pages",
    available: false,
    projectScoped: true
  },
  {
    label: "Конкуренты",
    icon: "competitors",
    href: "/app/competitors",
    section: "competitors",
    available: false
  },
  {
    label: "Заметки",
    icon: "note",
    href: "/app/notes",
    section: "notes",
    available: false
  }
];

const mobileNavigationSections = new Set([
  "overview",
  "tools",
  "semantics",
  "tasks"
]);

export function AppShell({
  children,
  context,
  activeSection = "overview"
}: Readonly<{
  children: ReactNode;
  context: ProtectedAppContext;
  activeSection?: string;
}>) {
  const hasProject = Boolean(context.project);
  const hasWorkspace = Boolean(context.workspace);
  const usesWorkspaceLayout = ["semantics", "tasks"].includes(activeSection);
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
      ? projectPagesReturnTo(context.project.id)
      : item.href;
  return (
    <div className="app-shell">
      <DropdownCoordinator />
      <aside className="sidebar">
        <a className="app-brand" href="/app" aria-label="SEOньорита">
          <img
            alt=""
            aria-hidden="true"
            className="brand-mark"
            height={29}
            src="/brand/seonorita-mark.svg"
            width={29}
          />
          <span>SEOньорита</span>
        </a>

        <TenantSwitcher
          currentUserId={context.user.id}
          project={context.project}
          projects={context.projects}
          workspace={context.workspace}
          workspaces={context.workspaces}
        />

        <nav aria-label="Навигация проекта">
          {navigation.map((item) =>
            isNavigationAvailable(item) ? (
              <a
                aria-current={
                  item.section === activeSection ? "page" : undefined
                }
                className={
                  item.section === activeSection
                    ? "nav-item active"
                    : "nav-item"
                }
                href={navigationHref(item)}
                key={item.label}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </a>
            ) : (
              <span
                aria-disabled="true"
                className="nav-item disabled"
                key={item.label}
                title={
                  !item.available
                    ? "Раздел временно недоступен"
                    : hasProject
                      ? "Раздел появится в следующем функциональном срезе"
                      : "Сначала создайте проект"
                }
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </span>
            )
          )}
        </nav>

        <div className="sidebar-spacer" />
        <a
          aria-current={activeSection === "settings" ? "page" : undefined}
          className={
            activeSection === "settings" ? "nav-item active" : "nav-item"
          }
          href="/app/settings/workspace"
        >
          <Icon name="settings" />
          <span>Настройки</span>
        </a>
        <div className="workspace-usage">
          <a href="/app/settings/billing">
            <strong>Тариф и баланс</strong>
          </a>
          <small>Тариф, платежи, чеки и расходы workspace</small>
        </div>
      </aside>

      <div
        className={
          usesWorkspaceLayout
            ? `main-column workspace-main-column section-${activeSection}`
            : `main-column section-${activeSection}`
        }
      >
        <header className="topbar">
          <div className="app-mobile-brand">
            <img
              alt=""
              aria-hidden="true"
              className="brand-mark"
              height={27}
              src="/brand/seonorita-mark.svg"
              width={27}
            />
            <strong>SEOньорита</strong>
          </div>
          <label className="global-search">
            <Icon name="search" />
            <input
              aria-label="Глобальный поиск"
              disabled
              placeholder="Поиск будет доступен после индексации данных"
              type="search"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar-actions">
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
              ? `content content-workspace content-${activeSection}`
              : `content content-${activeSection}`
          }
        >
          {children}
        </main>

        <nav className="mobile-nav" aria-label="Мобильная навигация">
          {navigation
            .filter((item) => mobileNavigationSections.has(item.section))
            .map((item) =>
              isNavigationAvailable(item) ? (
                <a
                  aria-current={
                    item.section === activeSection ? "page" : undefined
                  }
                  className={
                    item.section === activeSection ? "active" : undefined
                  }
                  href={navigationHref(item)}
                  key={item.label}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </a>
              ) : (
                <span aria-disabled="true" key={item.label}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </span>
              )
            )}
        </nav>
      </div>
    </div>
  );
}
