import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type {
  InternalApplySemanticNegativeKeywordsInput,
  InternalCreateSemanticNegativeKeywordPresetInput,
  InternalDeleteSemanticNegativeKeywordPresetInput,
  InternalSemanticNegativeKeywordCommandInput,
  InternalUpdateSemanticNegativeKeywordPresetInput,
  SemanticNegativeKeywordApplyResult,
  SemanticNegativeKeywordMatch,
  SemanticNegativeKeywordPreset,
  SemanticNegativeKeywordPreview,
  SemanticNegativeKeywordRules,
  SemanticNegativeKeywordScope
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

const APPLY_BATCH_SIZE = 500;
const MAX_SCANNED_KEYWORDS = 50_000;

type PresetRow = Prisma.SemanticNegativeKeywordPresetGetPayload<Record<string, never>>;

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

type VersionKeywordRow = Prisma.KeywordGetPayload<{
  include: typeof VERSION_INCLUDE;
}>;

@Injectable()
export class NegativeKeywordService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly semanticVersions: SemanticVersionService
  ) {}

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly SemanticNegativeKeywordPreset[]> {
    const rows = await this.prisma.semanticNegativeKeywordPreset.findMany({
      where: { workspaceId, projectId, status: "ACTIVE" },
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
      take: 500
    });
    return rows.map(preset);
  }

  public async create(
    input: InternalCreateSemanticNegativeKeywordPresetInput
  ): Promise<SemanticNegativeKeywordPreset> {
    try {
      return preset(await this.prisma.semanticNegativeKeywordPreset.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          name: input.name,
          normalizedName: normalizePresetName(input.name),
          words: [...input.rules.words],
          matchMode: input.rules.matchMode,
          caseSensitive: input.rules.caseSensitive,
          createdBy: input.actorId,
          updatedBy: input.actorId
        }
      }));
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicatePreset();
      throw error;
    }
  }

  public async update(
    presetId: string,
    input: InternalUpdateSemanticNegativeKeywordPresetInput
  ): Promise<SemanticNegativeKeywordPreset> {
    await this.requiredPreset(input.workspaceId, input.projectId, presetId);
    try {
      const result = await this.prisma.semanticNegativeKeywordPreset.updateMany({
        where: {
          id: presetId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          version: input.version
        },
        data: {
          ...(input.name === undefined
            ? {}
            : {
                name: input.name,
                normalizedName: normalizePresetName(input.name)
              }),
          ...(input.rules === undefined
            ? {}
            : {
                words: [...input.rules.words],
                matchMode: input.rules.matchMode,
                caseSensitive: input.rules.caseSensitive
              }),
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) await this.throwPresetState(input.workspaceId, input.projectId, presetId);
      return preset(await this.prisma.semanticNegativeKeywordPreset.findUniqueOrThrow({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: presetId
          }
        }
      }));
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicatePreset();
      throw error;
    }
  }

  public async delete(
    presetId: string,
    input: InternalDeleteSemanticNegativeKeywordPresetInput
  ): Promise<void> {
    await this.requiredPreset(input.workspaceId, input.projectId, presetId);
    const result = await this.prisma.semanticNegativeKeywordPreset.updateMany({
      where: {
        id: presetId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        version: input.version
      },
      data: {
        status: "DELETED",
        normalizedName: `${presetId}:deleted`,
        deletedAt: new Date(),
        updatedBy: input.actorId,
        version: { increment: 1 }
      }
    });
    if (result.count !== 1) await this.throwPresetState(input.workspaceId, input.projectId, presetId);
  }

  public async preview(
    input: InternalSemanticNegativeKeywordCommandInput
  ): Promise<SemanticNegativeKeywordPreview> {
    return this.buildPreview(input);
  }

  public async apply(
    input: InternalApplySemanticNegativeKeywordsInput
  ): Promise<SemanticNegativeKeywordApplyResult> {
    const preview = await this.buildPreview(input);
    if (preview.previewHash !== input.previewHash) {
      throw new HttpException(
        {
          code: "RESOURCE_STATE_CONFLICT",
          message: "Negative keyword preview is no longer current"
        },
        HttpStatus.CONFLICT
      );
    }
    if (preview.batchCount === 0) return { deletedCount: 0, hasMore: false };
    const batchIds = preview.matches.slice(0, preview.batchCount).map(({ keywordId }) => keywordId);
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
          id: { in: batchIds }
        },
        include: VERSION_INCLUDE,
        orderBy: { id: "asc" }
      });
      const expectedById = new Map(
        preview.matches.slice(0, preview.batchCount).map((match) => [match.keywordId, match.version])
      );
      if (
        rows.length !== batchIds.length ||
        rows.some((row) => row.version !== expectedById.get(row.id))
      ) {
        throw new HttpException(
          { code: "RESOURCE_STATE_CONFLICT", message: "Keywords changed after preview" },
          HttpStatus.CONFLICT
        );
      }
      const systemGroups = await ensureKeywordSystemGroupIds(
        transaction,
        input.workspaceId,
        input.projectId
      );
      await transaction.keywordGroupMembership.deleteMany({
        where: { projectId: input.projectId, keywordId: { in: batchIds } }
      });
      await transaction.keywordGroupMembership.createMany({
        data: batchIds.map((keywordId) => ({
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
          id: { in: batchIds }
        },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      if (updated.count !== rows.length) {
        throw new HttpException(
          { code: "RESOURCE_STATE_CONFLICT", message: "Keywords changed while applying negative words" },
          HttpStatus.CONFLICT
        );
      }
      const changes: SemanticKeywordChange[] = rows.map((row) => {
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
          reason: "NEGATIVE_KEYWORDS",
          summary: `Минус-слова: удалено ${changes.length} запросов`
        },
        changes,
        []
      );
      return updated.count;
    });
    return { deletedCount, hasMore: preview.hasMore };
  }

  private async buildPreview(
    input: InternalSemanticNegativeKeywordCommandInput
  ): Promise<SemanticNegativeKeywordPreview> {
    const resolvedRules = input.rules ?? (
      await this.requiredPreset(input.workspaceId, input.projectId, input.presetId!)
    ).rules;
    const rows = await this.prisma.keyword.findMany({
      where: keywordScopeWhere(input.workspaceId, input.projectId, input.scope),
      select: { id: true, textOriginal: true, version: true },
      orderBy: { id: "asc" },
      take: MAX_SCANNED_KEYWORDS + 1
    });
    if (rows.length > MAX_SCANNED_KEYWORDS) {
      throw new HttpException(
        { code: "SCOPE_TOO_LARGE", message: "Negative keyword scope exceeds 50000 rows" },
        HttpStatus.PAYLOAD_TOO_LARGE
      );
    }
    if (input.scope.kind === "SELECTION") {
      const versionById = new Map(input.scope.items!.map(({ id, version }) => [id, version]));
      if (rows.length !== versionById.size || rows.some((row) => row.version !== versionById.get(row.id))) {
        throw new HttpException(
          { code: "RESOURCE_STATE_CONFLICT", message: "Selected keywords changed" },
          HttpStatus.CONFLICT
        );
      }
    }
    const matches = rows.flatMap((row) => {
      const matchedWords = negativeKeywordMatchingWords(row.textOriginal, resolvedRules);
      return matchedWords.length === 0
        ? []
        : [{
            keywordId: row.id,
            text: row.textOriginal,
            version: row.version,
            matchedWords
          } satisfies SemanticNegativeKeywordMatch];
    });
    const batch = matches.slice(0, APPLY_BATCH_SIZE);
    return {
      scannedCount: rows.length,
      matchedCount: matches.length,
      batchCount: batch.length,
      hasMore: matches.length > batch.length,
      previewHash: previewHash(resolvedRules, input.scope, batch),
      matches: batch,
      matchesTruncated: matches.length > batch.length
    };
  }

  private async requiredPreset(
    workspaceId: string,
    projectId: string,
    presetId: string
  ): Promise<PresetRow & { readonly rules: SemanticNegativeKeywordRules }> {
    const row = await this.prisma.semanticNegativeKeywordPreset.findFirst({
      where: { id: presetId, workspaceId, projectId, status: "ACTIVE" }
    });
    if (!row) throw presetNotFound();
    return Object.assign(row, {
      rules: {
        words: row.words,
        matchMode: matchMode(row.matchMode),
        caseSensitive: row.caseSensitive
      }
    });
  }

  private async throwPresetState(
    workspaceId: string,
    projectId: string,
    presetId: string
  ): Promise<never> {
    const current = await this.requiredPreset(workspaceId, projectId, presetId);
    throw new HttpException(
      {
        code: "VERSION_CONFLICT",
        message: "Negative keyword preset version conflict",
        currentVersion: current.version
      },
      HttpStatus.PRECONDITION_FAILED
    );
  }
}

