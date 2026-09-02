"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  apiDocHref,
  apiDocSections,
  apiDocSectionsByGroup,
  apiEndpointCatalog,
  type ApiDocSectionSlug,
  type ApiEndpointDoc
} from "../lib/api-docs";
import { copyText } from "../lib/clipboard";
import styles from "./api-documentation.module.css";

export function ApiDocumentation({
  activeSection,
  baseUrl
}: Readonly<{
  activeSection: ApiDocSectionSlug;
  baseUrl: string;
}>) {
  const [query, setQuery] = useState("");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const normalizedQuery = normalizedSearch(query);
  const sectionIndex = apiDocSections.findIndex(
    ({ slug }) => slug === activeSection
  );
  const section = apiDocSections[sectionIndex] ?? apiDocSections[0];
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return undefined;
    return {
      sections: apiDocSections.filter((candidate) =>
        matchesSearch(
          [
            candidate.title,
            candidate.description,
            ...candidate.keywords
          ].join(" "),
          normalizedQuery
        )
      ),
      endpoints: apiEndpointCatalog
        .filter((endpoint) =>
          matchesSearch(
            `${endpoint.method} ${endpoint.path} ${endpoint.scope} ${endpoint.description}`,
            normalizedQuery
          )
        )
        .slice(0, 12)
    };
  }, [normalizedQuery]);
  const previous = apiDocSections[sectionIndex - 1];
  const next = apiDocSections[sectionIndex + 1];

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/ru">
          <img
            alt=""
            aria-hidden="true"
            height={30}
            src="/brand/seonorita-mark.svg"
            width={30}
          />
          <strong>SEOньорита</strong>
          <span>Документация API</span>
        </Link>
        <nav aria-label="Ссылки документации">
          <Link aria-current="page" href="/docs/api">API v1</Link>
          <Link href="/app/settings/api">API-ключи</Link>
        </nav>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <button
            aria-expanded={mobileNavigationOpen}
            className={styles.mobileNavigationButton}
            onClick={() => setMobileNavigationOpen((current) => !current)}
            type="button"
          >
            <span>{section.title}</span>
            <span aria-hidden="true">{mobileNavigationOpen ? "−" : "+"}</span>
          </button>
          <div
            className={`${styles.sidebarBody} ${mobileNavigationOpen ? styles.sidebarBodyOpen : ""}`}
          >
            <label className={styles.searchField}>
              <span className={styles.visuallyHidden}>Поиск по документации API</span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" />
                <path d="m16.2 16.2 4 4" />
              </svg>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по API"
                type="search"
                value={query}
              />
            </label>

            {searchResults ? (
              <SearchResults
                endpoints={searchResults.endpoints}
                onNavigate={() => setMobileNavigationOpen(false)}
                query={query}
                sections={searchResults.sections}
              />
            ) : (
              <nav aria-label="Разделы API" className={styles.sectionNavigation}>
                {apiDocSectionsByGroup().map((group) => (
                  <div key={group.group}>
                    <span>{group.group}</span>
                    {group.sections.map((candidate) => (
                      <Link
                        aria-current={candidate.slug === activeSection ? "page" : undefined}
                        className={candidate.slug === activeSection ? styles.activeLink : undefined}
                        href={apiDocHref(candidate.slug)}
                        key={candidate.slug}
                        onClick={() => setMobileNavigationOpen(false)}
                      >
                        {candidate.title}
                      </Link>
                    ))}
                  </div>
                ))}
              </nav>
            )}

            <div className={styles.sidebarMeta}>
              <span>Версия</span>
              <strong>Public API v1</strong>
              <small>JSON · UTF-8 · ISO 8601 UTC</small>
            </div>
          </div>
        </aside>

        <main className={styles.content}>
          <div className={styles.breadcrumbs}>
            <Link href="/docs/api">API v1</Link>
            <span aria-hidden="true">/</span>
            <span>{section.title}</span>
          </div>
          <DocumentationPage activeSection={activeSection} baseUrl={baseUrl} />
          <nav aria-label="Постраничная навигация" className={styles.pageNavigation}>
            {previous ? (
              <Link href={apiDocHref(previous.slug)}>
                <span>← Назад</span>
                <strong>{previous.title}</strong>
              </Link>
            ) : <span />}
            {next ? (
              <Link href={apiDocHref(next.slug)}>
                <span>Далее →</span>
                <strong>{next.title}</strong>
              </Link>
            ) : <span />}
          </nav>
        </main>
      </div>
    </div>
  );
}

function SearchResults({
  endpoints,
  onNavigate,
  query,
  sections
}: Readonly<{
  endpoints: readonly ApiEndpointDoc[];
  onNavigate: () => void;
  query: string;
  sections: readonly (typeof apiDocSections)[number][];
}>) {
  const empty = sections.length === 0 && endpoints.length === 0;
  return (
    <div aria-live="polite" className={styles.searchResults}>
      <div className={styles.searchResultHeading}>
        <span>Результаты</span>
        <small>{sections.length + endpoints.length}</small>
      </div>
      {empty && <p>По запросу «{query.trim()}» ничего не найдено.</p>}
      {sections.map((section) => (
        <Link href={apiDocHref(section.slug)} key={section.slug} onClick={onNavigate}>
          <strong>{section.title}</strong>
          <small>{section.description}</small>
        </Link>
      ))}
      {endpoints.map((endpoint) => (
        <Link
          href={`/docs/api/reference#${endpoint.id}`}
          key={endpoint.id}
          onClick={onNavigate}
        >
          <span className={styles.searchEndpointLine}>
            <Method method={endpoint.method} />
            <code>{endpoint.path}</code>
          </span>
          <small>{endpoint.description}</small>
        </Link>
      ))}
    </div>
  );
}

