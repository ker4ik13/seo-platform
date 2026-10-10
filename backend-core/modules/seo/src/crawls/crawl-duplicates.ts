import { createHash } from "node:crypto";
import {
  crawlDuplicateKinds,
  type CrawlDuplicateKind
} from "@seo-platform/contracts";

export interface CrawlDuplicateSnapshot {
  readonly id: string;
  readonly pageId: string;
  readonly sequence: number;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly indexability?: string;
  readonly contentType: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly h1: string | null;
  readonly wordCount: number;
  readonly contentHash: string;
  readonly crawledAt: Date;
}

export interface DetectedCrawlDuplicateGroup {
  readonly kind: CrawlDuplicateKind;
  readonly signatureHash: string;
  readonly members: readonly CrawlDuplicateSnapshot[];
}

export function detectCrawlDuplicateGroups(
  snapshots: readonly CrawlDuplicateSnapshot[]
): readonly DetectedCrawlDuplicateGroup[] {
  const eligible = snapshots
    .filter(isEligibleHtmlSnapshot)
    .sort((left, right) => left.sequence - right.sequence);
  const groups: DetectedCrawlDuplicateGroup[] = [];
  for (const kind of crawlDuplicateKinds) {
    const candidates = new Map<string, CrawlDuplicateSnapshot[]>();
    for (const snapshot of eligible) {
      const signature = duplicateSignature(snapshot, kind);
      if (!signature) continue;
      const members = candidates.get(signature.hash) ?? [];
      members.push(snapshot);
      candidates.set(signature.hash, members);
    }
    for (const [signatureHash, members] of candidates) {
      if (members.length < 2) continue;
      groups.push({ kind, signatureHash, members });
    }
  }
  return groups.sort(
    (left, right) =>
      crawlDuplicateKinds.indexOf(left.kind) -
        crawlDuplicateKinds.indexOf(right.kind) ||
      right.members.length - left.members.length ||
      left.signatureHash.localeCompare(right.signatureHash)
  );
}

export function duplicateIssue(kind: CrawlDuplicateKind): {
  readonly code: string;
  readonly severity: "ERROR" | "WARNING";
  readonly title: string;
} {
  const issues: Record<
    CrawlDuplicateKind,
    {
      readonly code: string;
      readonly severity: "ERROR" | "WARNING";
      readonly title: string;
    }
  > = {
    CONTENT: {
      code: "DUPLICATE_CONTENT_GROUP",
      severity: "ERROR",
      title: "Дублирующийся контент"
    },
    TITLE: {
      code: "DUPLICATE_TITLE_GROUP",
      severity: "WARNING",
      title: "Дублирующийся Title"
    },
    DESCRIPTION: {
      code: "DUPLICATE_DESCRIPTION_GROUP",
      severity: "WARNING",
      title: "Дублирующийся Description"
    },
    H1: {
      code: "DUPLICATE_H1_GROUP",
      severity: "WARNING",
      title: "Дублирующийся H1"
    }
  };
  return issues[kind];
}

function isEligibleHtmlSnapshot(snapshot: CrawlDuplicateSnapshot): boolean {
  return (
    snapshot.statusCode >= 200 &&
    snapshot.statusCode < 300 &&
    snapshot.indexability !== "REDIRECTED" &&
    snapshot.contentType.toLocaleLowerCase("en-US").startsWith("text/html")
  );
}

function duplicateSignature(
  snapshot: CrawlDuplicateSnapshot,
  kind: CrawlDuplicateKind
): { readonly hash: string } | undefined {
  if (kind === "CONTENT") {
    if (snapshot.wordCount < 1) return undefined;
    return { hash: digest(`${kind}\0${snapshot.contentHash}`) };
  }
  const raw = {
    TITLE: snapshot.title,
    DESCRIPTION: snapshot.description,
    H1: snapshot.h1
  }[kind];
  const normalized = normalizeDuplicateValue(raw);
  return normalized
    ? { hash: digest(`${kind}\0${normalized}`) }
    : undefined;
}

function normalizeDuplicateValue(value: string | null): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("und");
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
