import type { Metadata } from "next";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { WorkspaceSettings } from "../../../../../components/workspace-settings";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";
import { UiText } from "../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Настройки рабочей области"
};

export default async function WorkspaceSettingsPage() {
  const context = await requireProtectedAppContext();

  return (
    <>
      <section className="page-heading">
        <div>
          <h1><UiText text="Рабочая область" /></h1>
          <p>
            <UiText text="Управляйте названием, языком и часовым поясом текущей рабочей области." /></p>
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
          <strong><UiText text="Рабочая область ещё не создана" /></strong>
          <p><UiText text="Создайте её на обзорной странице, затем вернитесь к настройкам." /></p>
          <a className="primary-button" href="/app">
            <UiText text="Перейти к созданию" /></a>
        </section>
      )}
    </>
  );
}