function DocumentationPage({
  activeSection,
  baseUrl
}: Readonly<{
  activeSection: ApiDocSectionSlug;
  baseUrl: string;
}>) {
  switch (activeSection) {
    case "quick-start":
      return <QuickStart baseUrl={baseUrl} />;
    case "authentication":
      return <Authentication />;
    case "projects":
      return <Projects baseUrl={baseUrl} />;
    case "semantics":
      return <Semantics baseUrl={baseUrl} />;
    case "positions":
      return <Positions baseUrl={baseUrl} />;
    case "ai-answers":
      return <AiAnswers baseUrl={baseUrl} />;
    case "frequency":
      return <Frequency baseUrl={baseUrl} />;
    case "automations":
      return <Automations baseUrl={baseUrl} />;
    case "jobs":
      return <Jobs baseUrl={baseUrl} />;
    case "errors":
      return <Errors />;
    case "reference":
      return <Reference />;
  }
}

function QuickStart({ baseUrl }: Readonly<{ baseUrl: string }>) {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Создайте отдельный ключ, выполните первый запрос и проверьте стандартную оболочку ответа."
        title="Быстрый старт"
      />
      <Callout title="Базовый URL">
        Все пути в справочнике добавляются после <code>{baseUrl}</code>.
        Домен берётся из настроек текущего окружения. Идентификаторы заранее
        передавать агенту не нужно: первый запрос <code>GET /access</code>
        вернёт доступную рабочую область, проекты и права ключа.
      </Callout>
      <Section title="1. Создайте ключ">
        <ol>
          <li>Откройте экран API-ключей и задайте понятное имя интеграции.</li>
          <li>Выберите только нужные scopes и проекты.</li>
          <li>Скопируйте секрет сразу: повторно он не показывается.</li>
          <li>Храните секрет в secret manager или переменной окружения.</li>
        </ol>
      </Section>
      <Section title="2. Выполните первый запрос">
        <EndpointHeader
          description="Возвращает контекст самого ключа без workspaceId или projectId в URL."
          method="GET"
          path="/access"
          scope="token:discover · встроено"
        />
        <CodeBlock
          code={`curl "${baseUrl}/access" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H "Accept: application/json"`}
          language="bash"
          title="Запрос"
        />
        <CodeBlock
          code={`{
  "data": {
    "apiVersion": "v1",
    "token": {
      "id": "<tokenId>",
      "name": "SEO-агент",
      "scopes": ["semantics:read", "positions:run"],
      "allProjects": false
    },
    "workspace": {
      "id": "<workspaceId>",
      "name": "Рабочая область агентства",
      "slug": "agency",
      "status": "ACTIVE"
    },
    "projects": [{
      "id": "<projectId>",
      "workspaceId": "<workspaceId>",
      "name": "Нейролюб",
      "domain": "neurolub.ru",
      "slug": "neirolub",
      "status": "ACTIVE"
    }]
  },
  "meta": { "requestId": "01J..." }
}`}
          language="json"
          title="200 · Ответ"
        />
      </Section>
      <Section title="3. Используйте найденные идентификаторы">
        <p>
          Подставляйте <code>data.workspace.id</code> и нужный
          <code> data.projects[].id</code> в остальные маршруты. Коллекция уже
          учитывает allowlist ключа и актуальные права создавшего его
          пользователя. Один ключ всегда относится к одной рабочей области;
          для другой рабочей области создайте отдельный ключ.
        </p>
        <CodeBlock
          code={`curl "${baseUrl}/projects/<projectId>/keywords?limit=100" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H "Accept: application/json"`}
          language="bash"
          title="Следующий запрос"
        />
      </Section>
      <Section title="4. Обрабатывайте ответ">
        <ul>
          <li><code>data</code> содержит ресурс или массив ресурсов.</li>
          <li><code>meta.requestId</code> сохраняйте для диагностики.</li>
          <li>У постраничных списков читайте <code>page.hasNext</code> и <code>page.nextCursor</code>.</li>
          <li>Денежные и потенциально большие целые значения передаются строками.</li>
          <li>Все даты — ISO 8601 в UTC.</li>
        </ul>
      </Section>
    </article>
  );
}

