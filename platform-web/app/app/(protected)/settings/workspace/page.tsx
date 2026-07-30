import type { Metadata } from "next";
import { AppShell } from "../../../../../components/app-shell";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { WorkspaceSettings } from "../../../../../components/workspace-settings";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Настройки рабочей области"
};

export default async function WorkspaceSettingsPage() {
  const context = await requireProtectedAppContext();

  return (
    <AppShell activeSection="settings" context={context}>
      <nav aria-label="Хлебные крошки" className="app-breadcrumbs">
        <a href="/app">Обзор</a>
        <span aria-hidden="true">/</span>
        <span>Настройки</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Рабочая область</span>
      </nav>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Workspace · Основные настройки</p>
          <h1>Рабочая область</h1>
          <p>
            Управляйте названием, локалью и часовым поясом текущей рабочей
            области.
          </p>
        </div>
      </section>
      <SettingsTabs
        active="workspace"
        {...(context.project?.projectAccessLevel
          ? { projectAccessLevel: context.project.projectAccessLevel }
          : {})}
        {...(context.project ? { projectId: context.project.id } : {})}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      {context.workspace ? (
        <WorkspaceSettings workspace={context.workspace} />
      ) : (
        <section className="panel panel-empty compact">
          <strong>Рабочая область ещё не создана</strong>
          <p>Создайте её на обзорной странице, затем вернитесь к настройкам.</p>
          <a className="primary-button" href="/app">
            Перейти к созданию
          </a>
        </section>
      )}
    </AppShell>
  );
}
