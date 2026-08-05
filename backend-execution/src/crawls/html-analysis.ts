import { createHash } from "node:crypto";
import { Parser } from "htmlparser2";

export interface CrawlHeading {
  readonly level: number;
  readonly text: string;
}

export interface CrawlHreflang {
  readonly language: string;
  readonly url: string;
}

export interface CrawlDetectedIssue {
  readonly code: string;
  readonly severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  readonly title: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export interface CrawlPageAnalysis {
  readonly title?: string;
  readonly description?: string;
  readonly h1?: string;
  readonly h1Count: number;
  readonly canonicalUrl?: string;
  readonly robots?: string;
  readonly language?: string;
  readonly headings: readonly CrawlHeading[];
  readonly hreflang: readonly CrawlHreflang[];
  readonly internalLinks: readonly string[];
  readonly externalLinks: readonly string[];
  readonly imageCount: number;
  readonly imagesMissingAlt: number;
  readonly structuredDataTypes: readonly string[];
  readonly wordCount: number;
  readonly contentHash: string;
  readonly indexability:
    | "INDEXABLE"
    | "NOINDEX"
    | "CANONICALIZED"
    | "REDIRECTED"
    | "ERROR"
    | "UNKNOWN";
  readonly issues: readonly CrawlDetectedIssue[];
}

const MAX_LINKS = 5_000;
const MAX_HEADINGS = 500;
const MAX_HREFLANG = 100;
const MAX_TEXT_FIELD = 4_000;

export function analyzeHtmlPage(input: {
  readonly html: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly responseTimeMs: number;
  readonly sizeBytes: number;
}): CrawlPageAnalysis {
  const baseUrl = new URL(input.finalUrl);
  const internalLinks = new Set<string>();
  const externalLinks = new Set<string>();
  const headings: CrawlHeading[] = [];
  const hreflang: CrawlHreflang[] = [];
  const structuredDataTypes = new Set<string>();
  const visibleText: string[] = [];
  let hiddenDepth = 0;
  let titleDepth = 0;
  let titleBuffer = "";
  let currentHeading:
    | { readonly level: number; text: string }
    | undefined;
  let description: string | undefined;
  let canonicalUrl: string | undefined;
  let robots: string | undefined;
  let language: string | undefined;
  let imageCount = 0;
  let imagesMissingAlt = 0;
  let jsonLdDepth = 0;
  let jsonLd = "";

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const tag = name.toLowerCase();
        if (tag === "html" && attributes.lang && !language) {
          language = boundedText(attributes.lang, 16);
        }
        if (["script", "style", "noscript", "template"].includes(tag)) {
          hiddenDepth += 1;
        }
        if (tag === "title") {
          titleDepth += 1;
          titleBuffer = "";
        }
        if (/^h[1-6]$/u.test(tag) && headings.length < MAX_HEADINGS) {
          currentHeading = {
            level: Number(tag.slice(1)),
            text: ""
          };
        }
        if (tag === "meta") {
          const nameValue = attributes.name?.toLowerCase();
          if (nameValue === "description" && !description) {
            description = boundedText(attributes.content, MAX_TEXT_FIELD);
          }
          if (
            ["robots", "googlebot", "yandex"].includes(nameValue ?? "") &&
            attributes.content
          ) {
            robots = mergeRobots(robots, attributes.content);
          }
        }
        if (tag === "link") {
          const rel = relationTokens(attributes.rel);
          if (rel.has("canonical") && !canonicalUrl) {
            canonicalUrl = normalizedLink(attributes.href, baseUrl);
          }
          if (
            rel.has("alternate") &&
            attributes.hreflang &&
            hreflang.length < MAX_HREFLANG
          ) {
            const url = normalizedLink(attributes.href, baseUrl);
            if (url) {
              hreflang.push({
                language: boundedText(attributes.hreflang, 35) ?? "und",
                url
              });
            }
          }
        }
        if (tag === "a" && attributes.href) {
          collectLink(
            attributes.href,
            baseUrl,
            internalLinks,
            externalLinks
          );
        }
        if (tag === "img") {
          imageCount += 1;
          if (!attributes.alt?.trim()) imagesMissingAlt += 1;
        }
        if (
          tag === "script" &&
          attributes.type?.toLowerCase() === "application/ld+json"
        ) {
          jsonLdDepth += 1;
          jsonLd = "";
        }
      },
      ontext(text) {
        if (titleDepth > 0) titleBuffer += text;
        if (currentHeading) currentHeading.text += text;
        if (jsonLdDepth > 0) jsonLd += text;
        if (hiddenDepth === 0) visibleText.push(text);
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (tag === "title" && titleDepth > 0) titleDepth -= 1;
        if (
          currentHeading &&
          tag === `h${currentHeading.level}` &&
          headings.length < MAX_HEADINGS
        ) {
          const text = normalizedText(currentHeading.text, 1_000);
          if (text) headings.push({ level: currentHeading.level, text });
          currentHeading = undefined;
        }
        if (
          tag === "script" &&
          jsonLdDepth > 0
        ) {
          jsonLdDepth -= 1;
          for (const type of jsonLdTypes(jsonLd)) {
            structuredDataTypes.add(type);
          }
          jsonLd = "";
        }
        if (["script", "style", "noscript", "template"].includes(tag)) {
          hiddenDepth = Math.max(0, hiddenDepth - 1);
        }
      }
    },
    {
      decodeEntities: true,
      lowerCaseAttributeNames: true,
      lowerCaseTags: true,
      recognizeSelfClosing: true
    }
  );
  parser.end(input.html);

  const title = normalizedText(titleBuffer, 1_000);
  const h1Values = headings.filter(({ level }) => level === 1);
  const h1 = h1Values[0]?.text;
  const text = normalizedText(visibleText.join(" "), 2_000_000) ?? "";
  const wordCount = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const noindex = relationTokens(robots).has("noindex");
  const canonicalized =
    canonicalUrl !== undefined &&
    canonicalUrl !== normalizedLink(input.finalUrl, baseUrl);
  const indexability =
    input.statusCode >= 400
      ? "ERROR"
      : input.statusCode >= 300
        ? "REDIRECTED"
        : noindex
          ? "NOINDEX"
          : canonicalized
            ? "CANONICALIZED"
            : input.statusCode >= 200 && input.statusCode < 300
              ? "INDEXABLE"
              : "UNKNOWN";
  const analysis: CrawlPageAnalysis = {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(h1 ? { h1 } : {}),
    h1Count: h1Values.length,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(robots ? { robots } : {}),
    ...(language ? { language } : {}),
    headings,
    hreflang,
    internalLinks: [...internalLinks],
    externalLinks: [...externalLinks],
    imageCount,
    imagesMissingAlt,
    structuredDataTypes: [...structuredDataTypes].sort(),
    wordCount,
    contentHash: createHash("sha256").update(text, "utf8").digest("hex"),
    indexability,
    issues: []
  };
  return {
    ...analysis,
    issues: detectIssues(analysis, input)
  };
}