function keywordScopeWhere(
  workspaceId: string,
  projectId: string,
  scope: SemanticNegativeKeywordScope
): Prisma.KeywordWhereInput {
  return {
    workspaceId,
    projectId,
    status: "ACTIVE",
    ...(scope.kind === "GROUP"
      ? { memberships: { some: { projectId, groupId: scope.groupId! } } }
      : scope.kind === "SELECTION"
        ? { id: { in: scope.items!.map(({ id }) => id) } }
        : {})
  };
}

export function negativeKeywordMatchingWords(
  text: string,
  rules: SemanticNegativeKeywordRules
): readonly string[] {
  const subject = rules.caseSensitive ? text : text.toLocaleLowerCase("ru-RU");
  return rules.words.filter((word) => {
    const candidate = rules.caseSensitive ? word : word.toLocaleLowerCase("ru-RU");
    if (rules.matchMode === "CONTAINS") return subject.includes(candidate);
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "u").test(subject);
  });
}

function previewHash(
  rules: SemanticNegativeKeywordRules,
  scope: SemanticNegativeKeywordScope,
  matches: readonly SemanticNegativeKeywordMatch[]
): string {
  return createHash("sha256").update(JSON.stringify({
    rules,
    scope,
    matches: matches.map(({ keywordId, version }) => [keywordId, version])
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

function preset(row: PresetRow): SemanticNegativeKeywordPreset {
  return {
    id: row.id,
    name: row.name,
    rules: {
      words: row.words,
      matchMode: matchMode(row.matchMode),
      caseSensitive: row.caseSensitive
    },
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function matchMode(value: string): SemanticNegativeKeywordRules["matchMode"] {
  if (value === "CONTAINS" || value === "WHOLE_WORD") return value;
  throw new Error("Stored negative keyword match mode is invalid");
}

function normalizePresetName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").trim();
}

function presetNotFound(): HttpException {
  return new HttpException(
    { code: "NOT_FOUND", message: "Negative keyword preset not found" },
    HttpStatus.NOT_FOUND
  );
}

function duplicatePreset(): HttpException {
  return new HttpException(
    { code: "DUPLICATE", message: "A negative keyword preset with this name already exists" },
    HttpStatus.CONFLICT
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
