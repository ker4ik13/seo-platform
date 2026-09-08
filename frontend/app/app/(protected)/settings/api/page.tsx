import type { Metadata } from "next";
import { ApiTokenSettings } from "../../../../../components/api-token-settings";
import styles from "../../../../../components/api-token-settings.module.css";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";
import { UiText } from "../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API-ключи"
};

export default async function ApiSettingsPage() {
  const context = await requireProtectedAppContext();
  return (
    <>
      <section className={`page-heading ${styles.pageHeading}`}>
        <div>
          <h1><UiText text="API-ключи" /></h1>
          <p>
            <UiText text="Подключайте ИИ-агентов и внешние сервисы с отдельными правами и доступом только к выбранным проектам." /></p>
        </div>
      </section>
      <SettingsTabs
        active="api"
        {...(context.project
          ? {
              projectId: context.project.id,
              projectAccessLevel: context.project.projectAccessLevel
            }
          : {})}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      {context.workspace ? (
        <ApiTokenSettings
          projects={context.projects}
          workspaceId={context.workspace.id}
        />
      ) : (
        <section className="panel">
          <UiText text="Сначала создайте или выберите рабочую область." /></section>
      )}
    </>
  );
}
