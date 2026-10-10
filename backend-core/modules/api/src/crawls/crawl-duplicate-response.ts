import {
  crawlDuplicateKinds,
  technicalCrawlMaxDuplicateGroupLimit,
  technicalCrawlMaxDuplicateIssueLimit,
  technicalCrawlMaxUrlLimit,
  type CrawlDuplicateKind,
  type ProjectCrawlDuplicateGroupCollection,
  type ProjectCrawlDuplicateGroupSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KINDS = new Set<string>(crawlDuplicateKinds);

export function crawlDuplicateGroupCollection(
  value: unknown
): ProjectCrawlDuplicateGroupCollection {
  const input = record(value);
  if (
    Object.keys(input).length !== 1 ||
    !Array.isArray(input.groups) ||
    input.groups.length > technicalCrawlMaxDuplicateGroupLimit
  ) invalid();
  const groups = input.groups.map(group);
  if (
    new Set(groups.map(({ id }) => id)).size !== groups.length ||
    groups.reduce((total, item) => total + item.members.length, 0) > technicalCrawlMaxDuplicateIssueLimit
  ) invalid();
  return { groups };
}

function group(value: unknown): ProjectCrawlDuplicateGroupSummary {
  const input = record(value);
  const keys = [
    "id",
    "crawlId",
    "kind",
    "memberCount",
    "members",
    "createdAt"
  ];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input)) ||
    !uuid(input.id) ||
    !uuid(input.crawlId) ||
    typeof input.kind !== "string" ||
    !KINDS.has(input.kind) ||
    !Number.isSafeInteger(input.memberCount) ||
    Number(input.memberCount) < 2 ||
    Number(input.memberCount) > technicalCrawlMaxUrlLimit ||
    !Array.isArray(input.members) ||
    input.members.length !== input.memberCount ||
    !date(input.createdAt)
  ) invalid();
  const members = input.members.map((value) => {
    const member = record(value);
    if (
      Object.keys(member).length !== 2 ||
      !uuid(member.pageId) ||
      !text(member.url, 4_096)
    ) invalid();
    return {
      pageId: member.pageId,
      url: member.url
    } as const;
  });
  if (new Set(members.map(({ pageId }) => pageId)).size !== members.length) {
    invalid();
  }
  return {
    id: input.id,
    crawlId: input.crawlId,
    kind: input.kind as CrawlDuplicateKind,
    memberCount: Number(input.memberCount),
    members,
    createdAt: input.createdAt
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function date(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO Data returned an invalid crawl duplicate response",
    retryable: true
  });
}