function Authentication() {
  return (
    <article className={styles.document}>
      <PageHeading
        description="API использует Bearer-токены с ограниченными правами и списком проектов. Cookie-сессия для внешнего клиента не нужна."
        title="Авторизация и права"
      />
      <Section title="Bearer-токен">
        <p>
          Передавайте секрет только в HTTP-заголовке. Не добавляйте его в URL,
          query string, JSON, логи или промпт агента.
        </p>
        <CodeBlock
          code={`Authorization: Bearer seo_pat_<secret>
Accept: application/json`}
          language="http"
          title="Обязательные заголовки"
        />
      </Section>
      <Section title="Заголовки команд">
        <Table
          columns={["Заголовок", "Когда нужен", "Назначение"]}
          rows={[
            [<code key="authorization">Authorization</code>, "Всегда", "Аутентификация API-ключа"],
            [<code key="content-type">Content-Type: application/json</code>, "Есть JSON body", "Формат тела запроса"],
            [<code key="idempotency">Idempotency-Key</code>, "Создание или запуск", "Безопасный повтор одной команды"],
            [<code key="if-match">If-Match: &quot;v4&quot;</code>, "Изменение versioned ресурса", "Защита от потерянного обновления"],
            [<code key="request-id">X-Request-Id</code>, "Необязательно", "Собственный идентификатор трассировки"]
          ]}
        />
      </Section>
      <Section title="Scopes">
        <p>
          Итоговый доступ — пересечение текущих прав пользователя, scopes ключа
          и allowlist проектов. Отзыв членства или архивация проекта действуют
          сразу, без перевыпуска ключа.
        </p>
        <div className={styles.scopeTable}>
          {([
            ["projects", "Проекты"],
            ["semantics", "Семантика"],
            ["positions", "Позиции"],
            ["frequency", "Частотность"],
            ["ai", "ИИ-ответы"],
            ["research", "Подбор ключей"],
            ["audits", "Аудиты"],
            ["pages", "Страницы"],
            ["notes", "Заметки"],
            ["integrations", "Интеграции"],
            ["automations", "Расписания"]
          ] as const).map(([scope, label]) => (
            <div key={scope}>
              <strong>{label}</strong>
              <code>{scope}:read</code>
              <code>{scope}:{runScope(scope)}</code>
            </div>
          ))}
        </div>
      </Section>
      <Callout title="Discovery без отдельного scope">
        Любой действующий ключ может вызвать <code>GET /access</code>. Endpoint
        не расширяет доступ: он показывает только workspace, allowlisted
        проекты и scopes самого ключа, повторно проверяя актуальное членство и
        права пользователя.
      </Callout>
      <Callout title="Ротация">
        При обычном перевыпуске старый секрет действует ещё 10 минут. Команда
        отзыва отключает текущий и переходный секрет немедленно.
      </Callout>
    </article>
  );
}

function Projects({ baseUrl }: Readonly<{ baseUrl: string }>) {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Читайте список доступных проектов и изменяйте versioned-настройки с If-Match."
        title="Проекты"
      />
      <RouteSummary section="projects" />
      <Callout title="Сначала определите доступ">
        Если клиент ещё не знает идентификаторы, вызовите <code>GET /access</code>
        и возьмите workspaceId и projectId из ответа. Передавать их агенту
        вручную не требуется.
      </Callout>
      <Section title="Список проектов">
        <EndpointHeader method="GET" path="/workspaces/{workspaceId}/projects" scope="projects:read" />
        <CodeBlock
          code={`curl "${baseUrl}/workspaces/<workspaceId>/projects" \\
  -H "Authorization: Bearer $SEO_API_TOKEN"`}
          language="bash"
          title="Запрос"
        />
        <p>
          Ответ — полная коллекция в общем сохранённом порядке. Для ключа с
          выбранными проектами сервер отфильтрует остальные проекты до
          формирования ответа.
        </p>
      </Section>
      <Section title="Изменение проекта">
        <EndpointHeader method="PATCH" path="/projects/{projectId}" scope="projects:write" />
        <CodeBlock
          code={`curl -X PATCH "${baseUrl}/projects/<projectId>" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H 'If-Match: "v4"' \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Нейролюб",
    "domain": "neurolub.ru"
  }'`}
          language="bash"
          title="Запрос"
        />
        <CodeBlock
          code={`{
  "data": {
    "id": "019fb800-b45b-7852-8a4e-a17d20f30cbd",
    "name": "Нейролюб",
    "domain": "neurolub.ru",
    "status": "ACTIVE",
    "version": 5,
    "createdAt": "2026-08-12T09:00:00.000Z"
  },
  "meta": { "requestId": "01J...", "version": 5 }
}`}
          language="json"
          title="200 · Ответ"
        />
        <p>
          Новую версию также возвращает <code>ETag: &quot;v5&quot;</code>.
          При устаревшем If-Match перечитайте проект и повторите осознанное изменение.
        </p>
      </Section>
      <Section title="Общий порядок проектов">
        <EndpointHeader
          method="PUT"
          path="/workspaces/{workspaceId}/projects/order"
          scope="projects:write"
        />
        <p>
          Порядок общий для всей рабочей области. Передайте одновременно
          последний увиденный список и новый полный список. Если другой
          пользователь уже изменил порядок, API вернёт <code>412</code>.
          Команда доступна только ключу со всеми проектами и пользователю с
          полным доступом к рабочей области.
        </p>
        <CodeBlock
          code={`curl -X PUT "${baseUrl}/workspaces/<workspaceId>/projects/order" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "expectedProjectIds": ["01900000-0000-7000-8000-000000000101", "01900000-0000-7000-8000-000000000102"],
    "projectIds": ["01900000-0000-7000-8000-000000000102", "01900000-0000-7000-8000-000000000101"]
  }'`}
          language="bash"
          title="Запрос"
        />
        <CodeBlock
          code={`{
  "data": {
    "projectIds": [
      "01900000-0000-7000-8000-000000000102",
      "01900000-0000-7000-8000-000000000101"
    ]
  },
  "meta": { "requestId": "01J..." }
}`}
          language="json"
          title="200 · Ответ"
        />
      </Section>
    </article>
  );
}

