import type { ReactNode } from "react";
import type { ProtectedAppContext } from "../lib/app-types";
import { rankHistoryReturnTo } from "../lib/rank-history";
import { AccountMenu } from "./account-menu";
import { Icon, type IconName } from "./icon";
import { NotificationBell } from "./notification-bell";
import { TenantSwitcher } from "./tenant-switcher";

const navigation: readonly {
  readonly label: string;
  readonly icon: IconName;
  readonly href: string;
  readonly section: string;
  readonly available: boolean;
  readonly projectScoped?: boolean;
}[] = [
  {
    label: "Обзор",
    icon: "dashboard",
    href: "/app",
    section: "overview",
    available: true
  },
  {
    label: "Инструменты",
    icon: "tasks",
    href: "/app/tools",
    section: "tools",
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
    section: "positions",
    available: true,
    projectScoped: true
  },
  {
    label: "Карта страниц",
    icon: "pages",
    href: "/app/pages",
    section: "pages",
    available: false
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
  const navigationHref = (
    item: (typeof navigation)[number]
  ): string =>
    item.projectScoped && context.project
      ? rankHistoryReturnTo(context.project.id)
      : item.href;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="app-brand" href="/app" aria-label="SEO Workspace">
          <span className="brand-mark">S</span>
          <span>SEO Workspace</span>
        </a>

        <TenantSwitcher
          project={context.project}
          projects={context.projects}
          workspace={context.workspace}
          workspaces={context.workspaces}
        />

        <nav aria-label="Навигация проекта">
          {navigation.map((item) =>
            item.available && (item.section === "overview" || hasProject) ? (
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
                  hasProject
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

      <div className="main-column">
        <header className="topbar">
          <div className="app-mobile-brand">
            <span className="brand-mark">S</span>
            <strong>Workspace</strong>
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
            <NotificationBell />
            <AccountMenu
              roleCode={context.workspace?.roleCode}
              user={context.user}
            />
          </div>
        </header>

        <main className="content">{children}</main>

        <nav className="mobile-nav" aria-label="Мобильная навигация">
          {navigation.slice(0, 4).map((item) =>
            item.available && (item.section === "overview" || hasProject) ? (
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
