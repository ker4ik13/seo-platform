"use client";

import type { SemanticAiAnswerDetail } from "@seo-platform/contracts";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { searchRegionDisplayName } from "../lib/seo-regions";
import {
  semanticAiAnswerMarkdownWithSources,
  semanticAiCitationDomain,
  semanticAiCitationTitle
} from "../lib/semantic-ai-citations";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticSiteFavicon } from "./semantic-competitor-snapshots";
import { SemanticModal } from "./semantic-modal";
import { useUiLocale, UiText } from "./ui-locale";


export function SemanticAiAnswerDetailsModal({
  dimensionKey,
  keywordId,
  keywordText,
  onClose,
  projectId
}: Readonly<{
  dimensionKey?: string;
  keywordId: string;
  keywordText: string;
  onClose: () => void;
  projectId: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [items, setItems] = useState<readonly SemanticAiAnswerDetail[]>([]);
  const [activeEngine, setActiveEngine] = useState<"YANDEX" | "GOOGLE">("YANDEX");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void browserApiRequest<readonly SemanticAiAnswerDetail[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}/ai-answers${dimensionKey ? `?dimensionKey=${encodeURIComponent(dimensionKey)}` : ""}`,
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
  }, [dimensionKey, keywordId, projectId]);

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
      bodyLayout="edge"
      bodyClassName="semantic-ai-answer-modal-body"
      className="semantic-ai-answer-modal"
      description={uiText("Последний сохранённый ИИ-ответ, источники и позиция сайта для выбранного поисковика.")}
      onClose={onClose}
      size="large"
      title={uiText("ИИ-ответ · {0}", [String(keywordText)])}
    >
      {loading ? (
        <div className="semantic-dialog-loading" role="status"><UiText text="Загружаем ИИ-ответ…" /></div>
      ) : error ? (
        <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>
      ) : !active ? (
        <div className="semantic-ai-answer-empty">
          <Icon name="ai" />
          <strong><UiText text="Сохранённых проверок пока нет" /></strong>
          <span><UiText text="Запустите «Проверить ИИ-ответы» для этого запроса." /></span>
        </div>
      ) : (
        <div className="semantic-ai-answer-details">
          <div aria-label={uiText("Поисковая система")} className="semantic-ai-answer-tabs" role="tablist">
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
                {item.searchEngine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}
                {item.answerPresent && <i aria-label={uiText("Ответ найден")} />}
              </button>
            ))}
          </div>

          <dl className="semantic-ai-answer-summary">
            <div><dt><UiText text="ИИ-ответ" /></dt><dd>{active.answerPresent ? <UiText text="Найден" /> : <UiText text="Не найден" />}</dd></div>
            <div><dt><UiText text="Позиция сайта" /></dt><dd>{active.siteFound && active.position ? `№ ${active.position}` : <UiText text="Не найден" />}</dd></div>
            <div><dt><UiText text="Бренд" /></dt><dd>{active.brandFound ? <UiText text="Упомянут" /> : <UiText text="Не найден" />}</dd></div>
            <div><dt><UiText text="Регион / устройство" /></dt><dd>{searchRegionDisplayName(active.searchEngine, active.regionCode)} · {active.device === "DESKTOP" ? <UiText text="десктоп" /> : <UiText text="мобильное" />}</dd></div>
            <div><dt><UiText text="Проверено" /></dt><dd><time dateTime={active.observedAt}>{formatDateTime(active.observedAt, uiLocale)}</time></dd></div>
          </dl>

          {active.siteFound && active.rankingUrl && (
            <a className="semantic-ai-answer-site-position" href={active.rankingUrl} rel="noreferrer noopener" target="_blank">
              <span><Icon name="link" /><UiText text="Страница проекта в источниках" /></span>
              <strong>№ {active.position ?? "—"}</strong>
              <small title={active.rankingUrl}>{displayUrl(active.rankingUrl)}</small>
            </a>
          )}

          <section className="semantic-ai-answer-copy">
            <header><Icon name="ai" /><h3><UiText text="Полный ответ" /></h3></header>
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
              <div className="semantic-ai-answer-section-empty"><UiText text="Поисковик не вернул ИИ-ответ для этой проверки." /></div>
            )}
          </section>

          <section className="semantic-ai-answer-sources">
            <header><Icon name="list" /><h3><UiText text="Источники" /></h3><span>{active.sources.length}</span></header>
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
                    {source.belongsToProject && <b><UiText text="Ваш домен" /></b>}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="semantic-ai-answer-section-empty"><UiText text="Источники не были указаны поисковиком." /></div>
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

function formatDateTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function detailsErrorMessage(error: unknown): string {
  return error instanceof BrowserApiError
    ? `${error.message}${error.requestId ? ` Код запроса: ${error.requestId}.` : ""}`
    : "Не удалось загрузить сохранённый ИИ-ответ.";
}
