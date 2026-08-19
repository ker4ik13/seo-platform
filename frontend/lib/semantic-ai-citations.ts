import type { SemanticAiAnswerSource } from "@seo-platform/contracts";

export const semanticAiCitationTitle = "ИИ-источник" as const;

/**
 * Arsenkin returns citation markers such as [1][6] separately from source
 * metadata. Turn only bare numeric markers into real Markdown links; existing
 * links like [1](https://...) stay untouched.
 */
export function semanticAiAnswerMarkdownWithSources(
  markdown: string,
  sources: readonly SemanticAiAnswerSource[]
): string {
  const sourceByReference = new Map<number, SemanticAiAnswerSource>();
  for (const source of sources) {
    if (source.providerId !== undefined && source.providerId >= 0) {
      sourceByReference.set(source.providerId, source);
    }
    if (!sourceByReference.has(source.position)) {
      sourceByReference.set(source.position, source);
    }
  }
  return markdown.replace(/\\?\[(\d{1,5})\\?\](?!\s*\()/gu, (marker, rawReference: string) => {
    const source = sourceByReference.get(Number(rawReference));
    if (!source) return marker;
    return `[${sourceDomain(source.url)}](<${source.url}> "${semanticAiCitationTitle}")`;
  });
}

export function semanticAiCitationDomain(value: string): string {
  return sourceDomain(value);
}

function sourceDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./iu, "");
  } catch {
    return value.replace(/^https?:\/\//iu, "").split("/")[0] || value;
  }
}
