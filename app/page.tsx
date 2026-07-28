import { AppShell } from "../components/app-shell";
import { Icon } from "../components/icon";
import { getPlatformApiState } from "../lib/platform-api";

export const dynamic = "force-dynamic";

const metrics = [
  { label: "Запросов", value: "18 420", delta: "+684", tone: "violet" },
  { label: "В топ-10", value: "6 284", delta: "+4,8%", tone: "green" },
  { label: "Средняя позиция", value: "18,4", delta: "−2,1", tone: "blue" },
  { label: "Страниц без кластера", value: "37", delta: "Требуют внимания", tone: "amber" }
] as const;

const activities = [
  ["Съём позиций", "12 640 запросов", "Завершено", "8 мин назад"],
  ["Wordstat: базовая частота", "4 280 запросов", "Выполняется · 64%", "Сейчас"],
  ["Кластеризация ядра", "1 840 запросов", "В очереди", "Через ~12 мин"]
] as const;

export default async function DashboardPage() {
  const apiState = await getPlatformApiState();

  return (
    <AppShell>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Проект · Promsoyuz</p>
          <h1>Добрый день, Кирилл</h1>
          <p>Вот что происходит с проектом за последние 7 дней.</p>
        </div>
        <button className="primary-button" type="button">
          <Icon name="plus" />
          Новая задача
        </button>
      </section>

      {!apiState.available && (
        <aside className="status-banner" role="status">
          <span className="status-dot" />
          <div>
            <strong>Демонстрационный режим</strong>
            <p>Platform API пока недоступен — показываем безопасные тестовые данные.</p>
          </div>
        </aside>
      )}

      <section className="metric-grid" aria-label="Ключевые показатели">
        {metrics.map((metric) => (
          <article className={`metric-card ${metric.tone}`} key={metric.label}>
            <div className="metric-head">
              <span>{metric.label}</span>
              <button aria-label={`Действия: ${metric.label}`} type="button">•••</button>
            </div>
            <strong>{metric.value}</strong>
            <small>{metric.delta}</small>
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
            <button className="select-button" type="button">7 дней⌄</button>
          </header>
          <div className="chart-summary">
            <div>
              <span>Видимость</span>
              <strong>32,8%</strong>
              <small>+3,4%</small>
            </div>
            <div className="legend"><i /> Видимость сайта</div>
          </div>
          <div className="chart" aria-label="Рост видимости с 24 до 33 процентов">
            <svg role="img" viewBox="0 0 700 210" preserveAspectRatio="none">
              <defs>
                <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#6d5dfc" stopOpacity=".24" />
                  <stop offset="1" stopColor="#6d5dfc" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                className="chart-area"
                d="M0 165 C90 160 100 128 180 136 S290 110 360 115 S470 85 525 92 S610 52 700 48 L700 210 L0 210 Z"
              />
              <path
                className="chart-line"
                d="M0 165 C90 160 100 128 180 136 S290 110 360 115 S470 85 525 92 S610 52 700 48"
              />
            </svg>
            <div className="chart-axis">
              <span>22 июл</span><span>24 июл</span><span>26 июл</span><span>Сегодня</span>
            </div>
          </div>
        </article>

        <article className="panel attention-panel">
          <header className="panel-header">
            <div>
              <h2>Требует внимания</h2>
              <p>Сигналы с высоким приоритетом</p>
            </div>
            <span className="count-badge">4</span>
          </header>
          <ul className="attention-list">
            <li>
              <span className="signal amber">!</span>
              <div><strong>37 страниц без кластера</strong><p>Проверьте карту релевантности</p></div>
            </li>
            <li>
              <span className="signal red">↓</span>
              <div><strong>12 запросов потеряли топ-10</strong><p>Изменение за последние сутки</p></div>
            </li>
            <li>
              <span className="signal blue">↻</span>
              <div><strong>Данные устарели</strong><p>Частотность не обновлялась 34 дня</p></div>
            </li>
          </ul>
          <button className="text-button" type="button">Показать все сигналы →</button>
        </article>
      </section>

      <section className="panel activity-panel">
        <header className="panel-header">
          <div>
            <h2>Фоновые задачи</h2>
            <p>Очередь сбора и обработки данных</p>
          </div>
          <button className="text-button" type="button">Все задачи</button>
        </header>
        <div className="activity-table">
          {activities.map(([name, scope, status, time], index) => (
            <div className="activity-row" key={name}>
              <span className={`job-icon job-${index + 1}`}>
                <Icon name={index === 2 ? "semantic" : "trend"} />
              </span>
              <div className="activity-name"><strong>{name}</strong><small>{scope}</small></div>
              <span className={`job-status status-${index + 1}`}>{status}</span>
              <time>{time}</time>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