function Semantics({ baseUrl }: Readonly<{ baseUrl: string }>) {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Работайте с папками и ключами через cursor-pagination; большие изменения отправляйте пакетными командами."
        title="Семантика"
      />
      <RouteSummary section="semantics" />
      <Section title="Получить ключевые слова">
        <EndpointHeader method="GET" path="/projects/{projectId}/keywords" scope="semantics:read" />
        <CodeBlock
          code={`curl "${baseUrl}/projects/<projectId>/keywords?limit=100&search=холодильник" \\
  -H "Authorization: Bearer $SEO_API_TOKEN"`}
          language="bash"
          title="Запрос"
        />
        <CodeBlock
          code={`{
  "data": [
    {
      "id": "019...",
      "textOriginal": "купить холодильник",
      "textNormalized": "купить холодильник",
      "language": "ru",
      "priority": 0,
      "isFavorite": false,
      "isTracked": true,
      "tags": [],
      "tagsTruncated": false,
      "sourceMode": "MANUAL",
      "version": 7,
      "createdAt": "2026-09-01T10:00:00.000Z",
      "updatedAt": "2026-09-01T10:00:00.000Z"
    }
  ],
  "page": {
    "hasNext": true,
    "nextCursor": "opaque-cursor"
  },
  "meta": { "requestId": "01J..." }
}`}
          language="json"
          title="200 · Сокращённый ответ"
        />
      </Section>
      <Section title="Пакетное создание">
        <EndpointHeader method="POST" path="/projects/{projectId}/keywords/bulk" scope="semantics:write" />
        <CodeBlock
          code={`{
  "items": [
    {
      "text": "купить холодильник",
      "language": "ru",
      "priority": 0,
      "isFavorite": false,
      "isTracked": true,
      "tagNames": [],
      "groupId": "019..."
    }
  ],
  "duplicatePolicy": "SKIP_EXISTING"
}`}
          language="json"
          title="JSON · Тело запроса"
        />
        <CodeBlock
          code={`{
  "data": {
    "selected": 1,
    "created": 1,
    "restored": 0,
    "linked": 0,
    "skipped": 0,
    "rejected": 0,
    "failed": 0,
    "rows": [
      { "index": 0, "outcome": "CREATED", "keywordId": "019...", "version": 1 }
    ]
  },
  "meta": { "requestId": "01J..." }
}`}
          language="json"
          title="201 · Ответ"
        />
      </Section>
      <Section title="Удалить запрос">
        <EndpointHeader
          method="DELETE"
          path="/projects/{projectId}/keywords/{keywordId}"
          scope="semantics:write"
        />
        <p>
          Передайте актуальную версию запроса в <code>If-Match</code>. Без
          тела запроса ключ перемещается в системную папку «Корзина», а API
          возвращает <code>204 No Content</code> без JSON.
        </p>
        <CodeBlock
          code={`curl -X DELETE "${baseUrl}/projects/<projectId>/keywords/<keywordId>" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H 'If-Match: "v7"'`}
          language="bash"
          title="Запрос · Переместить в корзину"
        />
        <p>
          Окончательная очистка допускается только для запроса, который уже
          находится в корзине. Получите его актуальную версию после первого
          удаления и явно передайте <code>permanent: true</code>. Исторические
          замеры остаются неизменяемыми, а пользовательские значения запроса
          очищаются.
        </p>
        <CodeBlock
          code={`curl -X DELETE "${baseUrl}/projects/<projectId>/keywords/<keywordId>" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H 'If-Match: "v8"' \\
  -H "Content-Type: application/json" \\
  -d '{"permanent":true}'`}
          language="bash"
          title="Запрос · Окончательная очистка"
        />
        <Callout title="Защита от случайного удаления">
          Попытка окончательно удалить активный запрос вернёт 409, а
          устаревший If-Match — 412. Автоматически повторять такую команду с
          новой версией нельзя.
        </Callout>
      </Section>
      <Section title="Удалить папку">
        <EndpointHeader
          method="DELETE"
          path="/projects/{projectId}/keyword-groups/{groupId}"
          scope="semantics:write"
        />
        <p>
          Команда требует актуальный <code>If-Match</code> и возвращает
          <code>204 No Content</code>. Системные папки «Без группы» и «Корзина»
          удалить нельзя. Если тело отсутствует, удаляется всё поддерево,
          запросы сохраняются, а оставшиеся без папки запросы переходят в
          «Без группы».
        </p>
        <CodeBlock
          code={`curl -X DELETE "${baseUrl}/projects/<projectId>/keyword-groups/<groupId>" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H 'If-Match: "v4"' \\
  -H "Content-Type: application/json" \\
  -d '{
    "deleteKeywords": false,
    "promoteChildren": true
  }'`}
          language="bash"
          title="Запрос · Удалить папку и поднять дочерние"
        />
        <Table
          columns={["Поле", "По умолчанию", "Поведение при true"]}
          rows={[
            [
              <code key="promote-children">promoteChildren</code>,
              "Удалить папку вместе с поддеревом",
              "Удалить только выбранную папку и поднять её прямых потомков на уровень выше"
            ],
            [
              <code key="delete-keywords">deleteKeywords</code>,
              "Сохранить запросы и перенести оставшиеся без папки в «Без группы»",
              "Переместить затронутые удалением запросы в «Корзину»"
            ]
          ]}
        />
      </Section>
      <Callout title="Большие выборки">
        Не переносите тысячи идентификаторов в query string. Используйте
        cursor-pagination и предусмотренные bulk/import/export маршруты.
      </Callout>
    </article>
  );
}

