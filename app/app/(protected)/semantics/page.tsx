import { AppShell } from "../../../../components/app-shell";
import { SemanticUpload } from "../../../../components/semantic-upload";
import { ProjectOnboarding } from "../../../../components/tenant-onboarding";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function SemanticsPage() {
  const context = await requireProtectedAppContext();
  return (
    <AppShell activeSection="semantics" context={context}>
      {!context.project || !context.workspace ? (
        context.workspace ? (
          <ProjectOnboarding workspace={context.workspace} />
        ) : (
          <section className="panel panel-empty">
            <strong>Сначала создайте рабочую область</strong>
          </section>
        )
      ) : (
        <>
          <section className="page-heading">
            <div>
              <p className="eyebrow">Проект · {context.project.name}</p>
              <h1>Семантическое ядро</h1>
              <p>
                Импортируйте исходные данные, проверьте сопоставление колонок и
                только затем публикуйте новую версию ядра.
              </p>
            </div>
          </section>
          <div className="settings-stack semantic-stack">
            <SemanticUpload projectId={context.project.id} />
            <section className="panel panel-empty compact">
              <strong>Опубликованных запросов пока нет</strong>
              <p>
                После проверки файла здесь появятся preview импорта, конфликты
                и управление колонками Key Collector.
              </p>
            </section>
          </div>
        </>
      )}
    </AppShell>
  );
}