function detectIssues(
  page: CrawlPageAnalysis,
  response: {
    readonly statusCode: number;
    readonly responseTimeMs: number;
    readonly sizeBytes: number;
  }
): readonly CrawlDetectedIssue[] {
  const issues: CrawlDetectedIssue[] = [];
  if (response.statusCode >= 500) {
    issues.push(issue("HTTP_5XX", "CRITICAL", "Ошибка сервера", {
      statusCode: response.statusCode
    }));
  } else if (response.statusCode >= 400) {
    issues.push(issue("HTTP_4XX", "ERROR", "Страница недоступна", {
      statusCode: response.statusCode
    }));
  } else if (response.statusCode >= 300) {
    issues.push(issue("HTTP_REDIRECT", "WARNING", "URL перенаправляет", {
      statusCode: response.statusCode
    }));
  }
  if (!page.title) {
    issues.push(issue("TITLE_MISSING", "ERROR", "Отсутствует Title"));
  } else if (page.title.length < 20) {
    issues.push(issue("TITLE_SHORT", "WARNING", "Title слишком короткий", {
      length: page.title.length
    }));
  } else if (page.title.length > 70) {
    issues.push(issue("TITLE_LONG", "WARNING", "Title слишком длинный", {
      length: page.title.length
    }));
  }
  if (!page.description) {
    issues.push(
      issue("DESCRIPTION_MISSING", "WARNING", "Отсутствует Description")
    );
  } else if (page.description.length > 180) {
    issues.push(
      issue("DESCRIPTION_LONG", "WARNING", "Description слишком длинный", {
        length: page.description.length
      })
    );
  }
  if (page.h1Count === 0) {
    issues.push(issue("H1_MISSING", "ERROR", "Отсутствует H1"));
  } else if (page.h1Count > 1) {
    issues.push(issue("H1_MULTIPLE", "WARNING", "Несколько H1", {
      count: page.h1Count
    }));
  }
  if (page.indexability === "NOINDEX") {
    issues.push(issue("NOINDEX", "ERROR", "Страница закрыта от индексации"));
  }
  if (page.indexability === "CANONICALIZED") {
    issues.push(
      issue(
        "CANONICAL_TO_OTHER",
        "WARNING",
        "Canonical указывает на другой URL"
      )
    );
  }
  if (page.imagesMissingAlt > 0) {
    issues.push(issue("IMAGE_ALT_MISSING", "WARNING", "У изображений нет alt", {
      count: page.imagesMissingAlt,
      total: page.imageCount
    }));
  }
  if (page.wordCount < 100 && response.statusCode < 300) {
    issues.push(issue("THIN_CONTENT", "INFO", "Мало текстового содержимого", {
      wordCount: page.wordCount
    }));
  }
  if (response.responseTimeMs > 3_000) {
    issues.push(issue("SLOW_RESPONSE", "WARNING", "Медленный ответ", {
      responseTimeMs: response.responseTimeMs
    }));
  }
  if (response.sizeBytes > 1_500_000) {
    issues.push(issue("HTML_TOO_LARGE", "WARNING", "Большой HTML-документ", {
      sizeBytes: response.sizeBytes
    }));
  }
  return issues;
}