function Positions({ baseUrl }: Readonly<{ baseUrl: string }>) {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Один estimate/run-контур собирает позиции либо обычную Топ-10 выдачу конкурентов."
        title="Позиции и конкуренты"
      />
      <RouteSummary section="positions" />
      <Flow steps={["Контекст", "Оценка", "Запуск", "Результат"]} />
      <Section title="1. Создать контекст">
        <EndpointHeader method="POST" path="/projects/{projectId}/tracking-contexts" scope="positions:run" />
        <CodeBlock
          code={`{
  "name": "Яндекс · Москва · Десктоп",
  "configuration": {
    "searchEngine": "YANDEX",
    "countryCode": "RU",
    "regionCode": "213",
    "regionLabel": "Москва",
    "language": "ru",
    "device": "DESKTOP",
    "depth": 50,
    "domainMatchRule": { "mode": "EXACT_HOST" },
    "safeSearch": false
  },
  "launchProfile": {
    "searchSource": "LIVE",
    "includeUntracked": false,
    "scope": { "mode": "ALL", "groupIds": [] }
  }
}`}
          language="json"
          title="JSON · Тело запроса"
        />
        <p>
          Для создания обязателен уникальный <code>Idempotency-Key</code>.
          Для изменения передавайте ETag контекста через If-Match.
        </p>
      </Section>
      <Section title="2. Получить оценку">
        <EndpointHeader method="POST" path="/projects/{projectId}/rank-estimates" scope="positions:run" />
        <CodeBlock
          code={`curl -X POST "${baseUrl}/projects/<projectId>/rank-estimates" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: rank-estimate:agent:2026-09-01T16:00" \\
  -d '{
    "trackingContextId": "<contextId>",
    "purpose": "POSITION_TRACKING",
    "provider": "XMLSTOCK",
    "searchSource": "LIVE"
  }'`}
          language="bash"
          title="Запрос"
        />
        <CodeBlock
          code={`{
  "data": {
    "id": "<estimateId>",
    "trackingContextId": "<contextId>",
    "status": "READY",
    "provider": "XMLSTOCK",
    "purpose": "POSITION_TRACKING",
    "credentialMode": "PLATFORM_PAID",
    "scope": {
      "keywordCount": "2130",
      "contextCount": "1",
      "pairCount": "2130",
      "contextVersion": 3,
      "configurationVersion": 2,
      "scopeHash": { "availability": "AVAILABLE", "algorithm": "SHA_256", "value": "..." }
    },
    "platformChargeMicro": "4260000",
    "billingCurrency": "RUB",
    "blockers": [],
    "executionAllowed": true,
    "expiresAt": "2026-09-01T16:15:00.000Z"
  },
  "meta": { "requestId": "01J..." }
}`}
          language="json"
          title="201 · Сокращённый ответ"
        />
      </Section>
      <Section title="3. Подтвердить запуск">
        <EndpointHeader method="POST" path="/projects/{projectId}/rank-runs" scope="positions:run" />
        <CodeBlock
          code={`{
  "estimateId": "<estimateId>",
  "confirmedPlatformChargeMicro": "4260000"
}`}
          language="json"
          title="JSON · Тело запроса"
        />
        <p>
          Подтверждайте ровно <code>platformChargeMicro</code> из оценки. Для
          BYOK запуска значение равно <code>&quot;0&quot;</code>. Ответ 202 содержит
          задание, а не готовые позиции.
        </p>
        <CodeBlock
          code={`{
  "data": {
    "id": "<jobId>",
    "type": "MANUAL_RANK_CHECK",
    "provider": "XMLSTOCK",
    "status": "PREPARING",
    "stage": "PREPARING_SCOPE",
    "progress": { "current": "0", "total": "2130", "unit": "KEYWORD" },
    "platformChargeMicro": "4260000",
    "billingCurrency": "RUB",
    "createdAt": "2026-09-01T16:01:00.000Z"
  },
  "meta": { "requestId": "01J..." }
}`}
          language="json"
          title="202 · Ответ"
        />
      </Section>
      <Section title="4. Получить результат">
        <CodeBlock
          code={`curl "${baseUrl}/projects/<projectId>/jobs/<jobId>/result?limit=200" \\
  -H "Authorization: Bearer $SEO_API_TOKEN"`}
          language="bash"
          title="Запрос"
        />
        <CodeBlock
          code={`{
  "data": {
    "job": { "id": "<jobId>", "status": "COMPLETED", "stage": "FINISHED" },
    "rows": [
      {
        "sequence": 1,
        "keywordId": "019...",
        "keyword": "купить холодильник",
        "found": true,
        "position": 7,
        "rankingUrl": "https://example.ru/catalog",
        "pollAttempts": 3
      }
    ],
    "page": { "hasNext": true, "nextCursor": "opaque-cursor" }
  },
  "meta": { "requestId": "01J..." }
}`}
          language="json"
          title="200 · Сокращённый ответ"
        />
        <Callout title="XMLStock">
          Один ключ опрашивается максимум 50 фактических раз. Неснятые ключи
          остаются в результате с errorCode и pollAttempts; успешные строки не теряются.
        </Callout>
      </Section>
      <Section title="5. Собрать обычную выдачу конкурентов">
        <p>
          Используйте тот же контекст, estimate и подтверждение, но передайте
          <code> purpose: &quot;COMPETITOR_SERP&quot;</code>. Провайдер всегда
          собирает Топ-10: Arsenkin запускает инструмент <code>check-top</code>,
          XMLStock — соответствующую Yandex/Google SERP-выдачу.
        </p>
        <CodeBlock
          code={`curl -X POST "${baseUrl}/projects/<projectId>/rank-estimates" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: competitors:estimate:batch-42" \\
  -d '{
    "trackingContextId": "<contextId>",
    "purpose": "COMPETITOR_SERP",
    "saveProjectPosition": true,
    "provider": "ARSENKIN",
    "searchSource": "LIVE"
  }'`}
          language="bash"
          title="Оценка сбора конкурентов"
        />
        <Callout title="Позиция сайта без второго запроса">
          <code>saveProjectPosition</code> разрешён только при
          <code> purpose: &quot;COMPETITOR_SERP&quot;</code>. Если флаг включён и
          домен проекта найден в собранной Топ-10, эта позиция попадает в
          текущую проекцию и историю. Если флаг выключен либо сайт не найден,
          конкурентная выдача сохраняется, а позиционная история не меняется.
          Отдельный платный запрос для позиции не выполняется.
        </Callout>
      </Section>
    </article>
  );
}

