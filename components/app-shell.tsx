import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

const navigation: readonly {
  label: string;
  icon: IconName;
  href: string;
  section: string;
}[] = [
  { label: "Обзор", icon: "dashboard", href: "/app", section: "overview" },
  { label: "Инструменты", icon: "tasks", href: "/app/tools", section: "tools" },
  { label: "Семантика", icon: "semantic", href: "#", section: "semantics" },
  { label: "Позиции", icon: "positions", href: "#", section: "positions" },
  { label: "Карта страниц", icon: "pages", href: "#", section: "pages" },
  { label: "Конкуренты", icon: "competitors", href: "#", section: "competitors" },
  { label: "Заметки", icon: "note", href: "#", section: "notes" }
];

export function AppShell({
  children,
  activeSection = "overview"
}: Readonly<{ children: ReactNode; activeSection?: string }>) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/app" aria-label="SEO Workspace">
          <span className="brand-mark">S</span>
          <span>SEO Workspace</span>
        </a>

        <button className="project-switcher" type="button">
          <span className="project-logo">PS</span>
          <span>
            <strong>Promsoyuz</strong>
            <small>Основной проект</small>
          </span>
          <span className="chevron">⌄</span>
        </button>

        <nav aria-label="Навигация проекта">
          {navigation.map((item) => (
            <a
              aria-current={item.section === activeSection ? "page" : undefined}
              className={item.section === activeSection ? "nav-item active" : "nav-item"}
              href={item.href}
              key={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <a className="nav-item" href="#">
          <Icon name="settings" />
          <span>Настройки</span>
        </a>
        <div className="workspace-usage">
          <span><strong>14 820</strong> / 25 000 лимитов</span>
          <span className="usage-track"><i /></span>
          <small>Обновятся через 12 дней</small>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">S</span>
            <strong>Workspace</strong>
          </div>
          <label className="global-search">
            <Icon name="search" />
            <input
              aria-label="Глобальный поиск"
              placeholder="Найти запрос, страницу или задачу"
              type="search"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Уведомления" type="button">
              <Icon name="bell" />
              <span className="notification-dot" />
            </button>
            <button className="avatar-button" type="button">
              <span>КК</span>
              <span className="avatar-copy">
                <strong>Кирилл</strong>
                <small>Владелец</small>
              </span>
            </button>
          </div>
        </header>

        <main className="content">{children}</main>

        <nav className="mobile-nav" aria-label="Мобильная навигация">
          {navigation.slice(0, 4).map((item) => (
            <a
              aria-current={item.section === activeSection ? "page" : undefined}
              className={item.section === activeSection ? "active" : undefined}
              href={item.href}
              key={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
