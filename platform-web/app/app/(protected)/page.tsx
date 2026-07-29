import { AppShell } from "../../../components/app-shell";
import { Icon } from "../../../components/icon";
import {
  ProjectOnboarding,
  WorkspaceOnboarding
} from "../../../components/tenant-onboarding";
import { requireProtectedAppContext } from "../../../lib/protected-app";

export const dynamic = "force-dynamic";

const emptyMetrics = [
  { label: "Запросов", tone: "violet" },
  { label: "В топ-10", tone: "green" },
  { label: "Средняя позиция", tone: "blue" },
  { label: "Страниц без кластера", tone: "amber" }
] as const;

export default async function DashboardPage() {
  const context = await requireProtectedAppContext();

  return (
    <AppShell context={context}>
      {!context.workspace ? (
        <WorkspaceOnboarding />
      ) : !context.project ? (
        <ProjectOnboarding workspace={context.workspace} />
      ) : (
        <>
          <section className="page-heading">
            <div>
              <p className="eyebrow">
                Проект · {context.project.name}
              </p>
              <h1>Добрый день, {firstName(context.user.displayName)}</h1>
              <p>
                Дашборд начнёт заполняться после импорта и первого сбора
                данных.
              </p>
            </div>
            <button
              className="primary-button"
              disabled
              title="Запуск заданий появится вместе с очередью и оценкой стоимости"
              type="button"
            >
              <Icon name="plus" />
              Новая задача
            </button>
          </section>

          {context.workspace.status === "READ_ONLY" && (
            <aside className="status-banner" role="status">
              <span className="status-dot" />
              <div>
                <strong>Режим только для чтения</strong>
                <p>
                  История и результаты доступны; ограничены только новые
                  операции.
                </p>
              </div>
            </aside>
          )}
          {context.project.status === "ARCHIVED" && (
            <aside className="status-banner" role="status">
              <span className="status-dot" />
              <div>
                <strong>Проект в архиве</strong>
                <p>
                  Данные доступны для просмотра и экспорта, автоматизации
                  остановлены.
                </p>
              </div>
            </aside>
          )}

          <section className="metric-grid" aria-label="Ключевые показатели">
            {emptyMetrics.map((metric) => (
              <article
                className={`metric-card ${metric.tone}`}
                key={metric.label}
              >
                <div className="metric-head">
                  <span>{metric.label}</span>
                </div>
                <strong>—</strong>
                <small>Нет данных</small>
              </article>
            ))}
          </section>

          <section className="dashboard-grid">
            <article className="panel chart-panel">
              <header className="panel-header">
                <div>
                  <h2>Видимость и позиции</h2>
                  <p>Динамика поисковой видимости</p>
                </div>
              </header>
              <div className="panel-empty">
                <span className="state-icon">
                  <Icon name="trend" />
                </span>
                <strong>Пока нет замеров</strong>
                <p>
                  Добавьте семантику и настройте поисковый контекст, чтобы
                  снять первые позиции.
                </p>
              </div>
            </article>

            <article className="panel attention-panel">
              <header className="panel-header">
                <div>
                  <h2>Требует внимания</h2>
                  <p>Сигналы с высоким приоритетом</p>
                </div>
                <span className="count-badge">0</span>
              </header>
              <div className="panel-empty compact">
                <strong>Сигналов пока нет</strong>
                <p>Они появятся после сбора данных и запуска Radar.</p>
              </div>
            </article>
          </section>

          <section className="panel activity-panel">
            <header className="panel-header">
              <div>
                <h2>Фоновые задачи</h2>
                <p>Очередь сбора и обработки данных</p>
              </div>
            </header>
            <div className="panel-empty compact">
              <strong>Очередь пуста</strong>
              <p>
                Новые задания будут показывать этап, прогресс, стоимость и
                ссылку на результат.
              </p>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/u)[0] || displayName;
}