function AiAnswers({ baseUrl }: Readonly<{ baseUrl: string }>) {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Один Arsenkin ai-serp workflow собирает ответ и источники; purpose определяет, обновлять ли позиционную проекцию."
        title="ИИ-ответы и ИИ-выдача"
      />
      <RouteSummary section="ai-answers" />
      <Section title="Собрать ИИ-ответы и позицию">
        <EndpointHeader method="POST" path="/projects/{projectId}/ai-answer-collections" scope="ai:run" />
        <CodeBlock
          code={`curl -X POST "${baseUrl}/projects/<projectId>/ai-answer-collections" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: ai-answer:batch-42" \\
  -d '{
    "items": [{ "id": "<keywordId>", "version": 7 }],
    "searchEngine": "YANDEX",
    "regionCode": "213",
    "device": "DESKTOP",
    "host": "example.ru",
    "excludeSubdomains": false,
    "brands": [],
    "purpose": "POSITION_TRACKING"
  }'`}
          language="bash"
          title="Обычный ИИ-съём"
        />
      </Section>
      <Section title="Собрать конкурентов ИИ">
        <p>
          Для конкурентного режима передайте
          <code> purpose: &quot;COMPETITOR_SERP&quot;</code>. В Web-интерфейсе
          отдельного поля домена нет: он берётся из проекта автоматически.
          В публичном API <code>host</code> остаётся обязательным, потому что
          его требует Arsenkin <code>ai-serp</code>; передавайте домен того же
          проекта.
        </p>
        <CodeBlock
          code={`{
  "items": [{ "id": "<keywordId>", "version": 7 }],
  "searchEngine": "GOOGLE",
  "regionCode": "1011969",
  "device": "DESKTOP",
  "host": "example.ru",
  "excludeSubdomains": false,
  "brands": [],
  "purpose": "COMPETITOR_SERP",
  "saveProjectPosition": false
}`}
          language="json"
          title="JSON · ИИ-конкуренты без сохранения позиции"
        />
        <Callout title="Что делает галочка">
          При <code>saveProjectPosition: true</code> найденная среди источников
          страница проекта обновляет ИИ-позицию и историю из этого же ответа.
          При <code>false</code> ответ и источники конкурентов сохраняются, но
          позиционная проекция не меняется. Второй запрос к Arsenkin не
          создаётся. Поле допустимо только для конкурентного purpose.
        </Callout>
      </Section>
      <Section title="Статус и результат">
        <CodeBlock
          code={`curl "${baseUrl}/projects/<projectId>/ai-answer-collections/<jobId>" \\
  -H "Authorization: Bearer $SEO_API_TOKEN"

curl "${baseUrl}/projects/<projectId>/ai-answer-collections/<jobId>/result?limit=200" \\
  -H "Authorization: Bearer $SEO_API_TOKEN"`}
          language="bash"
          title="Polling и постраничный результат"
        />
      </Section>
    </article>
  );
}

function Frequency({ baseUrl }: Readonly<{ baseUrl: string }>) {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Передайте UUID и актуальные версии ключей, затем читайте состояние и постраничный результат."
        title="Частотность"
      />
      <RouteSummary section="frequency" />
      <Section title="Создать съём">
        <EndpointHeader method="POST" path="/projects/{projectId}/frequency-collections" scope="frequency:run" />
        <CodeBlock
          code={`curl -X POST "${baseUrl}/projects/<projectId>/frequency-collections" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: frequency:agent:batch-42" \\
  -d '{
    "items": [
      { "id": "<keywordId>", "version": 7 }
    ],
    "types": ["BASE", "EXACT", "FIXED"],
    "regionCode": "213",
    "device": "ALL"
  }'`}
          language="bash"
          title="Запрос"
        />
        <CodeBlock
          code={`{
  "data": {
    "id": "<jobId>",
    "provider": "XMLSTOCK",
    "status": "QUEUED",
    "selectedKeywords": 1,
    "completedKeywords": 0,
    "failedKeywords": 0,
    "types": ["BASE", "EXACT", "FIXED"],
    "regionCode": "213",
    "device": "ALL",
    "version": 1,
    "createdAt": "2026-09-01T16:00:00.000Z",
    "updatedAt": "2026-09-01T16:00:00.000Z"
  },
  "meta": { "requestId": "01J...", "version": 1 }
}`}
          language="json"
          title="202 · Ответ"
        />
      </Section>
      <Section title="Прочитать результат">
        <CodeBlock
          code={`curl "${baseUrl}/projects/<projectId>/frequency-collections/<jobId>/result?limit=200" \\
  -H "Authorization: Bearer $SEO_API_TOKEN"`}
          language="bash"
          title="Запрос"
        />
        <CodeBlock
          code={`{
  "data": {
    "collection": { "id": "<jobId>", "status": "COMPLETED" },
    "rows": [
      {
        "keywordId": "<keywordId>",
        "sequence": 1,
        "values": [
          { "type": "BASE", "value": "18420", "regionCode": "213" },
          { "type": "EXACT", "value": "870", "regionCode": "213" }
        ]
      }
    ],
    "page": { "hasNext": false }
  },
  "meta": { "requestId": "01J..." }
}`}
          language="json"
          title="200 · Сокращённый ответ"
        />
      </Section>
      <Callout title="Повтор команды">
        При сетевой неопределённости повторяйте запрос с тем же Idempotency-Key.
        Новый ключ создаст новую платную команду.
      </Callout>
    </article>
  );
}

