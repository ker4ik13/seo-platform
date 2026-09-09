"use client";

import type { SemanticKeywordListSiteResult } from "@seo-platform/contracts";
import {
  sameSemanticRankingUrl,
  semanticDisplayUrl
} from "../lib/semantic-rank-presentation";
import {
  SemanticSerpResultUrl,
  SemanticSiteFavicon
} from "./semantic-competitor-snapshots";
import { UiText, useUiLocale } from "./ui-locale";


export function SemanticProjectSerpResults({
  results,
  showUrlDifferences = false,
  targetUrl
}: Readonly<{
  results: readonly SemanticKeywordListSiteResult[];
  showUrlDifferences?: boolean;
  targetUrl?: string;
}>) {
  const { t: uiText } = useUiLocale();
  return (
    <ol className="semantic-project-serp-results">
      {results.map((result) => {
        const isTarget = Boolean(
          targetUrl && sameSemanticRankingUrl(targetUrl, result.rankingUrl)
        );
        return (
          <li
            className={isTarget ? "is-target" : undefined}
            key={`${result.position}:${result.rankingUrl}`}
          >
            <span className="semantic-project-serp-position">
              {result.position}
            </span>
            <SemanticSiteFavicon
              faviconUrl={result.faviconUrl}
              pageUrl={result.rankingUrl}
            />
            <div className="semantic-project-serp-result">
              <strong title={result.title ?? result.rankingUrl}>
                {result.title ?? resultUrlHost(result.rankingUrl)}
              </strong>
              <small
                title={
                  result.snippet ?? "Описание не передано провайдером"
                }
              >
                {result.snippet ?? <UiText text="Описание не передано провайдером" />}
              </small>
              <a
                aria-label={uiText("Открыть страницу на позиции {0}: {1}", [String(result.position), String(resultUrlHost(result.rankingUrl))])}
                href={result.rankingUrl}
                rel="noopener noreferrer"
                target="_blank"
                title={result.rankingUrl}
              >
                <SemanticSerpResultUrl
                  {...(showUrlDifferences && targetUrl
                    ? { differenceTarget: targetUrl }
                    : {})}
                  value={result.rankingUrl}
                />
              </a>
              {isTarget && <em><UiText text="Целевой URL" /></em>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function resultUrlHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return semanticDisplayUrl(value);
  }
}
