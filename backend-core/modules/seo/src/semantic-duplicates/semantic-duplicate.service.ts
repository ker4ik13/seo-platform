import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type {
  InternalApplySemanticDuplicatesInput,
  InternalSemanticDuplicateCommandInput,
  SemanticDuplicateApplyResult,
  SemanticDuplicateKeeperStrategy,
  SemanticDuplicatePreview,
  SemanticDuplicatePreviewGroup,
  SemanticDuplicatePreviewItem,
  SemanticDuplicateRules,
  SemanticDuplicateScope
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { ensureKeywordSystemGroupIds } from "../keyword-groups/semantic-system-groups.js";
import {
  lockSemanticKeywordWrites,
  SemanticVersionService,
  type SemanticKeywordChange,
  type SemanticKeywordVersionState
} from "../semantic-versions/semantic-version.service.js";
import { preciseRussianWordStem } from "../text-analysis/russian-word-form.js";

const APPLY_BATCH_SIZE = 500;
const MAX_SCANNED_KEYWORDS = 50_000;
const PREVIEW_GROUP_LIMIT = 100;

const PREVIEW_INCLUDE = {
  memberships: {
    orderBy: [{ createdAt: "asc" as const }, { groupId: "asc" as const }],
    select: { group: { select: { path: true } } }
  }
} satisfies Prisma.KeywordInclude;

const VERSION_INCLUDE = {
  memberships: {
    orderBy: { createdAt: "asc" as const },
    take: 1,
    select: { group: { select: { id: true } } }
  },
  tags: {
    orderBy: { createdAt: "asc" as const },
    select: { tag: { select: { id: true } } }
  }
} satisfies Prisma.KeywordInclude;

type PreviewRow = Prisma.KeywordGetPayload<{
  include: typeof PREVIEW_INCLUDE;
}>;

type VersionKeywordRow = Prisma.KeywordGetPayload<{
  include: typeof VERSION_INCLUDE;
}>;

interface DuplicateCandidate {
  readonly row: PreviewRow;
  readonly keeper: PreviewRow;
  readonly signature: string;
}

interface DuplicatePlan {
  readonly preview: SemanticDuplicatePreview;
  readonly candidates: readonly DuplicateCandidate[];
  readonly groups: readonly VisibleDuplicateGroup[];
}

interface VisibleDuplicateGroup {
  readonly signature: string;
  readonly keeper: PreviewRow;
  readonly candidates: readonly PreviewRow[];
  readonly itemsTruncated: boolean;
}

@Injectable()
export class SemanticDuplicateService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly semanticVersions: SemanticVersionService
  ) {}

  public async preview(
    input: InternalSemanticDuplicateCommandInput
  ): Promise<SemanticDuplicatePreview> {
    return (await this.buildPlan(input)).preview;
  }

  public async apply(
    input: InternalApplySemanticDuplicatesInput
  ): Promise<SemanticDuplicateApplyResult> {
    const plan = await this.buildPlan(input);
    if (plan.preview.previewHash !== input.previewHash) {
      throw stateConflict("Implicit duplicate preview is no longer current");
    }
    const candidates = decisionCandidates(plan, input.decisions);

    const deletedKeywordIds = candidates.map(({ row }) => row.id);
    const protectedKeepers = new Map(
      candidates.map(({ keeper }) => [keeper.id, keeper.version])
    );
    const deletedCount = await this.prisma.$transaction(async (transaction) => {
      await lockSemanticKeywordWrites(transaction, input.projectId);
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`semantic-group-tree:${input.projectId}`}, 0)
        )
      `;
      const rows = await transaction.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          id: {
            in: [
              ...deletedKeywordIds,
              ...protectedKeepers.keys()
            ]
          }
        },
        include: VERSION_INCLUDE,
        orderBy: { id: "asc" }
      });
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      const expectedCandidateVersions = new Map(
        candidates.map(({ row }) => [row.id, row.version])
      );
      if (
        rows.length !==
          new Set([...deletedKeywordIds, ...protectedKeepers.keys()]).size ||
        [...expectedCandidateVersions].some(
          ([id, version]) => rowsById.get(id)?.version !== version
        ) ||
        [...protectedKeepers].some(
          ([id, version]) => rowsById.get(id)?.version !== version
        )
      ) {
        throw stateConflict("Keywords changed after duplicate preview");
      }
      const candidateRows = deletedKeywordIds.map((id) => rowsById.get(id)!);
      const systemGroups = await ensureKeywordSystemGroupIds(
        transaction,
        input.workspaceId,
        input.projectId
      );
      await transaction.keywordGroupMembership.deleteMany({
        where: {
          projectId: input.projectId,
          keywordId: { in: deletedKeywordIds }
        }
      });
      await transaction.keywordGroupMembership.createMany({
        data: deletedKeywordIds.map((keywordId) => ({
          projectId: input.projectId,
          keywordId,
          groupId: systemGroups.TRASH
        }))
      });
      const updated = await transaction.keyword.updateMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          id: { in: deletedKeywordIds }
        },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      if (updated.count !== candidateRows.length) {
        throw stateConflict("Keywords changed while removing duplicates");
      }
      const changes: SemanticKeywordChange[] = candidateRows.map((row) => {
        const beforeState = keywordVersionState(row);
        return {
          entityId: row.id,
          operation: "DELETE",
          beforeState,
          afterState: {
            ...beforeState,
            status: "DELETED",
            groupId: systemGroups.TRASH
          },
          beforeVersion: row.version,
          afterVersion: row.version + 1
        };
      });
      await this.semanticVersions.createWithChanges(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "IMPLICIT_DUPLICATES",
          summary: `Неявные дубли: удалено ${changes.length} запросов`
        },
        changes,
        []
      );
      return updated.count;
    });

    return {
      deletedCount,
      deletedKeywordIds,
      hasMore:
        plan.preview.hasMore || candidates.length < plan.candidates.length
    };
  }

  private async buildPlan(
    input: InternalSemanticDuplicateCommandInput
  ): Promise<DuplicatePlan> {
    const rows = await this.prisma.keyword.findMany({
      where: keywordScopeWhere(
        input.workspaceId,
        input.projectId,
        input.scope
      ),
      include: PREVIEW_INCLUDE,
      orderBy: { id: "asc" },
      take: MAX_SCANNED_KEYWORDS + 1
    });
    if (rows.length > MAX_SCANNED_KEYWORDS) {
      throw new HttpException(
        {
          code: "SCOPE_TOO_LARGE",
          message: "Implicit duplicate scope exceeds 50000 rows"
        },
        HttpStatus.PAYLOAD_TOO_LARGE
      );
    }
    assertSelectionVersions(rows, input.scope);

    const baseFrequencyByKeywordId = await this.baseFrequencies(
      input.workspaceId,
      input.projectId,
      rows.map(({ id }) => id)
    );
    const ignoredTokens = ignoredTokenKeys(input.rules);
    const grouped = new Map<string, PreviewRow[]>();
    for (const row of rows) {
      const signature = duplicateSignature(
        row.textOriginal,
        input.rules,
        ignoredTokens
      );
      if (!signature) continue;
      const group = grouped.get(signature) ?? [];
      group.push(row);
      grouped.set(signature, group);
    }

    const duplicateGroups = [...grouped]
      .filter(([, items]) => items.length > 1)
      .sort(([left], [right]) => left.localeCompare(right));
    const plannedGroups = duplicateGroups.map(([signature, items]) => {
      const sorted = [...items].sort((left, right) => compareKeepers(
        left,
        right,
        input.keeperStrategy,
        baseFrequencyByKeywordId
      ));
      return { signature, keeper: sorted[0]!, candidates: sorted.slice(1) };
    });
    const allCandidates = plannedGroups.flatMap(
      ({ signature, keeper, candidates }) =>
        candidates.map((row) => ({ row, keeper, signature }))
    );
    const visibleGroups: VisibleDuplicateGroup[] = [];
    let remainingCandidates = APPLY_BATCH_SIZE;
    for (const group of plannedGroups) {
      if (
        visibleGroups.length >= PREVIEW_GROUP_LIMIT ||
        remainingCandidates === 0
      ) {
        break;
      }
      const candidates = group.candidates.slice(0, remainingCandidates);
      visibleGroups.push({
        signature: group.signature,
        keeper: group.keeper,
        candidates,
        itemsTruncated: candidates.length < group.candidates.length
      });
      remainingCandidates -= candidates.length;
    }
    const candidates = visibleGroups.flatMap(
      ({ signature, keeper, candidates }) =>
        candidates.map((row) => ({ row, keeper, signature }))
    );
    const previewGroups = visibleGroups.map((group) => previewGroup(
      group,
      baseFrequencyByKeywordId
    ));
    const preview: SemanticDuplicatePreview = {
      scannedCount: rows.length,
      duplicateGroupCount: plannedGroups.length,
      duplicateKeywordCount: plannedGroups.reduce(
        (total, group) => total + group.candidates.length + 1,
        0
      ),
      deletionCount: allCandidates.length,
      batchItems: candidates.map(({ row }) => ({
        id: row.id,
        version: row.version
      })),
      hasMore: allCandidates.length > candidates.length,
      previewHash: planHash(input, candidates),
      groups: previewGroups,
      groupsTruncated: plannedGroups.length > previewGroups.length
    };
    return { preview, candidates, groups: visibleGroups };
  }

  private async baseFrequencies(
    workspaceId: string,
    projectId: string,
    keywordIds: readonly string[]
  ): Promise<ReadonlyMap<string, bigint>> {
    if (keywordIds.length === 0) return new Map();
    const frequencies = new Map<string, bigint>();
    for (let offset = 0; offset < keywordIds.length; offset += 1_000) {
      const snapshots = await this.prisma.frequencySnapshot.findMany({
        where: {
          workspaceId,
          projectId,
          keywordId: { in: keywordIds.slice(offset, offset + 1_000) },
          type: "BASE"
        },
        orderBy: [
          { keywordId: "asc" },
          { observedAt: "desc" },
          { id: "desc" }
        ],
        distinct: ["keywordId"],
        select: { keywordId: true, value: true }
      });
      for (const { keywordId, value } of snapshots) {
        if (value !== null) frequencies.set(keywordId, value);
      }
    }
    return frequencies;
  }
}

function keywordScopeWhere(
  workspaceId: string,
  projectId: string,
  scope: SemanticDuplicateScope
): Prisma.KeywordWhereInput {
  return {
    workspaceId,
    projectId,
    status: "ACTIVE",
    ...(scope.kind === "GROUP"
      ? {
          memberships: {
            some: { projectId, groupId: scope.groupId! }
          }
        }
      : scope.kind === "SELECTION"
        ? { id: { in: scope.items!.map(({ id }) => id) } }
        : {})
  };
}

function assertSelectionVersions(
  rows: readonly PreviewRow[],
  scope: SemanticDuplicateScope
): void {
  if (scope.kind !== "SELECTION") return;
  const versionById = new Map(
    scope.items!.map(({ id, version }) => [id, version])
  );
  if (
    rows.length !== versionById.size ||
    rows.some((row) => row.version !== versionById.get(row.id))
  ) {
    throw stateConflict("Selected keywords changed");
  }
}

function ignoredTokenKeys(rules: SemanticDuplicateRules): ReadonlySet<string> {
  return new Set(
    rules.ignoredWords.flatMap((word) =>
      wordTokens(word).map((token) => duplicateTokenKey(token, rules))
    )
  );
}

export function implicitDuplicateSignature(
  text: string,
  rules: SemanticDuplicateRules
): string | undefined {
  return duplicateSignature(text, rules, ignoredTokenKeys(rules));
}

function duplicateSignature(
  text: string,
  rules: SemanticDuplicateRules,
  ignoredTokens: ReadonlySet<string>
): string | undefined {
  const normalized = normalizeComparableText(text, rules.caseSensitive);
  const tokens = wordTokens(normalized)
    .map((token) => duplicateTokenKey(token, rules))
    .filter((token) => !ignoredTokens.has(token))
    .sort((left, right) => left.localeCompare(right));
  if (tokens.length === 0) return undefined;
  const punctuation = rules.ignorePunctuation
    ? []
    : [...normalized.matchAll(/[\p{P}\p{S}]/gu)]
        .map((match) => match[0])
        .sort((left, right) => left.localeCompare(right));
  return JSON.stringify([tokens, punctuation]);
}

function normalizeComparableText(value: string, caseSensitive: boolean): string {
  const normalized = value.normalize("NFKC");
  return caseSensitive
    ? normalized
    : normalized.toLocaleLowerCase("ru-RU");
}

function wordTokens(value: string): readonly string[] {
  return [...value.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => match[0]);
}

function duplicateTokenKey(
  value: string,
  rules: SemanticDuplicateRules
): string {
  if (rules.analysisMode === "EXACT") return value;
  const casePrefix = rules.caseSensitive ? `${wordCase(value)}:` : "";
  return casePrefix + preciseRussianWordStem(value);
}

function wordCase(value: string): "LOWER" | "UPPER" | "TITLE" | "MIXED" {
  if (value === value.toLocaleLowerCase("ru-RU")) return "LOWER";
  if (value === value.toLocaleUpperCase("ru-RU")) return "UPPER";
  const [first = "", ...rest] = [...value];
  if (
    first === first.toLocaleUpperCase("ru-RU") &&
    rest.join("") === rest.join("").toLocaleLowerCase("ru-RU")
  ) {
    return "TITLE";
  }
  return "MIXED";
}

function compareKeepers(
  left: PreviewRow,
  right: PreviewRow,
  strategy: SemanticDuplicateKeeperStrategy,
  frequencies: ReadonlyMap<string, bigint>
): number {
  if (strategy === "HIGHEST_FREQUENCY") {
    return compareBigIntDesc(
      frequencies.get(left.id),
      frequencies.get(right.id)
    ) || compareNumberDesc(left.priority, right.priority) || oldestFirst(left, right);
  }
  if (strategy === "HIGHEST_PRIORITY") {
    return compareNumberDesc(left.priority, right.priority) || compareBigIntDesc(
      frequencies.get(left.id),
      frequencies.get(right.id)
    ) || oldestFirst(left, right);
  }
  return oldestFirst(left, right) || compareBigIntDesc(
    frequencies.get(left.id),
    frequencies.get(right.id)
  ) || compareNumberDesc(left.priority, right.priority);
}

function compareBigIntDesc(left: bigint | undefined, right: bigint | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left === right ? 0 : left > right ? -1 : 1;
}

function compareNumberDesc(left: number, right: number): number {
  return right - left;
}

function oldestFirst(left: PreviewRow, right: PreviewRow): number {
  return left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id);
}

function previewGroup(
  group: VisibleDuplicateGroup,
  frequencies: ReadonlyMap<string, bigint>
): SemanticDuplicatePreviewGroup {
  const items = [group.keeper, ...group.candidates];
  return {
    id: duplicateGroupId(group.signature),
    keeperKeywordId: group.keeper.id,
    items: items.map((row) => previewItem(
      row,
      row.id === group.keeper.id,
      frequencies.get(row.id)
    )),
    itemsTruncated: group.itemsTruncated
  };
}

function decisionCandidates(
  plan: DuplicatePlan,
  decisions: InternalApplySemanticDuplicatesInput["decisions"]
): readonly DuplicateCandidate[] {
  const groups = new Map(
    plan.groups.map((group) => [duplicateGroupId(group.signature), group])
  );
  return decisions.flatMap((decision) => {
    const group = groups.get(decision.groupId);
    if (!group) {
      throw stateConflict("Duplicate decisions do not match the preview");
    }
    const rows = [group.keeper, ...group.candidates];
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const keeper = rowsById.get(decision.keeper.id);
    const decisionIds = [
      decision.keeper.id,
      ...decision.deletions.map(({ id }) => id)
    ];
    if (
      !keeper ||
      keeper.version !== decision.keeper.version ||
      decisionIds.length !== rows.length ||
      new Set(decisionIds).size !== rows.length ||
      decisionIds.some((id) => !rowsById.has(id))
    ) {
      throw stateConflict("Duplicate decisions do not match the preview");
    }
    return decision.deletions.map((item) => {
      const row = rowsById.get(item.id);
      if (!row || row.version !== item.version) {
        throw stateConflict("Duplicate decisions do not match the preview");
      }
      return { row, keeper, signature: group.signature };
    });
  });
}

function duplicateGroupId(signature: string): string {
  return createHash("sha256").update(signature).digest("hex");
}

function previewItem(
  row: PreviewRow,
  keep: boolean,
  baseFrequency: bigint | undefined
): SemanticDuplicatePreviewItem {
  return {
    keywordId: row.id,
    text: row.textOriginal,
    version: row.version,
    groupPaths: [...new Set(
      row.memberships.flatMap(({ group }) =>
        group.path === null ? [] : [group.path]
      )
    )].sort((left, right) => left.localeCompare(right, "ru")),
    priority: row.priority,
    ...(baseFrequency === undefined
      ? {}
      : { baseFrequency: baseFrequency.toString() }),
    keep
  };
}

function planHash(
  input: InternalSemanticDuplicateCommandInput,
  candidates: readonly DuplicateCandidate[]
): string {
  return createHash("sha256").update(JSON.stringify({
    rules: input.rules,
    scope: input.scope,
    keeperStrategy: input.keeperStrategy,
    candidates: candidates.map(({ row, keeper, signature }) => [
      signature,
      row.id,
      row.version,
      keeper.id,
      keeper.version
    ])
  })).digest("hex");
}

function keywordVersionState(row: VersionKeywordRow): SemanticKeywordVersionState {
  return {
    textOriginal: row.textOriginal,
    textNormalized: row.textNormalized,
    normalizedHash: row.normalizedHash,
    language: row.language,
    priority: row.priority,
    isFavorite: row.isFavorite,
    intent: row.intent,
    status: row.status === "DELETED" ? "DELETED" : "ACTIVE",
    clusterId: row.clusterId,
    targetPageId: row.targetPageId,
    groupId: row.memberships[0]?.group.id ?? null,
    tagIds: row.tags.map(({ tag }) => tag.id)
  };
}

function stateConflict(message: string): HttpException {
  return new HttpException(
    { code: "RESOURCE_STATE_CONFLICT", message },
    HttpStatus.CONFLICT
  );
}