function Automations({ baseUrl }: Readonly<{ baseUrl: string }>) {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Расписание хранит IANA timezone, контекст и предел списания для каждого запуска. В съём входит весь актуальный контекст."
        title="Расписания"
      />
      <RouteSummary section="automations" />
      <Section title="Создать расписание">
        <EndpointHeader method="POST" path="/projects/{projectId}/automations" scope="automations:manage" />
        <CodeBlock
          code={`curl -X POST "${baseUrl}/projects/<projectId>/automations" \\
  -H "Authorization: Bearer $SEO_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: automation:weekly-main" \\
  -d '{
    "name": "Позиции по понедельникам",
    "trackingContextId": "<contextId>",
    "timezone": "Europe/Moscow",
    "schedule": {
      "cadence": "WEEKLY",
      "hour": 6,
      "minute": 30,
      "weekdays": [1]
    },
    "maxPlatformChargeMicro": "12500000",
    "failureThreshold": 3,
    "enabled": true
  }'`}
          language="bash"
          title="Запрос"
        />
        <CodeBlock
          code={`{
  "data": {
    "id": "<automationId>",
    "name": "Позиции по понедельникам",
    "schedule": { "cadence": "WEEKLY", "hour": 6, "minute": 30, "weekdays": [1] },
    "timezone": "Europe/Moscow",
    "enabled": true,
    "nextRunAt": "2026-09-07T03:30:00.000Z",
    "version": 1
  },
  "meta": { "requestId": "01J...", "version": 1 }
}`}
          language="json"
          title="201 · Сокращённый ответ"
        />
      </Section>
      <Section title="Варианты schedule">
        <CodeBlock
          code={`{
  "once": {
    "cadence": "ONCE",
    "runAt": "2030-09-05T08:30:00.000Z"
  },
  "daily": {
    "cadence": "DAILY",
    "hour": 6,
    "minute": 30
  },
  "weekly": {
    "cadence": "WEEKLY",
    "hour": 6,
    "minute": 30,
    "weekdays": [1, 4]
  }
}`}
          language="json"
          title="JSON · Допустимые расписания"
        />
        <p>
          В WEEKLY дни недели нумеруются по ISO: 1 — понедельник, 7 — воскресенье.
          ONCE выполняется один раз и после завершения остаётся в истории. Лимита
          ключей в расписании нет: каждый запуск обрабатывает весь текущий список
          запросов выбранного контекста.
        </p>
      </Section>
      <Section title="Пауза, запуск и изменение">
        <p>
          PATCH, pause, resume и ручной POST <code>/automations/{`{automationId}`}/runs</code>
          требуют актуальный <code>If-Match</code>. Ручной запуск также требует
          новый Idempotency-Key. Пустое тело передавайте как <code>{`{}`}</code>.
        </p>
      </Section>
    </article>
  );
}

function Jobs({ baseUrl }: Readonly<{ baseUrl: string }>) {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Долгие операции возвращают 202. Клиент опрашивает статус с backoff и отдельно читает cursor-paginated результат."
        title="Задания и пагинация"
      />
      <Section title="Жизненный цикл">
        <div className={styles.statusFlow}>
          {[
            "PREPARING",
            "QUEUED",
            "RUNNING",
            "COMPLETED"
          ].map((status) => <code key={status}>{status}</code>)}
        </div>
        <p>
          Возможны также CANCEL_REQUESTED, CANCELLED, PARTIALLY_COMPLETED,
          FAILED и ACTION_REQUIRED. Поле <code>stage</code> уточняет текущий этап,
          но terminal определяется по <code>status</code>.
        </p>
      </Section>
      <Section title="Polling">
        <CodeBlock
          code={`curl "${baseUrl}/projects/<projectId>/jobs/<jobId>" \\
  -H "Authorization: Bearer $SEO_API_TOKEN"`}
          language="bash"
          title="Запрос статуса"
        />
        <ul>
          <li>Используйте интервалы 1, 2, 4, затем 5–10 секунд.</li>
          <li>Учитывайте Retry-After и <code>retryAt</code>, если они присутствуют.</li>
          <li>Не запускайте новую команду только потому, что ответ задержался.</li>
        </ul>
      </Section>
      <Section title="Cursor-pagination">
        <CodeBlock
          code={`GET /projects/<projectId>/jobs/<jobId>/result?limit=200
GET /projects/<projectId>/jobs/<jobId>/result?limit=200&cursor=<nextCursor>`}
          language="http"
          title="Следующая страница"
        />
        <p>
          Cursor непрозрачный: не декодируйте и не изменяйте его. Завершайте
          чтение, когда <code>page.hasNext=false</code>. Не смешивайте cursors
          разных заданий или фильтров.
        </p>
      </Section>
      <Section title="Отмена и retry">
        <p>
          Cancel cooperative: уже оплаченный запрос провайдера может завершиться
          и сохраниться. Повторяйте только неуспешные элементы через специальный
          retry endpoint, если он существует для операции.
        </p>
      </Section>
    </article>
  );
}

