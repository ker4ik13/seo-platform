"use client";

import type { SemanticAiAnswerDetail } from "@seo-platform/contracts";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  semanticAiAnswerMarkdownWithSources,
  semanticAiCitationDomain,
  semanticAiCitationTitle
} from "../lib/semantic-ai-citations";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticSiteFavicon } from "./semantic-competitor-snapshots";
import { SemanticModal } from "./semantic-modal";

export function SemanticAiAnswerDetailsModal({
  keywordId,
  keywordText,
  onClose,
  projectId
}: Readonly<{
  keywordId: string;
  keywordText: string;
  onClose: () => void;
  projectId: string;
}>) {
  const [items, setItems] = useState<readonly SemanticAiAnswerDetail[]>([]);
  const [activeEngine, setActiveEngine] = useState<"YANDEX" | "GOOGLE">("YANDEX");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void browserApiRequest<readonly SemanticAiAnswerDetail[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}/ai-answers`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result);
        const preferred = result.find(({ answerPresent }) => answerPresent) ?? result[0];
        if (preferred) setActiveEngine(preferred.searchEngine);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(detailsErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [keywordId, projectId]);

  const active = useMemo(
    () => items.find(({ searchEngine }) => searchEngine === activeEngine) ?? items[0],
    [activeEngine, items]
  );
  const renderedMarkdown = useMemo(
    () => active?.answerMarkdown
      ? semanticAiAnswerMarkdownWithSources(active.answerMarkdown, active.sources)
      : undefined,
    [active]
  );

  return (
    <SemanticModal
      bodyClassName="semantic-ai-answer-modal-body"
      className="semantic-ai-answer-modal"
      description="Последний сохранённый ИИ-ответ, источники и позиция сайта для выбранного поисковика."
      onClose={onClose}
      size="large"
      title={`ИИ-ответ · ${keywordText}`}
    >
      {loading ? (
        <div className="semantic-dialog-loading" role="status">Загружаем ИИ-ответ…</div>
      ) : error ? (
        <div className="inline-alert danger" role="alert">{error}</div>
      ) : !active ? (
        <div className="semantic-ai-answer-empty">
          <Icon name="ai" />
          <strong>Сохранённых проверок пока нет</strong>
          <span>Запустите «Проверить ИИ-ответы» для этого запроса.</span>
        </div>
      ) : (
        <div className="semantic-ai-answer-details">
          <div aria-label="Поисковая система" className="semantic-ai-answer-tabs" role="tablist">
            {items.map((item) => (
              <button
                aria-selected={item.searchEngine === active.searchEngine}
                className={item.searchEngine === active.searchEngine ? "active" : undefined}
                key={item.searchEngine}
                onClick={() => setActiveEngine(item.searchEngine)}
                role="tab"
                type="button"
              >
                <SearchEngineLogo engine={item.searchEngine} size="compact" />
                {item.searchEngine === "YANDEX" ? "Яндекс" : "Google"}
                {item.answerPresent && <i aria-label="Ответ найден" />}
              </button>
            ))}
          </div>

          <dl className="semantic-ai-answer-summary">
            <div><dt>ИИ-ответ</dt><dd>{active.answerPresent ? "Найден" : "Не найден"}</dd></div>
            <div><dt>Позиция сайта</dt><dd>{active.siteFound && active.position ? `№ ${active.position}` : "Не найден"}</dd></div>
            <div><dt>Бренд</dt><dd>{active.brandFound ? "Упомянут" : "Не найден"}</dd></div>
            <div><dt>Регион / устройство</dt><dd>{active.regionCode} · {active.device === "DESKTOP" ? "десктоп" : "мобильное"}</dd></div>
            <div><dt>Проверено</dt><dd><time dateTime={active.observedAt}>{formatDateTime(active.observedAt)}</time></dd></div>
          </dl>

          {active.siteFound && active.rankingUrl && (
            <a className="semantic-ai-answer-site-position" href={active.rankingUrl} rel="noreferrer noopener" target="_blank">
              <span><Icon name="link" />Страница проекта в источниках</span>
              <strong>№ {active.position ?? "—"}</strong>
              <small title={active.rankingUrl}>{displayUrl(active.rankingUrl)}</small>
            </a>
          )}

          <section className="semantic-ai-answer-copy">
            <header><Icon name="ai" /><h3>Полный ответ</h3></header>
            {active.answerPresent && renderedMarkdown ? (
              <div className="markdown-document semantic-ai-answer-markdown">
                <ReactMarkdown
                  components={{
                    a: ({ children, href, title }) =>
                      href && title === semanticAiCitationTitle ? (
                        <a
                          className="semantic-ai-inline-citation"
                          href={href}
                          rel="noreferrer noopener"
                          target="_blank"
                          title={href}
                        >
                          <SemanticSiteFavicon faviconUrl={undefined} pageUrl={href} />
                          <span>{semanticAiCitationDomain(href)}</span>
                        </a>
                      ) : (
                        <a href={href} rel="noreferrer noopener" target="_blank">{children}</a>
                      )
                  }}
                  remarkPlugins={[remarkGfm]}
                >
                  {renderedMarkdown}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="semantic-ai-answer-section-empty">Поисковик не вернул ИИ-ответ для этой проверки.</div>
            )}
          </section>

          <section className="semantic-ai-answer-sources">
            <header><Icon name="list" /><h3>Источники</h3><span>{active.sources.length}</span></header>
            {active.sources.length > 0 ? (
              <ol>
                {active.sources.map((source) => (
                  <li className={source.belongsToProject ? "project-source" : undefined} key={`${source.position}:${source.url}`}>
                    <span className="semantic-ai-answer-source-position">{source.position}</span>
                    <div>
                      <a href={source.url} rel="noreferrer noopener" target="_blank" title={source.title ?? source.url}>
                        {source.title?.trim() || displayUrl(source.url)}
                      </a>
                      {source.description && <p>{source.description}</p>}
                      <small title={source.url}>{displayUrl(source.url)}</small>
                    </div>
                    {source.belongsToProject && <b>Ваш домен</b>}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="semantic-ai-answer-section-empty">Источники не были указаны поисковиком.</div>
            )}
          </section>
        </div>
      )}
    </SemanticModal>
  );
}

function displayUrl(value: string): string {
  return value.replace(/^https?:\/\//iu, "").replace(/\/$/u, "");
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function detailsErrorMessage(error: unknown): string {
  return error instanceof BrowserApiError
    ? `${error.message}${error.requestId ? ` Код запроса: ${error.requestId}.` : ""}`
    : "Не удалось загрузить сохранённый ИИ-ответ.";
}