function collectLink(
  value: string,
  base: URL,
  internal: Set<string>,
  external: Set<string>
): void {
  if (internal.size + external.size >= MAX_LINKS) return;
  const url = normalizedLink(value, base);
  if (!url) return;
  const parsed = new URL(url);
  if (parsed.origin === base.origin) internal.add(url);
  else external.add(url);
}

function normalizedLink(value: string | undefined, base: URL): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return undefined;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    return undefined;
  }
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  return url.toString();
}

function normalizedText(value: string, max: number): string | undefined {
  const text = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

function boundedText(value: string | undefined, max: number): string | undefined {
  return value ? normalizedText(value, max) : undefined;
}

function mergeRobots(current: string | undefined, value: string): string {
  return [...relationTokens(current), ...relationTokens(value)]
    .filter((item, index, values) => values.indexOf(item) === index)
    .join(", ");
}

function relationTokens(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .toLowerCase()
      .split(/[\s,]+/u)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function jsonLdTypes(value: string): readonly string[] {
  if (!value.trim() || value.length > 1_000_000) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  const types = new Set<string>();
  visitJsonLd(parsed, types, 0);
  return [...types];
}

function visitJsonLd(value: unknown, types: Set<string>, depth: number): void {
  if (depth > 10 || types.size >= 100) return;
  if (Array.isArray(value)) {
    for (const item of value) visitJsonLd(item, types, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "@type") {
      for (const type of Array.isArray(item) ? item : [item]) {
        if (typeof type === "string" && type.length <= 160) types.add(type);
      }
    } else if (key === "@graph") {
      visitJsonLd(item, types, depth + 1);
    }
  }
}

function issue(
  code: string,
  severity: CrawlDetectedIssue["severity"],
  title: string,
  details: CrawlDetectedIssue["details"] = {}
): CrawlDetectedIssue {
  return { code, severity, title, details };
}