function Errors() {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Каждая ошибка имеет стабильный machine-readable code, requestId и явный признак retryable."
        title="Ошибки"
      />
      <Section title="Формат ошибки">
        <CodeBlock
          code={`{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "requestId": "01J...",
    "retryable": false,
    "fieldErrors": [
      {
        "path": "trackingContextId",
        "code": "INVALID_UUID"
      }
    ]
  }
}`}
          language="json"
          title="422 · Ответ"
        />
      </Section>
      <Section title="HTTP-статусы">
        <Table
          columns={["Статус", "Что означает", "Действие клиента"]}
          rows={[
            ["400 / 422", "Неверный JSON, поле или заголовок", "Исправить запрос; не повторять автоматически"],
            ["401", "Ключ неверен, истёк или отозван", "Остановить запросы и заменить секрет"],
            ["403", "Нет scope или текущего права", "Проверить права и allowlist проектов"],
            ["404", "Ресурс отсутствует или скрыт tenant-границей", "Проверить UUID и доступ"],
            ["409", "Конфликт состояния или Idempotency-Key", "Прочитать details и текущее состояние"],
            ["412", "Устаревший If-Match", "Перечитать ресурс и повторить осознанно"],
            ["429", "Превышен лимит", "Ждать Retry-After"],
            ["5xx", "Временная внутренняя ошибка", "Сохранить requestId; повторять только если retryable"]
          ]}
        />
      </Section>
      <Callout title="Неоднозначный сетевой исход">
        Если соединение оборвалось после отправки POST, повторите тот же payload
        с тем же Idempotency-Key. Не создавайте новый ключ до получения
        однозначного ответа.
      </Callout>
    </article>
  );
}

function Reference() {
  return (
    <article className={styles.document}>
      <PageHeading
        description="Пути указаны после /api/v1. Используйте поиск в левом сайдбаре, чтобы найти маршрут по методу, пути, scope или назначению."
        title="Маршруты API"
      />
      <div className={styles.referenceGroups}>
        {apiDocSections
          .filter(({ slug }) => !["jobs", "errors"].includes(slug))
          .map((section) => {
            const endpoints = apiEndpointCatalog.filter(
              (endpoint) => endpoint.section === section.slug
            );
            if (endpoints.length === 0) return null;
            return (
              <section key={section.slug}>
                <header>
                  <h2>{section.title}</h2>
                  <Link href={apiDocHref(section.slug)}>Инструкция →</Link>
                </header>
                <div className={styles.endpointReferenceList}>
                  {endpoints.map((endpoint) => (
                    <div id={endpoint.id} key={endpoint.id}>
                      <Method method={endpoint.method} />
                      <code>{endpoint.path}</code>
                      <span>{endpoint.description}</span>
                      <small>{endpoint.scope}</small>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
      </div>
    </article>
  );
}

function PageHeading({
  description,
  title
}: Readonly<{ description: string; title: string }>) {
  return (
    <header className={styles.pageHeading}>
      <span>Public API v1</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function Section({
  children,
  title
}: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Callout({
  children,
  title
}: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <aside className={styles.callout}>
      <strong>{title}</strong>
      <p>{children}</p>
    </aside>
  );
}

function CodeBlock({
  code,
  language,
  title
}: Readonly<{
  code: string;
  language: string;
  title: string;
}>) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(): Promise<void> {
    try {
      const copied = await copyText(code);
      if (!copied) throw new Error("Clipboard write was rejected");
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className={styles.codeBlock}>
      <div>
        <span>{title}</span>
        <small>{language}</small>
        <button onClick={() => void copy()} type="button">
          {copyState === "copied"
            ? "Скопировано"
            : copyState === "failed"
              ? "Выделите код"
              : "Копировать"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function EndpointHeader({
  description,
  method,
  path,
  scope
}: Readonly<{
  description?: string;
  method: ApiEndpointDoc["method"];
  path: string;
  scope: string;
}>) {
  return (
    <div className={styles.endpointHeader}>
      <Method method={method} />
      <code>{path}</code>
      <span>{scope}</span>
      {description && <p>{description}</p>}
    </div>
  );
}

function Method({ method }: Readonly<{ method: ApiEndpointDoc["method"] }>) {
  return <b className={`${styles.method} ${styles[method.toLowerCase()]}`}>{method}</b>;
}

function RouteSummary({
  section
}: Readonly<{ section: ApiDocSectionSlug }>) {
  const endpoints = apiEndpointCatalog.filter(
    (endpoint) => endpoint.section === section
  );
  return (
    <div className={styles.routeSummary}>
      {endpoints.map((endpoint) => (
        <Link href={`/docs/api/reference#${endpoint.id}`} key={endpoint.id}>
          <Method method={endpoint.method} />
          <code>{endpoint.path}</code>
          <small>{endpoint.scope}</small>
        </Link>
      ))}
    </div>
  );
}

function Table({
  columns,
  rows
}: Readonly<{
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}>) {
  return (
    <div className={styles.tableScroll}>
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Flow({ steps }: Readonly<{ steps: readonly string[] }>) {
  return (
    <ol className={styles.flow}>
      {steps.map((step, index) => (
        <li key={step}><span>{index + 1}</span>{step}</li>
      ))}
    </ol>
  );
}

function normalizedSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").trim();
}

function matchesSearch(haystack: string, normalizedQuery: string): boolean {
  const normalizedHaystack = normalizedSearch(haystack);
  return normalizedQuery
    .split(/\s+/u)
    .every((term) => normalizedHaystack.includes(term));
}

function runScope(scope: string): string {
  if (["positions", "frequency", "ai", "research", "audits"].includes(scope)) {
    return "run";
  }
  if (scope === "automations") return "manage";
  return "write";
}
