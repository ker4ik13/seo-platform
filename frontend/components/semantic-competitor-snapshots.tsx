"use client";

import { useState } from "react";
import type {
  SemanticAiAnswerCompetitorSnapshot,
  SemanticKeywordCompetitorSnapshot
} from "@seo-platform/contracts";
import {
  rankEngineLabel,
  rankSearchSystemLabel,
  semanticDisplayUrl,
  semanticSiteFaviconSources,
  semanticUrlBelongsToProject
} from "../lib/semantic-rank-presentation";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";
import { UiText, useUiLocale } from "./ui-locale";


export function SemanticCompetitorSnapshots({
  emptyText = "После следующего поддерживаемого съёма здесь появятся позиции, URL и доступные мета-данные результатов.",
  emptyTitle = "SERP для этого запроса ещё не сохранён",
  heading = "Топ конкурентов",
  presenceKeyPrefix,
  projectDomain,
  showEmpty = true,
  snapshots
}: Readonly<{
  emptyText?: string;
  emptyTitle?: string;
  heading?: string;
  presenceKeyPrefix?: string;
  projectDomain: string;
  showEmpty?: boolean;
  snapshots: readonly CompetitorSnapshot[];
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [expandedSnapshots, setExpandedSnapshots] =
    useState<ReadonlySet<string>>(new Set());

  return (
    <>
      {snapshots.map((snapshot) => {
        const expanded = expandedSnapshots.has(snapshot.snapshotId);
        const visibleResults = expanded
          ? snapshot.results
          : snapshot.results.slice(0, 5);
        return (
          <section
            className="semantic-competitor-snapshot"
            data-presence-cursor-anchor={presenceKeyPrefix ? "true" : undefined}
            data-presence-key={presenceKeyPrefix
              ? `${presenceKeyPrefix}:${snapshot.snapshotId}`
              : undefined}
            key={snapshot.snapshotId}
          >
            <header>
              <div>
                <h3>{heading} ({<UiText text={rankEngineLabel(snapshot.searchEngine) ?? ""} />})</h3>
                <small>
                  {<UiText text={competitorSourceLabel(snapshot) ?? ""} />} · {formatDateTime(snapshot.observedAt, uiLocale)}
                </small>
                {"regionCode" in snapshot && snapshot.regionCode && <small className="semantic-competitor-geography">{"regionLabel" in snapshot && snapshot.regionLabel ? snapshot.regionLabel : snapshot.regionCode} · <UiText text={snapshot.device === "MOBILE" ? "Телефон" : "ПК"} /></small>}
              </div>
              <ProviderLogo provider={snapshot.provider} size="compact" />
            </header>
            <ol>
              {visibleResults.map((result) => {
                const isProjectSite = semanticUrlBelongsToProject(
                  result.url,
                  projectDomain
                );
                return (
                  <li
                    className={isProjectSite ? "is-project-site" : undefined}
                    key={`${snapshot.snapshotId}:${result.position}`}
                  >
                    <div className="semantic-competitor-rank">
                      <span>{result.position}</span>
                      <SemanticSiteFavicon
                        faviconUrl={
                          "faviconUrl" in result && typeof result.faviconUrl === "string"
                            ? result.faviconUrl
                            : undefined
                        }
                        pageUrl={result.url}
                      />
                    </div>
                    <div className="semantic-competitor-result">
                      <strong title={result.title ?? result.url}>
                        {result.title ?? urlHost(result.url)}
                      </strong>
                      <small title={result.snippet ?? "Описание не передано провайдером"}>
                        {result.snippet ?? <UiText text="Описание не передано провайдером" />}
                      </small>
                      <a
                        aria-label={uiText("Открыть результат {0}: {1}", [String(result.position), String(urlHost(result.url))])}
                        href={result.url}
                        rel="noopener noreferrer"
                        target="_blank"
                        title={result.url}
                      >
                        <SemanticSerpResultUrl value={result.url} />
                      </a>
                    </div>
                  </li>
                );
              })}
            </ol>
            {snapshot.results.length > 5 && (
              <button
                className="semantic-competitor-toggle"
                onClick={() =>
                  setExpandedSnapshots((current) =>
                    toggleSetValue(current, snapshot.snapshotId)
                  )
                }
                type="button"
              >
                {expanded ? <UiText text="Скрыть" /> : <UiText text="Показать все" />}
              </button>
            )}
          </section>
        );
      })}

      {showEmpty && snapshots.length === 0 && (
        <section
          className="semantic-competitor-snapshot"
          data-presence-cursor-anchor={presenceKeyPrefix ? "true" : undefined}
          data-presence-key={presenceKeyPrefix
            ? `${presenceKeyPrefix}:empty`
            : undefined}
        >
          <h3>{heading}</h3>
          <div className="semantic-inspector-empty">
            <strong>{emptyTitle}</strong>
            <span>{emptyText}</span>
          </div>
        </section>
      )}
    </>
  );
}

export function SemanticSerpResultUrl({
  value
}: Readonly<{ value: string }>) {
  const { t: uiText } = useUiLocale();
  const parts = resultUrlParts(value);
  return (
    <span className="semantic-competitor-url">
      {isInsecureHttpUrl(value) && (
        <span
          aria-label={uiText("Незащищённое HTTP-соединение")}
          className="semantic-insecure-http"
          role="img"
          title={uiText("Незащищённое HTTP-соединение")}
        >
          <Icon name="lockOpen" />
        </span>
      )}
      <b>{parts.domain}</b>
      <span>{parts.suffix}</span>
    </span>
  );
}

export function SemanticSiteFavicon({
  faviconUrl,
  pageUrl
}: Readonly<{ faviconUrl: string | undefined; pageUrl: string }>) {
  const sources = semanticSiteFaviconSources(pageUrl, faviconUrl);
  const [failedSources, setFailedSources] = useState<readonly string[]>([]);
  const source = sources.find(
    (candidate) => !failedSources.includes(candidate)
  );

  if (!source) {
    return (
      <span aria-hidden="true" className="semantic-site-favicon fallback">
        <Icon name="http" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="semantic-site-favicon">
      <img
        alt=""
        decoding="async"
        height={18}
        key={source}
        loading="lazy"
        onError={() =>
          setFailedSources((current) =>
            current.includes(source) ? current : [...current, source]
          )
        }
        referrerPolicy="no-referrer"
        src={source}
        width={18}
      />
    </span>
  );
}

function competitorSourceLabel(
  snapshot: CompetitorSnapshot
): string {
  const searchSource = "searchSource" in snapshot
    ? snapshot.searchSource
    : undefined;
  return `${rankSearchSystemLabel(snapshot.searchEngine, searchSource)} · ${
    snapshot.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools"
  }`;
}

type CompetitorSnapshot =
  | SemanticKeywordCompetitorSnapshot
  | SemanticAiAnswerCompetitorSnapshot;

function resultUrlParts(value: string): Readonly<{
  domain: string;
  suffix: string;
}> {
  try {
    const url = new URL(value);
    return {
      domain: url.host,
      suffix: `${url.pathname}${url.search}${url.hash}` || "/"
    };
  } catch {
    return { domain: semanticDisplayUrl(value), suffix: "" };
  }
}

function isInsecureHttpUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "http:";
  } catch {
    return false;
  }
}

function urlHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return semanticDisplayUrl(value);
  }
}

function toggleSetValue(
  current: ReadonlySet<string>,
  value: string
): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function formatDateTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}
