"use client";

import { useState } from "react";
import type { SemanticKeywordCompetitorSnapshot } from "@seo-platform/contracts";
import {
  rankEngineLabel,
  rankSearchSystemLabel,
  semanticDisplayUrl,
  semanticSiteFaviconSources,
  semanticUrlBelongsToProject
} from "../lib/semantic-rank-presentation";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";

export function SemanticCompetitorSnapshots({
  emptyText = "После следующего поддерживаемого съёма здесь появятся позиции, URL и доступные мета-данные результатов.",
  emptyTitle = "SERP для этого запроса ещё не сохранён",
  projectDomain,
  showEmpty = true,
  snapshots
}: Readonly<{
  emptyText?: string;
  emptyTitle?: string;
  projectDomain: string;
  showEmpty?: boolean;
  snapshots: readonly SemanticKeywordCompetitorSnapshot[];
}>) {
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
            key={snapshot.snapshotId}
          >
            <header>
              <div>
                <h3>Топ конкурентов ({rankEngineLabel(snapshot.searchEngine)})</h3>
                <small>
                  {competitorSourceLabel(snapshot)} · {formatDateTime(snapshot.observedAt)}
                </small>
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
                        faviconUrl={result.faviconUrl}
                        pageUrl={result.url}
                      />
                    </div>
                    <div className="semantic-competitor-result">
                      <strong title={result.title ?? result.url}>
                        {result.title ?? urlHost(result.url)}
                      </strong>
                      <small title={result.snippet ?? "Описание не передано провайдером"}>
                        {result.snippet ?? "Описание не передано провайдером"}
                      </small>
                      <a
                        aria-label={`Открыть результат ${result.position}: ${urlHost(result.url)}`}
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
                {expanded ? "Скрыть" : "Показать все"}
              </button>
            )}
          </section>
        );
      })}

      {showEmpty && snapshots.length === 0 && (
        <section className="semantic-competitor-snapshot">
          <h3>Топ конкурентов</h3>
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
  const parts = resultUrlParts(value);
  return (
    <span className="semantic-competitor-url">
      {isInsecureHttpUrl(value) && (
        <span
          aria-label="Незащищённое HTTP-соединение"
          className="semantic-insecure-http"
          role="img"
          title="Незащищённое HTTP-соединение"
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
  snapshot: SemanticKeywordCompetitorSnapshot
): string {
  return `${rankSearchSystemLabel(snapshot.searchEngine, snapshot.searchSource)} · ${
    snapshot.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools"
  }`;
}

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

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}
