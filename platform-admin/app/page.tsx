import { getPlatformHealth } from "../lib/health";

export const dynamic = "force-dynamic";

const navigation = [
  "Обзор",
  "Аккаунты",
  "Рабочие области",
  "Проекты",
  "Задачи и очереди",
  "Интеграции",
  "Тарификация",
  "Аудит",
  "Feature flags"
] as const;

const recentOperations = [
  ["rankings.collect", "workspace_4b2…", "12 640 элементов", "Выполняется"],
  ["frequency.collect", "workspace_83e…", "4 280 элементов", "Повтор через 2 мин"],
  ["semantic.import", "workspace_17c…", "86 400 строк", "Завершено"]
] as const;

export default async function OperationsPage() {
  const health = await getPlatformHealth();
  const stateLabel = health.available
    ? health.status === "ok" ? "Все системы работают" : "Есть деградация"
    : "Platform API недоступен";

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span>SW</span>
          <div><strong>SEO Workspace</strong><small>Operations</small></div>
        </a>
        <nav aria-label="Разделы администрирования">
          {navigation.map((item, index) => (
            <a className={index === 0 ? "active" : undefined} href="#" key={item}>
              <i>{String(index + 1).padStart(2, "0")}</i>{item}
            </a>
          ))}
        </nav>
        <div className="operator">
          <span>КК</span>
          <div><strong>Кирилл</strong><small>Super admin</small></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div><span className="mobile-mark">SW</span><strong>Operations</strong></div>
          <div className={`system-state ${health.status}`}>
            <i />
            {stateLabel}
          </div>
        </header>

        <div className="content">
          <section className="heading">
            <div>
              <p>Внутренняя панель</p>
              <h1>Состояние платформы</h1>
            </div>
            <time>Обновлено при открытии страницы</time>
          </section>

          {!health.available && (
            <aside className="warning" role="alert">
              <strong>Нет связи с Platform API.</strong>
              <span>Операции изменения данных заблокированы; значения ниже демонстрационные.</span>
            </aside>
          )}

          <section className="metric-grid">
            <article><span>Активные workspace</span><strong>1 284</strong><small>+42 за 30 дней</small></article>
            <article><span>Задачи за 24 часа</span><strong>486 209</strong><small>99,42% успешно</small></article>
            <article><span>Очередь сейчас</span><strong>12 842</strong><small>p95 ожидания 1,8 мин</small></article>
            <article><span>Выручка MRR</span><strong>₽4,82 млн</strong><small>Gross margin 61%</small></article>
          </section>

          <section className="grid">
            <article className="panel services">
              <header><div><h2>Сервисы</h2><p>Readiness обязательных зависимостей</p></div><button type="button">Обновить</button></header>
              <div className="service-list">
                {(health.dependencies.length > 0
                  ? health.dependencies
                  : [
                      { name: "platform-api", status: "unavailable" as const },
                      { name: "seo-data", status: "unavailable" as const },
                      { name: "jobs-integrations", status: "unavailable" as const },
                      { name: "realtime", status: "unavailable" as const }
                    ]
                ).map((service) => (
                  <div className="service-row" key={service.name}>
                    <span className={`health-dot ${service.status}`} />
                    <strong>{service.name}</strong>
                    <span>{service.status}</span>
                    <small>{service.latencyMs === undefined ? "—" : `${service.latencyMs} ms`}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel queue">
              <header><div><h2>Очереди</h2><p>Распределение незавершённой работы</p></div></header>
              <div className="queue-total"><strong>12 842</strong><span>задачи ожидают обработки</span></div>
              <div className="bar"><i className="first" /><i className="second" /><i className="third" /></div>
              <ul>
                <li><i className="violet" /><span>Rankings</span><strong>7 690</strong></li>
                <li><i className="blue" /><span>Frequency</span><strong>3 842</strong></li>
                <li><i className="amber" /><span>Imports</span><strong>1 310</strong></li>
              </ul>
            </article>
          </section>

          <section className="panel operations">
            <header><div><h2>Последние операции</h2><p>Технический обзор без раскрытия пользовательских данных</p></div><a href="#">Открыть очередь →</a></header>
            <div className="table-wrap">
              <div className="table">
                {recentOperations.map(([type, workspace, scope, status]) => (
                  <div className="row" key={type}>
                    <code>{type}</code><span>{workspace}</span><span>{scope}</span><strong>{status}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
