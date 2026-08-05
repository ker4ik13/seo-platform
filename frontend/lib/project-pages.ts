import type {
  PageContentStatus,
  PageIndexability,
  PageType,
  ProjectPageSummary,
  ProjectPageInput
} from "@seo-platform/contracts";

export interface ProjectPageDraft {
  readonly url: string;
  readonly aliases: string;
  readonly pageType: PageType;
  readonly indexability: PageIndexability;
  readonly httpStatus: string;
  readonly canonicalTarget: string;
  readonly robots: string;
  readonly title: string;
  readonly description: string;
  readonly h1: string;
  readonly language: string;
  readonly template: string;
  readonly contentStatus: PageContentStatus | "";
  readonly ownerId: string;
  readonly priority: string;
  readonly publishedAt: string;
  readonly notes: string;
}

export type ProjectPageDraftErrors = Readonly<
  Partial<Record<keyof ProjectPageDraft, string>>
>;

export function emptyProjectPageDraft(): ProjectPageDraft {
  return {
    url: "",
    aliases: "",
    pageType: "PLANNED",
    indexability: "UNKNOWN",
    httpStatus: "",
    canonicalTarget: "",
    robots: "",
    title: "",
    description: "",
    h1: "",
    language: "",
    template: "",
    contentStatus: "IDEA",
    ownerId: "",
    priority: "0",
    publishedAt: "",
    notes: ""
  };
}

export function projectPageDraft(
  page: ProjectPageSummary
): ProjectPageDraft {
  return {
    url: page.url,
    aliases: page.aliases.map(({ url }) => url).join("\n"),
    pageType: page.pageType,
    indexability: page.indexability,
    httpStatus: page.httpStatus?.toString() ?? "",
    canonicalTarget: page.canonicalTarget ?? "",
    robots: page.robots ?? "",
    title: page.title ?? "",
    description: page.description ?? "",
    h1: page.h1 ?? "",
    language: page.language ?? "",
    template: page.template ?? "",
    contentStatus: page.contentStatus ?? "",
    ownerId: page.ownerId ?? "",
    priority: page.priority.toString(),
    publishedAt: page.publishedAt
      ? toLocalDateTime(page.publishedAt)
      : "",
    notes: page.notes ?? ""
  };
}

export function validateProjectPageDraft(
  draft: ProjectPageDraft
): ProjectPageDraftErrors {
  const errors: Partial<Record<keyof ProjectPageDraft, string>> = {};
  if (!validHttpUrl(draft.url)) {
    errors.url = "Укажите абсолютный HTTP(S) URL.";
  }
  const aliases = aliasLines(draft.aliases);
  if (aliases.length > 100 || aliases.some((url) => !validHttpUrl(url))) {
    errors.aliases = "До 100 абсолютных HTTP(S) URL, по одному в строке.";
  }
  if (
    draft.httpStatus &&
    (!Number.isInteger(Number(draft.httpStatus)) ||
      Number(draft.httpStatus) < 100 ||
      Number(draft.httpStatus) > 599)
  ) {
    errors.httpStatus = "HTTP-код должен быть от 100 до 599.";
  }
  if (draft.canonicalTarget && !validHttpUrl(draft.canonicalTarget)) {
    errors.canonicalTarget = "Canonical должен быть абсолютным HTTP(S) URL.";
  }
  if (
    !Number.isInteger(Number(draft.priority)) ||
    Number(draft.priority) < 0 ||
    Number(draft.priority) > 100
  ) {
    errors.priority = "Приоритет должен быть от 0 до 100.";
  }
  if (draft.ownerId && !uuid(draft.ownerId)) {
    errors.ownerId = "Укажите корректный ID участника.";
  }
  if (draft.language) {
    try {
      if (!Intl.getCanonicalLocales(draft.language)[0]) {
        errors.language = "Укажите BCP-47 код языка.";
      }
    } catch {
      errors.language = "Укажите BCP-47 код языка.";
    }
  }
  return errors;
}

export function projectPageInput(
  draft: ProjectPageDraft
): ProjectPageInput {
  return {
    url: draft.url.trim(),
    aliases: aliasLines(draft.aliases),
    pageType: draft.pageType,
    indexability: draft.indexability,
    ...(draft.httpStatus
      ? { httpStatus: Number(draft.httpStatus) }
      : {}),
    ...(draft.canonicalTarget
      ? { canonicalTarget: draft.canonicalTarget.trim() }
      : {}),
    ...(draft.robots ? { robots: draft.robots.trim() } : {}),
    ...(draft.title ? { title: draft.title.trim() } : {}),
    ...(draft.description
      ? { description: draft.description.trim() }
      : {}),
    ...(draft.h1 ? { h1: draft.h1.trim() } : {}),
    ...(draft.language ? { language: draft.language.trim() } : {}),
    ...(draft.template ? { template: draft.template.trim() } : {}),
    ...(draft.contentStatus
      ? { contentStatus: draft.contentStatus }
      : {}),
    ...(draft.ownerId ? { ownerId: draft.ownerId.trim() } : {}),
    priority: Number(draft.priority),
    ...(draft.publishedAt
      ? { publishedAt: new Date(draft.publishedAt).toISOString() }
      : {}),
    ...(draft.notes ? { notes: draft.notes.trim() } : {})
  };
}

export function projectPagesApiPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/pages`;
}

export function projectPageApiPath(
  projectId: string,
  pageId: string
): string {
  return `${projectPagesApiPath(projectId)}/${encodeURIComponent(pageId)}`;
}

export function projectPagesReturnTo(projectId: string): string {
  return `/app/projects/${encodeURIComponent(projectId)}/pages`;
}

function aliasLines(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value
  );
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
