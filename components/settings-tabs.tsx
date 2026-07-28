export function SettingsTabs({
  active,
  projectId
}: Readonly<{
  active: "security" | "notifications" | "project-notifications";
  projectId?: string;
}>) {
  return (
    <nav className="settings-tabs" aria-label="Разделы настроек">
      <a
        aria-current={active === "security" ? "page" : undefined}
        className={active === "security" ? "active" : undefined}
        href="/app/settings/security"
      >
        Безопасность
      </a>
      <a
        aria-current={active === "notifications" ? "page" : undefined}
        className={active === "notifications" ? "active" : undefined}
        href="/app/settings/notifications"
      >
        Уведомления
      </a>
      {projectId && (
        <a
          aria-current={
            active === "project-notifications" ? "page" : undefined
          }
          className={
            active === "project-notifications" ? "active" : undefined
          }
          href={`/app/projects/${encodeURIComponent(projectId)}/settings/notifications`}
        >
          Текущий проект
        </a>
      )}
    </nav>
  );
}
