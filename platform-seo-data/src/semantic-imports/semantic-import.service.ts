import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  domainEventTypes,
  type InternalAbortSemanticImportInput,
  type InternalAbortSemanticImportResult,
  type InternalApplySemanticImportChunkInput,
  type InternalBeginSemanticImportInput,
  type InternalCompleteSemanticImportInput,
  type InternalNormalizedSemanticKeyword,
  type InternalNormalizeSemanticKeywordsInput,
  type InternalNormalizeSemanticKeywordsResult,
  type InternalSemanticImportChunkResult,
  type InternalSemanticImportReceipt,
  type SemanticImportDuplicatePolicy,
  type SemanticImportPublishRow,
  type SemanticImportResultSummary
} from "@seo-platform/contracts";
import {
  Prisma,
  type Keyword,
  type SemanticImportChunkReceipt,
  type SemanticImportReceipt
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  assertStoredKeywordCapacity,
  lockStoredKeywordCapacity
} from "../internal/semantic-capacity.js";
import { normalizePageUrl } from "../pages/page-url.js";
import { ensureKeywordSystemGroupIds } from "../keyword-groups/semantic-system-groups.js";

const SEMANTIC_IMPORT_TRANSACTION_MAX_WAIT_MS = 5_000;
const SEMANTIC_IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;

@Injectable()
export class SemanticImportService {
  public constructor(private readonly prisma: PrismaService) {}

  public async normalizeKeywords(
    input: InternalNormalizeSemanticKeywordsInput
  ): Promise<InternalNormalizeSemanticKeywordsResult> {
    const normalized = input.rows.map((row) =>
      normalizeKeyword(row.rowNumber, row.text, row.language)
    );
    const existing = await this.prisma.keyword.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        OR: normalized.map(({ language, normalizedHash }) => ({
          language,
          normalizedHash
        }))
      },
      select: { language: true, normalizedHash: true }
    });
    const existingKeys = new Set(
      existing.map(({ language, normalizedHash }) =>
        keywordKey(language, normalizedHash)
      )
    );
    return {
      rows: normalized.map((row) => ({
        ...row,
        existsInProject: existingKeys.has(
          keywordKey(row.language, row.normalizedHash)
        )
      }))
    };
  }

  public async begin(
    input: InternalBeginSemanticImportInput
  ): Promise<InternalSemanticImportReceipt> {
    const expectedNewKeywords = BigInt(input.expectedNewKeywords);
    if (expectedNewKeywords > BigInt(input.expectedUniqueRows)) {
      throw new BadRequestException(
        "Expected new keywords cannot exceed expected unique rows"
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      await lockStoredKeywordCapacity(
        transaction,
        input.workspaceId
      );
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`semantic-keyword-write:${input.projectId}`}, 0)
        )
      `;
      const existing =
        await transaction.semanticImportReceipt.findUnique({
          where: { importId: input.importId },
          include: { _count: { select: { chunks: true } } }
        });
      if (existing) {
        assertReceiptCommand(existing, input);
        return receiptSummary(existing, existing._count.chunks);
      }
      await assertStoredKeywordCapacity(
        transaction,
        input.workspaceId,
        input.projectId,
        expectedNewKeywords,
        input.entitlement
      );
      const created = await transaction.semanticImportReceipt.create({
        data: {
          importId: input.importId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          mappingHash: input.mappingHash,
          duplicatePolicy: input.duplicatePolicy,
          expectedChunks: input.expectedChunks,
          expectedUniqueRows: BigInt(input.expectedUniqueRows),
          planCode: input.entitlement.planCode,
          planVersion: input.entitlement.planVersion,
          storedKeywordsLimit: BigInt(
            input.entitlement.storedKeywords
          ),
          keywordsPerProjectLimit: BigInt(
            input.entitlement.keywordsPerProject
          ),
          foldersPerProjectLimit: BigInt(
            input.entitlement.foldersPerProject
          ),
          reservedKeywords: expectedNewKeywords
        }
      });
      return receiptSummary(created, 0);
    });
  }

  public async applyChunk(
    input: InternalApplySemanticImportChunkInput
  ): Promise<InternalSemanticImportChunkResult> {
    if (payloadHash(input.rows, input.groupPaths) !== input.payloadHash) {
      throw new BadRequestException("Semantic import payload hash mismatch");
    }
    const receipt = await this.requiredReceipt(input);
    if (input.chunkIndex >= receipt.expectedChunks) {
      throw new BadRequestException("Semantic import chunk is out of range");
    }
    const existingChunk =
      await this.prisma.semanticImportChunkReceipt.findUnique({
        where: {
          importId_chunkIndex: {
            importId: input.importId,
            chunkIndex: input.chunkIndex
          }
        }
      });
    if (existingChunk) {
      assertChunkHash(existingChunk, input.payloadHash);
      return chunkSummary(existingChunk);
    }
    if (receipt.status === "COMPLETED") {
      throw new ConflictException("Semantic import is already completed");
    }

    return this.prisma.$transaction(async (transaction) => {
      await lockStoredKeywordCapacity(
        transaction,
        input.workspaceId
      );
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`semantic-keyword-write:${input.projectId}`}, 0)
        )
      `;
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`semantic-group-tree:${input.projectId}`}, 0)
        )
      `;
      const concurrentChunk =
        await transaction.semanticImportChunkReceipt.findUnique({
          where: {
            importId_chunkIndex: {
              importId: input.importId,
              chunkIndex: input.chunkIndex
            }
          }
        });
      if (concurrentChunk) {
        assertChunkHash(concurrentChunk, input.payloadHash);
        return chunkSummary(concurrentChunk);
      }
      const transactionReceipt =
        await transaction.semanticImportReceipt.findUnique({
          where: { importId: input.importId }
        });
      if (!transactionReceipt) {
        throw new NotFoundException("Semantic import receipt not found");
      }
      assertReceiptScope(transactionReceipt, input);
      if (transactionReceipt.status !== "RECEIVING") {
        throw new ConflictException("Semantic import is already completed");
      }

      const existingKeywords = await transaction.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          OR: input.rows.map(({ language, normalizedHash }) => ({
            language,
            normalizedHash
          }))
        }
      });
      const existingByKey = new Map(
        existingKeywords.map((keyword) => [
          keywordKey(keyword.language, keyword.normalizedHash),
          keyword
        ])
      );
      const trashedKeywordIds = new Set(
        existingKeywords.length === 0
          ? []
          : (
              await transaction.keywordGroupMembership.findMany({
                where: {
                  projectId: input.projectId,
                  keywordId: { in: existingKeywords.map(({ id }) => id) },
                  group: {
                    workspaceId: input.workspaceId,
                    projectId: input.projectId,
                    status: "ACTIVE",
                    systemKind: "TRASH"
                  }
                },
                select: { keywordId: true }
              })
            ).map(({ keywordId }) => keywordId)
      );
      const trashedDuplicateCandidates = input.rows.flatMap((row) => {
        const keyword = existingByKey.get(
          keywordKey(row.language, row.normalizedHash)
        );
        return keyword && trashedKeywordIds.has(keyword.id)
          ? [{
              keywordId: keyword.id,
              version: keyword.version,
              text: row.textOriginal,
              language: row.language
            }]
          : [];
      });
      const newRows = input.rows.filter(
        (row) =>
          !existingByKey.has(
            keywordKey(row.language, row.normalizedHash)
          )
      );
      const missingReservation =
        BigInt(newRows.length) > transactionReceipt.reservedKeywords
          ? BigInt(newRows.length) -
            transactionReceipt.reservedKeywords
          : 0n;
      if (missingReservation > 0n) {
        await assertStoredKeywordCapacity(
          transaction,
          input.workspaceId,
          input.projectId,
          missingReservation,
          receiptEntitlement(transactionReceipt)
        );
      }
      const availableReservation =
        transactionReceipt.reservedKeywords + missingReservation;
      const rowsToApply =
        input.duplicatePolicy === "SKIP_EXISTING"
          ? newRows
          : input.rows;
      const pages = await ensurePages(transaction, input, rowsToApply);
      const groups = await ensureGroups(
        transaction,
        input,
        rowsToApply,
        input.groupPaths ?? [],
        receiptEntitlement(transactionReceipt).foldersPerProject
      );
      const tags = await ensureTags(transaction, input, rowsToApply);
      const customColumns = await ensureCustomColumns(
        transaction,
        input,
        rowsToApply
      );
      if (newRows.length > 0) {
        await transaction.keyword.createMany({
          data: newRows.map((row) => ({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            textOriginal: row.textOriginal,
            textNormalized: row.textNormalized,
            normalizedHash: row.normalizedHash,
            language: row.language,
            ...(row.priority === undefined ? {} : { priority: row.priority }),
            ...(row.isFavorite === undefined
              ? {}
              : { isFavorite: row.isFavorite }),
            ...(row.intent === undefined ? {} : { intent: row.intent }),
            ...(row.targetUrl &&
            pages.ids.get(normalizePageUrl(row.targetUrl, "targetUrl").hash)
              ? {
                  targetPageId: pages.ids.get(
                    normalizePageUrl(row.targetUrl, "targetUrl").hash
                  )!
                }
              : {}),
            customValues: json(row.customValues),
            sourceMode: "IMPORT",
            sourceId: input.importId,
            createdBy: input.actorId,
            updatedBy: input.actorId
          })),
          skipDuplicates: true
        });
      }
      const allKeywords = await transaction.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          OR: input.rows.map(({ language, normalizedHash }) => ({
            language,
            normalizedHash
          }))
        }
      });
      const keywordByKey = new Map(
        allKeywords.map((keyword) => [
          keywordKey(keyword.language, keyword.normalizedHash),
          keyword
        ])
      );
      const createdKeys = new Set(
        newRows.flatMap(({ language, normalizedHash }) => {
          const key = keywordKey(language, normalizedHash);
          return keywordByKey.get(key)?.sourceId === input.importId
            ? [key]
            : [];
        })
      );
      const updatedKeywordIds = new Set<string>();
      const skippedKeywordIds = new Set<string>();
      for (const row of input.rows) {
        const key = keywordKey(row.language, row.normalizedHash);
        const keyword = keywordByKey.get(key);
        if (!keyword) {
          throw new Error("Imported keyword was not persisted");
        }
        if (createdKeys.has(key)) continue;
        if (trashedKeywordIds.has(keyword.id)) {
          skippedKeywordIds.add(keyword.id);
          continue;
        }
        if (input.duplicatePolicy === "SKIP_EXISTING") {
          skippedKeywordIds.add(keyword.id);
          continue;
        }
        const update = keywordUpdate(
          keyword,
          row,
          input.duplicatePolicy,
          input.actorId,
          input.importId,
          row.targetUrl
            ? pages.ids.get(
                normalizePageUrl(row.targetUrl, "targetUrl").hash
              )
            : undefined
        );
        await transaction.keyword.update({
          where: { id: keyword.id },
          data: update
        });
        updatedKeywordIds.add(keyword.id);
      }

      const processedRows = input.rows.filter((row) => {
        const keyword = keywordByKey.get(
          keywordKey(row.language, row.normalizedHash)
        );
        return keyword && !skippedKeywordIds.has(keyword.id);
      });
      const keywordsWithExistingGroup =
        input.duplicatePolicy === "MERGE_NON_EMPTY" &&
        existingKeywords.length > 0
          ? new Set(
              (
                await transaction.keywordGroupMembership.findMany({
                  where: {
                    keywordId: {
                      in: existingKeywords.map(({ id }) => id)
                    }
                  },
                  select: { keywordId: true },
                  distinct: ["keywordId"]
                })
              ).map(({ keywordId }) => keywordId)
            )
          : new Set<string>();
      const overwrittenWithGroup = new Set<string>();
      const overwrittenWithTags = new Set<string>();
      for (const row of processedRows) {
        const keyword = keywordByKey.get(
          keywordKey(row.language, row.normalizedHash)
        )!;
        if (
          input.duplicatePolicy === "OVERWRITE_MAPPED" &&
          (row.groupPath?.length || row.groupPaths?.length)
        ) {
          overwrittenWithGroup.add(keyword.id);
        }
        if (
          input.duplicatePolicy === "OVERWRITE_MAPPED" &&
          row.tags?.length
        ) {
          overwrittenWithTags.add(keyword.id);
        }
      }
      if (overwrittenWithGroup.size > 0) {
        await transaction.keywordGroupMembership.deleteMany({
          where: { keywordId: { in: [...overwrittenWithGroup] } }
        });
      }
      if (overwrittenWithTags.size > 0) {
        await transaction.keywordTag.deleteMany({
          where: { keywordId: { in: [...overwrittenWithTags] } }
        });
      }
      const memberships = processedRows.flatMap((row) => {
        const keyword = keywordByKey.get(
          keywordKey(row.language, row.normalizedHash)
        );
        if (!keyword || keywordsWithExistingGroup.has(keyword.id)) return [];
        const groupPaths = row.groupPaths ??
          (row.groupPath ? [row.groupPath] : []);
        return groupPaths.flatMap((path) => {
          const groupId = groups.ids.get(groupPathKey(path));
          return groupId
            ? [{ projectId: input.projectId, keywordId: keyword.id, groupId }]
            : [];
        });
      });
      if (memberships.length > 0) {
        await transaction.keywordGroupMembership.createMany({
          data: memberships,
          skipDuplicates: true
        });
      }
      await ensureKeywordSystemGroupIds(
        transaction,
        input.workspaceId,
        input.projectId
      );
      const keywordTags = processedRows.flatMap((row) => {
        const keyword = keywordByKey.get(
          keywordKey(row.language, row.normalizedHash)
        );
        if (!keyword) return [];
        return (row.tags ?? []).flatMap((tag) => {
          const tagId = tags.ids.get(normalizeTag(tag));
          return tagId
            ? [{ projectId: input.projectId, keywordId: keyword.id, tagId }]
            : [];
        });
      });
      if (keywordTags.length > 0) {
        await transaction.keywordTag.createMany({
          data: keywordTags,
          skipDuplicates: true
        });
      }
      await applyTypedCustomValues(
        transaction,
        input,
        processedRows,
        keywordByKey,
        customColumns
      );
      const metricSnapshots = processedRows.flatMap((row) => {
        const keyword = keywordByKey.get(
          keywordKey(row.language, row.normalizedHash)
        );
        if (!keyword) return [];
        const observedAt = row.observedAt
          ? new Date(row.observedAt)
          : new Date();
        return (row.frequencies ?? []).map((frequency) => ({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          keywordId: keyword.id,
          type: frequency.type,
          regionCode: "global",
          device: "ALL",
          value: BigInt(frequency.value),
          observedAt,
          provider: "import",
          sourceMode: "IMPORT" as const,
          jobId: input.importId,
          qualityFlags: ["CONTEXT_INCOMPLETE"]
        }));
      });
      if (metricSnapshots.length > 0) {
        await transaction.frequencySnapshot.createMany({
          data: metricSnapshots
        });
      }
      await applyImportedCurrentRanks(
        transaction,
        input,
        processedRows,
        keywordByKey
      );
      const createdKeywordCount = input.rows.filter((row) =>
        createdKeys.has(keywordKey(row.language, row.normalizedHash))
      ).length;
      if (BigInt(createdKeywordCount) > availableReservation) {
        throw new Error(
          "Semantic import created more keywords than it reserved"
        );
      }
      await transaction.semanticImportReceipt.update({
        where: { importId: input.importId },
        data: {
          reservedKeywords:
            availableReservation - BigInt(createdKeywordCount)
        }
      });
      const chunk = await transaction.semanticImportChunkReceipt.create({
        data: {
          importId: input.importId,
          chunkIndex: input.chunkIndex,
          payloadHash: input.payloadHash,
          inputRows: input.rows.length,
          createdKeywords: createdKeywordCount,
          updatedKeywords: updatedKeywordIds.size,
          skippedKeywords: skippedKeywordIds.size,
          createdGroups: groups.created,
          createdPages: pages.created,
          createdTags: tags.created,
          createdMetricSnapshots: metricSnapshots.length,
          trashedDuplicateCandidates: json(trashedDuplicateCandidates)
        }
      });
      return chunkSummary(chunk);
    }, {
      maxWait: SEMANTIC_IMPORT_TRANSACTION_MAX_WAIT_MS,
      timeout: SEMANTIC_IMPORT_TRANSACTION_TIMEOUT_MS
    });
  }

  public async complete(
    input: InternalCompleteSemanticImportInput
  ): Promise<SemanticImportResultSummary> {
    return this.prisma.$transaction(async (transaction) => {
      await lockStoredKeywordCapacity(
        transaction,
        input.workspaceId
      );
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`semantic-version:${input.projectId}`}, 0)
        )
      `;
      const receipt = await transaction.semanticImportReceipt.findUnique({
        where: { importId: input.importId }
      });
      if (!receipt) {
        throw new NotFoundException("Semantic import receipt not found");
      }
      assertReceiptScope(receipt, input);
      if (receipt.status === "COMPLETED") {
        const result = resultSummary(receipt.resultSummary);
        if (!result) throw new Error("Completed import result is unavailable");
        return result;
      }
      const chunks = await transaction.semanticImportChunkReceipt.aggregate({
        where: { importId: input.importId },
        _count: { _all: true },
        _sum: {
          inputRows: true,
          createdKeywords: true,
          updatedKeywords: true,
          skippedKeywords: true,
          createdGroups: true,
          createdPages: true,
          createdTags: true,
          createdMetricSnapshots: true
        }
      });
      const chunkCandidates = await transaction.semanticImportChunkReceipt.findMany({
        where: { importId: input.importId },
        orderBy: { chunkIndex: "asc" },
        select: { trashedDuplicateCandidates: true }
      });
      const trashedDuplicateCandidates = chunkCandidates
        .flatMap(({ trashedDuplicateCandidates }) =>
          semanticImportTrashCandidates(trashedDuplicateCandidates)
        )
        .filter(
          (candidate, index, values) =>
            values.findIndex(({ keywordId }) => keywordId === candidate.keywordId) === index
        );
      if (
        (!input.partial &&
          (chunks._count._all !== receipt.expectedChunks ||
            BigInt(chunks._sum.inputRows ?? 0) !==
              receipt.expectedUniqueRows)) ||
        (input.partial && chunks._count._all === 0)
      ) {
        throw new ConflictException(
          "Semantic import has not received every expected chunk"
        );
      }
      const latestVersion = await transaction.semanticVersion.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId
        },
        orderBy: { number: "desc" },
        select: { id: true, number: true }
      });
      const affectedCount =
        Number(chunks._sum.createdKeywords ?? 0) +
        Number(chunks._sum.updatedKeywords ?? 0);
      const version = await transaction.semanticVersion.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          number: (latestVersion?.number ?? 0) + 1,
          reason: "IMPORT",
          actorId: input.actorId,
          sourceJobId: input.importId,
          ...(latestVersion
            ? { parentVersionId: latestVersion.id }
            : {}),
          summary: "Импорт семантического ядра",
          affectedCount,
          reversible: false,
          finalizedAt: new Date(),
          manifest: {
            importId: input.importId,
            mappingHash: receipt.mappingHash,
            duplicatePolicy: receipt.duplicatePolicy,
            partial: input.partial ?? false,
            receivedChunks: chunks._count._all,
            expectedChunks: receipt.expectedChunks,
            processedRows: String(chunks._sum.inputRows ?? 0),
            expectedUniqueRows: receipt.expectedUniqueRows.toString()
          }
        }
      });
      const result: SemanticImportResultSummary = {
        partial: input.partial ?? false,
        semanticVersionId: version.id,
        semanticVersionNumber: version.number,
        createdKeywords: String(chunks._sum.createdKeywords ?? 0),
        updatedKeywords: String(chunks._sum.updatedKeywords ?? 0),
        skippedKeywords: String(chunks._sum.skippedKeywords ?? 0),
        createdGroups: String(chunks._sum.createdGroups ?? 0),
        createdPages: String(chunks._sum.createdPages ?? 0),
        createdTags: String(chunks._sum.createdTags ?? 0),
        createdMetricSnapshots: String(
          chunks._sum.createdMetricSnapshots ?? 0
        ),
        ...(trashedDuplicateCandidates.length > 0
          ? {
              trashedDuplicateCandidates: trashedDuplicateCandidates.slice(0, 2_000),
              trashedDuplicateCandidatesTruncated:
                trashedDuplicateCandidates.length > 2_000
            }
          : {})
      };
      await transaction.semanticImportReceipt.update({
        where: { importId: input.importId },
        data: {
          status: "COMPLETED",
          reservedKeywords: 0n,
          semanticVersionId: version.id,
          resultSummary: json(result),
          completedAt: new Date()
        }
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: domainEventTypes.semanticVersionCreated,
          aggregateId: version.id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          payload: json({
            importId: input.importId,
            ...result
          }),
          metadata: {
            producer: "seo-data",
            source: "semantic-import"
          }
        }
      });
      return result;
    });
  }

  public async abort(
    input: InternalAbortSemanticImportInput
  ): Promise<InternalAbortSemanticImportResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockStoredKeywordCapacity(
        transaction,
        input.workspaceId
      );
      const receipt =
        await transaction.semanticImportReceipt.findUnique({
          where: { importId: input.importId },
          include: { _count: { select: { chunks: true } } }
        });
      if (!receipt) {
        return {
          importId: input.importId,
          status: "ABORTED",
          receivedChunks: 0
        };
      }
      assertReceiptScope(receipt, input);
      if (
        receipt.status === "COMPLETED" ||
        (receipt.status === "RECEIVING" &&
          receipt._count.chunks > 0)
      ) {
        return {
          importId: input.importId,
          status: receipt.status,
          receivedChunks: receipt._count.chunks
        };
      }
      if (receipt.status !== "ABORTED") {
        await transaction.semanticImportReceipt.update({
          where: { importId: input.importId },
          data: {
            status: "ABORTED",
            reservedKeywords: 0n,
            completedAt: new Date()
          }
        });
      }
      return {
        importId: input.importId,
        status: "ABORTED",
        receivedChunks: receipt._count.chunks
      };
    });
  }

  private async requiredReceipt(
    input: InternalApplySemanticImportChunkInput
  ): Promise<SemanticImportReceipt> {
    const receipt = await this.prisma.semanticImportReceipt.findUnique({
      where: { importId: input.importId }
    });
    if (!receipt) {
      throw new NotFoundException("Semantic import receipt not found");
    }
    assertReceiptScope(receipt, input);
    if (receipt.duplicatePolicy !== input.duplicatePolicy) {
      throw new ConflictException("Semantic import policy mismatch");
    }
    return receipt;
  }
}

async function ensureCustomColumns(
  transaction: Prisma.TransactionClient,
  input: InternalApplySemanticImportChunkInput,
  rows: readonly SemanticImportPublishRow[]
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  for (const row of rows) {
    for (const name of Object.keys(row.customValues)) {
      names.set(normalizeCustomColumnName(name), name.normalize("NFKC").trim());
    }
  }
  if (names.size === 0) return new Map();
  const normalizedNames = [...names.keys()];
  const existing = await transaction.semanticCustomColumn.findMany({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      status: "ACTIVE",
      normalizedName: { in: normalizedNames }
    },
    select: { id: true, normalizedName: true, type: true }
  });
  if (existing.some(({ type }) => type !== "LONG_TEXT")) {
    throw new ConflictException(
      "Imported custom column conflicts with an existing typed column"
    );
  }
  const existingNames = new Set(
    existing.map(({ normalizedName }) => normalizedName)
  );
  await transaction.semanticCustomColumn.createMany({
    data: [...names.entries()]
      .filter(([normalizedName]) => !existingNames.has(normalizedName))
      .map(([normalizedName, name]) => ({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        name,
        normalizedName,
        description: "Создано из импорта",
        type: "LONG_TEXT" as const,
        config: json({ required: false }),
        createdBy: input.actorId,
        updatedBy: input.actorId
      })),
    skipDuplicates: true
  });
  const final = await transaction.semanticCustomColumn.findMany({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      status: "ACTIVE",
      normalizedName: { in: normalizedNames }
    },
    select: { id: true, normalizedName: true, type: true }
  });
  if (
    final.length !== normalizedNames.length ||
    final.some(({ type }) => type !== "LONG_TEXT")
  ) {
    throw new ConflictException(
      "Imported custom columns could not be resolved safely"
    );
  }
  return new Map(final.map(({ normalizedName, id }) => [normalizedName, id]));
}

async function applyTypedCustomValues(
  transaction: Prisma.TransactionClient,
  input: InternalApplySemanticImportChunkInput,
  rows: readonly SemanticImportPublishRow[],
  keywordByKey: ReadonlyMap<string, Keyword>,
  columns: ReadonlyMap<string, string>
): Promise<void> {
  for (const row of rows) {
    const keyword = keywordByKey.get(
      keywordKey(row.language, row.normalizedHash)
    );
    if (!keyword) continue;
    for (const [name, value] of Object.entries(row.customValues)) {
      const columnId = columns.get(normalizeCustomColumnName(name));
      if (!columnId) {
        throw new Error("Imported custom column was not persisted");
      }
      if (input.duplicatePolicy === "MERGE_NON_EMPTY") {
        await transaction.semanticKeywordCustomValue.createMany({
          data: [
            {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              keywordId: keyword.id,
              columnId,
              textValue: value,
              updatedBy: input.actorId
            }
          ],
          skipDuplicates: true
        });
        continue;
      }
      await transaction.semanticKeywordCustomValue.upsert({
        where: {
          keywordId_columnId: { keywordId: keyword.id, columnId }
        },
        create: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          keywordId: keyword.id,
          columnId,
          textValue: value,
          updatedBy: input.actorId
        },
        update: {
          textValue: value,
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
    }
  }
}

function normalizeCustomColumnName(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

interface EnsuredEntities {
  readonly ids: ReadonlyMap<string, string>;
  readonly created: number;
}

async function ensurePages(
  transaction: Prisma.TransactionClient,
  input: InternalApplySemanticImportChunkInput,
  rows: readonly SemanticImportPublishRow[]
): Promise<EnsuredEntities> {
  const values = new Map<string, ReturnType<typeof normalizePageUrl>>();
  for (const row of rows) {
    if (!row.targetUrl) continue;
    const normalized = normalizePageUrl(row.targetUrl, "targetUrl");
    values.set(normalized.hash, normalized);
  }
  if (values.size === 0) return { ids: new Map(), created: 0 };
  const hashes = [...values.keys()];
  const existing = await transaction.page.findMany({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      urlHash: { in: hashes }
    },
    select: { id: true, urlHash: true, status: true }
  });
  if (existing.some(({ status }) => status !== "ACTIVE")) {
    throw new ConflictException(
      "An imported target URL belongs to an archived page"
    );
  }
  const existingHashes = new Set(existing.map(({ urlHash }) => urlHash));
  const created = await transaction.page.createMany({
    data: [...values.values()]
      .filter(({ hash }) => !existingHashes.has(hash))
      .map(({ original, normalized, hash }) => ({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        url: original,
        normalizedUrl: normalized,
        urlHash: hash,
        createdBy: input.actorId,
        updatedBy: input.actorId
      })),
    skipDuplicates: true
  });
  const final = await transaction.page.findMany({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      urlHash: { in: hashes }
    },
    select: { id: true, urlHash: true }
  });
  for (const page of final) {
    await transaction.pageSource.upsert({
      where: {
        pageId_source: { pageId: page.id, source: "IMPORT" }
      },
      create: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        pageId: page.id,
        source: "IMPORT"
      },
      update: { lastSeenAt: new Date() }
    });
  }
  return {
    ids: new Map(final.map(({ urlHash, id }) => [urlHash, id])),
    created: created.count
  };
}

async function ensureGroups(
  transaction: Prisma.TransactionClient,
  input: InternalApplySemanticImportChunkInput,
  rows: readonly SemanticImportPublishRow[],
  sourceGroupPaths: readonly (readonly string[])[],
  foldersPerProjectLimit: number
): Promise<EnsuredEntities> {
  const paths = new Map<
    string,
    { readonly segments: readonly string[]; readonly hash: string }
  >();
  for (const row of rows) {
    const rowGroupPaths = row.groupPaths ??
      (row.groupPath ? [row.groupPath] : []);
    for (const groupPath of rowGroupPaths) {
      for (let depth = 1; depth <= groupPath.length; depth += 1) {
        const segments = groupPath.slice(0, depth).map(normalizeGroupName);
        paths.set(groupPathKey(segments), {
          segments,
          hash: groupPathHash(segments)
        });
      }
    }
  }
  for (const groupPath of sourceGroupPaths) {
    for (let depth = 1; depth <= groupPath.length; depth += 1) {
      const segments = groupPath.slice(0, depth).map(normalizeGroupName);
      paths.set(groupPathKey(segments), {
        segments,
        hash: groupPathHash(segments)
      });
    }
  }
  const ordered = [...paths.values()].sort(
    (left, right) => left.segments.length - right.segments.length
  );
  if (foldersPerProjectLimit > 0 && ordered.length > 0) {
    const [activeGroups, existingPaths] = await Promise.all([
      transaction.keywordGroup.count({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          systemKind: null
        }
      }),
      transaction.keywordGroup.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          systemKind: null,
          pathHash: { in: ordered.map(({ hash }) => hash) }
        },
        select: { pathHash: true }
      })
    ]);
    const existingHashes = new Set(
      existingPaths.map(({ pathHash }) => pathHash)
    );
    const newGroupCount = ordered.filter(
      ({ hash }) => !existingHashes.has(hash)
    ).length;
    if (activeGroups + newGroupCount > foldersPerProjectLimit) {
      throw new ConflictException({
        code: "QUOTA_EXCEEDED",
        message: "Project folder limit exceeded",
        resource: "semantic_folders",
        current: activeGroups,
        requested: newGroupCount,
        limit: foldersPerProjectLimit
      });
    }
  }
  const ids = new Map<string, string>();
  let created = 0;
  for (const path of ordered) {
    const existing = await transaction.keywordGroup.findUnique({
      where: {
        projectId_pathHash: {
          projectId: input.projectId,
          pathHash: path.hash
        }
      },
      select: { id: true, status: true, systemKind: true }
    });
    if (existing) {
      if (existing.status !== "ACTIVE" || existing.systemKind !== null) {
        const parentSegments = path.segments.slice(0, -1);
        await transaction.keywordGroup.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            systemKind: null,
            name: path.segments.at(-1)!,
            path: path.segments.join(" / "),
            ...(parentSegments.length > 0 &&
            ids.get(groupPathKey(parentSegments))
              ? { parentId: ids.get(groupPathKey(parentSegments))! }
              : { parentId: null })
          }
        });
        created += 1;
      }
      ids.set(groupPathKey(path.segments), existing.id);
      continue;
    }
    const parentSegments = path.segments.slice(0, -1);
    const group = await transaction.keywordGroup.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ...(parentSegments.length > 0 &&
        ids.get(groupPathKey(parentSegments))
          ? { parentId: ids.get(groupPathKey(parentSegments))! }
          : {}),
        name: path.segments.at(-1)!,
        path: path.segments.join(" / "),
        pathHash: path.hash
      },
      select: { id: true }
    });
    ids.set(groupPathKey(path.segments), group.id);
    created += 1;
  }
  return { ids, created };
}

async function ensureTags(
  transaction: Prisma.TransactionClient,
  input: InternalApplySemanticImportChunkInput,
  rows: readonly SemanticImportPublishRow[]
): Promise<EnsuredEntities> {
  const values = new Map<string, string>();
  for (const row of rows) {
    for (const tag of row.tags ?? []) values.set(normalizeTag(tag), tag.trim());
  }
  if (values.size === 0) return { ids: new Map(), created: 0 };
  const normalizedNames = [...values.keys()];
  const existing = await transaction.tag.findMany({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      normalizedName: { in: normalizedNames }
    },
    select: { id: true, normalizedName: true }
  });
  const existingNames = new Set(
    existing.map(({ normalizedName }) => normalizedName)
  );
  const created = await transaction.tag.createMany({
    data: [...values.entries()]
      .filter(([normalizedName]) => !existingNames.has(normalizedName))
      .map(([normalizedName, name]) => ({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        name,
        normalizedName
      })),
    skipDuplicates: true
  });
  const final = await transaction.tag.findMany({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      normalizedName: { in: normalizedNames }
    },
    select: { id: true, normalizedName: true }
  });
  return {
    ids: new Map(final.map(({ normalizedName, id }) => [normalizedName, id])),
    created: created.count
  };
}

function keywordUpdate(
  keyword: Keyword,
  row: SemanticImportPublishRow,
  policy: SemanticImportDuplicatePolicy,
  actorId: string,
  importId: string,
  targetPageId: string | undefined
): Prisma.KeywordUpdateInput {
  const currentCustomValues = stringValues(keyword.customValues);
  const imported = row.customValues;
  const customValues =
    policy === "MERGE_NON_EMPTY"
      ? mergeMissingValues(currentCustomValues, imported)
      : {
          ...currentCustomValues,
          ...imported
        };
  return {
    ...(policy === "OVERWRITE_MAPPED"
      ? {
          textOriginal: row.textOriginal,
          ...(row.priority === undefined ? {} : { priority: row.priority }),
          ...(row.isFavorite === undefined
            ? {}
            : { isFavorite: row.isFavorite }),
          ...(row.intent === undefined ? {} : { intent: row.intent }),
          ...(targetPageId ? { targetPageId } : {})
        }
      : keyword.targetPageId || !targetPageId
        ? {
            ...(keyword.priority === 0 && row.priority !== undefined
              ? { priority: row.priority }
              : {}),
            ...(!keyword.isFavorite && row.isFavorite !== undefined
              ? { isFavorite: row.isFavorite }
              : {}),
            ...(keyword.intent === null && row.intent !== undefined
              ? { intent: row.intent }
              : {})
          }
        : {
            targetPageId,
            ...(keyword.priority === 0 && row.priority !== undefined
              ? { priority: row.priority }
              : {}),
            ...(!keyword.isFavorite && row.isFavorite !== undefined
              ? { isFavorite: row.isFavorite }
              : {}),
            ...(keyword.intent === null && row.intent !== undefined
              ? { intent: row.intent }
              : {})
          }),
    customValues: json(customValues),
    sourceMode: "IMPORT",
    sourceId: importId,
    updatedBy: actorId,
    status: "ACTIVE",
    version: { increment: 1 }
  };
}

function mergeMissingValues(
  current: Readonly<Record<string, string>>,
  imported: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  const result = { ...current };
  for (const [key, value] of Object.entries(imported)) {
    if (!result[key]?.trim()) result[key] = value;
  }
  return result;
}

function normalizeKeyword(
  rowNumber: string,
  text: string,
  language: string
): InternalNormalizedSemanticKeyword {
  const textOriginal = text.trim();
  const textNormalized = textOriginal
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
  if (!textNormalized) {
    throw new BadRequestException("Keyword is empty after normalization");
  }
  return {
    rowNumber,
    textOriginal,
    textNormalized,
    normalizedHash: sha256(textNormalized),
    language,
    existsInProject: false
  };
}

function normalizeGroupName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function groupPathKey(values: readonly string[]): string {
  return values.map(normalizeGroupName).join("\u001f");
}

function groupPathHash(values: readonly string[]): string {
  return sha256(
    values
      .map((value) => normalizeGroupName(value).toLowerCase())
      .join("\u001f")
  );
}

function normalizeTag(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function keywordKey(language: string, normalizedHash: string): string {
  return `${language}\u0000${normalizedHash}`;
}

async function applyImportedCurrentRanks(
  transaction: Prisma.TransactionClient,
  input: Pick<
    InternalApplySemanticImportChunkInput,
    "workspaceId" | "projectId" | "actorId" | "importId" | "chunkIndex"
  >,
  rows: readonly SemanticImportPublishRow[],
  keywordByKey: ReadonlyMap<string, Keyword>
): Promise<void> {
  const engines = [
    ...new Set(
      rows.flatMap((row) =>
        (row.positions ?? []).map(({ searchEngine }) => searchEngine)
      )
    )
  ];
  if (engines.length === 0) return;

  const importedAt = new Date();
  for (const engine of engines) {
    const context = await ensureImportedRankContext(
      transaction,
      input,
      engine
    );
    const byKeyword = new Map<
      string,
      {
        readonly keyword: Keyword;
        readonly found: boolean;
        readonly position: number | null;
        readonly rankingUrl: string | null;
        readonly normalizedRankingUrl: string | null;
      }
    >();
    for (const row of rows) {
      const keyword = keywordByKey.get(
        keywordKey(row.language, row.normalizedHash)
      );
      const position = (row.positions ?? []).find(
        (candidate) => candidate.searchEngine === engine
      );
      if (!keyword || !position) continue;
      const rankingUrl = position.rankingUrl ?? null;
      byKeyword.set(keyword.id, {
        keyword,
        found: position.found,
        position: position.position ?? null,
        rankingUrl,
        normalizedRankingUrl: rankingUrl
          ? normalizePageUrl(rankingUrl, "rankingUrl").normalized
          : null
      });
    }
    const candidates = [...byKeyword.values()];
    if (candidates.length === 0) continue;
    await persistImportedRankSnapshot(
      transaction,
      input,
      engine,
      context,
      candidates,
      importedAt
    );
  }
}

interface ImportedRankContext {
  readonly id: string;
  readonly version: number;
  readonly configurationVersion: number;
  readonly configurationHash: string;
}

interface ImportedRankCandidate {
  readonly keyword: Keyword;
  readonly found: boolean;
  readonly position: number | null;
  readonly rankingUrl: string | null;
  readonly normalizedRankingUrl: string | null;
}

async function persistImportedRankSnapshot(
  transaction: Prisma.TransactionClient,
  input: Pick<
    InternalApplySemanticImportChunkInput,
    "workspaceId" | "projectId" | "actorId" | "importId" | "chunkIndex"
  >,
  engine: "YANDEX" | "GOOGLE",
  context: ImportedRankContext,
  candidates: readonly ImportedRankCandidate[],
  importedAt: Date
): Promise<void> {
  const keywordIds = candidates.map(({ keyword }) => keyword.id);
  const existingAssignments =
    await transaction.trackingContextKeywordAssignment.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        contextId: context.id,
        keywordId: { in: keywordIds },
        removedAt: null
      },
      select: { id: true, keywordId: true }
    });
  const assignedKeywordIds = new Set(
    existingAssignments.map(({ keywordId }) => keywordId)
  );
  const missingAssignments = keywordIds.filter(
    (keywordId) => !assignedKeywordIds.has(keywordId)
  );
  if (missingAssignments.length > 0) {
    await transaction.trackingContextKeywordAssignment.createMany({
      data: missingAssignments.map((keywordId) => ({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        contextId: context.id,
        keywordId,
        assignedBy: input.actorId
      }))
    });
    await transaction.keyword.updateMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        id: { in: missingAssignments }
      },
      data: { isTracked: true }
    });
  }
  const assignments =
    await transaction.trackingContextKeywordAssignment.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        contextId: context.id,
        keywordId: { in: keywordIds },
        removedAt: null
      },
      select: { id: true, keywordId: true },
      orderBy: { assignedAt: "asc" }
    });
  const assignmentByKeyword = new Map(
    assignments.map((assignment) => [assignment.keywordId, assignment.id])
  );
  if (assignmentByKeyword.size !== candidates.length) {
    throw new Error("Unable to assign imported rank keywords");
  }

  const identity = `${input.importId}:${input.chunkIndex}:${engine}`;
  const manifestId = deterministicUuid(`kc4-manifest:${identity}`);
  const jobId = deterministicUuid(`kc4-job:${identity}`);
  const jobItemId = deterministicUuid(`kc4-job-item:${identity}`);
  const estimateId = deterministicUuid(`kc4-estimate:${identity}`);
  const chunkHash = sha256Bytes(`kc4-chunk:${identity}`);
  const providerRequestId = `kc4-import-${identity}`;
  const connectorVersion = "key-collector@import";
  const entries = candidates.map(({ keyword }, sequence) => ({
    id: deterministicUuid(`kc4-entry:${identity}:${keyword.id}`),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    manifestId,
    chunkIndex: 0,
    sequence,
    assignmentId: assignmentByKeyword.get(keyword.id)!,
    keywordId: keyword.id,
    keywordVersion: keyword.version,
    keywordText: keyword.textOriginal,
    keywordTextHash: sha256Bytes(keyword.textOriginal),
    language: keyword.language
  }));
  await transaction.rankExecutionManifest.create({
    data: {
      id: manifestId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      jobId,
      estimateId,
      sealedBy: input.actorId,
      requestHash: sha256Bytes(`kc4-request:${identity}`),
      provider: "KEY_COLLECTOR",
      operation: "POSITIONS",
      projectDomain: "key-collector-import.invalid",
      projectStatus: "ACTIVE",
      projectVersion: 1,
      trackingContextId: context.id,
      contextVersion: context.version,
      configurationVersion: context.configurationVersion,
      configurationHash: Buffer.from(context.configurationHash, "hex"),
      semanticScopeHash: sha256Bytes(`kc4-semantic-scope:${identity}`),
      scopeHash: sha256Bytes(`kc4-scope:${identity}`),
      hashSchemaVersion: "rank-manifest@1",
      manifestHash: sha256Bytes(`kc4-manifest-hash:${identity}`),
      deduplicationHash: sha256Bytes(`kc4-deduplication:${identity}`),
      pairCount: candidates.length,
      chunkCount: 1,
      chunkSize: candidates.length,
      execution: json({ source: "KC4", searchEngine: engine }),
      retention: json({
        normalizedRankHistory: "LONG_TERM",
        rawSerp: "NOT_COLLECTED"
      }),
      status: "BUILDING",
      sealedAt: importedAt,
      estimateExpiresAt: new Date(importedAt.getTime() + 86_400_000)
    }
  });
  await transaction.rankExecutionManifestChunk.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      manifestId,
      chunkIndex: 0,
      hashSchemaVersion: "rank-manifest-chunk@1",
      chunkHash,
      entryCount: entries.length
    }
  });
  await transaction.rankExecutionManifestEntry.createMany({ data: entries });
  await transaction.rankExecutionManifest.update({
    where: { id: manifestId },
    data: { status: "SEALED" }
  });

  const dataQualityFlags = json(["IMPORTED_KC4"]);
  const snapshots = candidates.map((candidate, sequence) => ({
    id: deterministicUuid(
      `kc4-snapshot:${identity}:${candidate.keyword.id}`
    ),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    keywordId: candidate.keyword.id,
    trackingContextId: context.id,
    configurationVersion: context.configurationVersion,
    manifestId,
    manifestEntryId: entries[sequence]!.id,
    chunkIndex: 0,
    sequence,
    jobId,
    jobItemId,
    observedAt: importedAt,
    found: candidate.found,
    position: candidate.position,
    rankingUrl: candidate.rankingUrl,
    normalizedRankingUrl: candidate.normalizedRankingUrl,
    resultType: candidate.found ? "ORGANIC" : null,
    serpFeatures: json([]),
    dataQualityFlags,
    provider: "KEY_COLLECTOR",
    sourceMode: "IMPORT" as const,
    providerRequestId,
    connectorVersion
  }));
  await transaction.rankSnapshot.createMany({ data: snapshots });

  const currentRanks = await transaction.currentRank.findMany({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      trackingContextId: context.id,
      keywordId: { in: keywordIds }
    }
  });
  const currentByKeyword = new Map(
    currentRanks.map((current) => [current.keywordId, current])
  );
  let currentUpdatedCount = 0;
  for (const snapshot of snapshots) {
    const current = currentByKeyword.get(snapshot.keywordId);
    if (current && current.observedAt >= importedAt) continue;
    const where = {
      workspaceId_projectId_keywordId_trackingContextId: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        keywordId: snapshot.keywordId,
        trackingContextId: context.id
      }
    } as const;
    const values = {
      configurationVersion: context.configurationVersion,
      observedAt: importedAt,
      snapshotId: snapshot.id,
      found: snapshot.found,
      position: snapshot.position,
      rankingUrl: snapshot.rankingUrl,
      normalizedRankingUrl: snapshot.normalizedRankingUrl,
      provider: "KEY_COLLECTOR",
      sourceMode: "IMPORT" as const,
      dataQualityFlags,
      updatedAt: importedAt
    };
    if (current) {
      await transaction.currentRank.update({
        where,
        data: {
          ...values,
          previousPosition: current.position,
          version: { increment: 1 }
        }
      });
    } else {
      await transaction.currentRank.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          keywordId: snapshot.keywordId,
          trackingContextId: context.id,
          previousPosition: null,
          ...values
        }
      });
    }
    currentUpdatedCount += 1;
  }
  await transaction.rankChunkIngestReceipt.create({
    data: {
      manifestId,
      chunkIndex: 0,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      jobId,
      jobItemId,
      ingestedBy: input.actorId,
      schemaVersion: "rank-ingest@1",
      ingestEnvelopeHash: sha256Bytes(`kc4-ingest:${identity}`),
      manifestChunkHash: chunkHash,
      provider: "KEY_COLLECTOR",
      operation: "POSITIONS",
      providerRequestId,
      connectorVersion,
      observedAt: importedAt,
      status: "APPLIED",
      persistedCount: snapshots.length,
      foundCount: snapshots.filter(({ found }) => found).length,
      notFoundCount: snapshots.filter(({ found }) => !found).length,
      currentUpdatedCount,
      currentSkippedCount: snapshots.length - currentUpdatedCount,
      appliedAt: importedAt
    }
  });
}

async function ensureImportedRankContext(
  transaction: Prisma.TransactionClient,
  input: Pick<
    InternalApplySemanticImportChunkInput,
    "workspaceId" | "projectId" | "actorId"
  >,
  searchEngine: "YANDEX" | "GOOGLE"
): Promise<ImportedRankContext> {
  const engineLabel = searchEngine === "YANDEX" ? "Яндекс" : "Google";
  const name = `Импорт Key Collector · ${engineLabel}`;
  const existing = await transaction.trackingContext.findFirst({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      name,
      status: "ACTIVE"
    },
    select: { id: true, version: true },
    orderBy: { createdAt: "asc" }
  });
  if (existing) {
    const configuration =
      await transaction.trackingContextVersion.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          contextId: existing.id,
          searchEngine
        },
        orderBy: { configurationVersion: "desc" },
        select: { configurationVersion: true, configurationHash: true }
      });
    if (!configuration) {
      throw new Error("Imported rank context has no matching configuration");
    }
    return { id: existing.id, version: existing.version, ...configuration };
  }

  const context = await transaction.trackingContext.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      name,
      createdBy: input.actorId,
      updatedBy: input.actorId
    },
    select: { id: true, version: true }
  });
  const configurationVersion = 1;
  const configurationHash = sha256(
    JSON.stringify({
      source: "KC4",
      searchEngine,
      countryCode: "RU",
      regionCode: "global",
      language: "ru",
      device: "DESKTOP",
      depth: 100,
      domainMatchMode: "ANY_PROJECT_MIRROR",
      safeSearch: false
    })
  );
  await transaction.trackingContextVersion.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      contextId: context.id,
      configurationVersion,
      searchEngine,
      countryCode: "RU",
      regionCode: "global",
      regionLabel: "Импорт Key Collector",
      language: "ru",
      device: "DESKTOP",
      depth: 100,
      domainMatchMode: "ANY_PROJECT_MIRROR",
      safeSearch: false,
      configurationHash,
      createdBy: input.actorId
    }
  });
  return { ...context, configurationVersion, configurationHash };
}

function payloadHash(
  rows: readonly SemanticImportPublishRow[],
  groupPaths?: readonly (readonly string[])[]
): string {
  return sha256(JSON.stringify(groupPaths ? { groupPaths, rows } : rows));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(sha256(value), "hex"));
}

function deterministicUuid(value: string): string {
  const hash = sha256(value).slice(0, 32).split("");
  hash[12] = "5";
  hash[16] = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = hash.join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function stringValues(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function assertReceiptCommand(
  receipt: SemanticImportReceipt,
  input: InternalBeginSemanticImportInput
): void {
  assertReceiptScope(receipt, input);
  if (
    receipt.mappingHash !== input.mappingHash ||
    receipt.duplicatePolicy !== input.duplicatePolicy ||
    receipt.expectedChunks !== input.expectedChunks ||
    receipt.expectedUniqueRows !== BigInt(input.expectedUniqueRows) ||
    receipt.planCode !== input.entitlement.planCode ||
    receipt.planVersion !== input.entitlement.planVersion ||
    receipt.storedKeywordsLimit !==
      BigInt(input.entitlement.storedKeywords) ||
    receipt.keywordsPerProjectLimit !==
      BigInt(input.entitlement.keywordsPerProject) ||
    receipt.foldersPerProjectLimit !==
      BigInt(input.entitlement.foldersPerProject)
  ) {
    throw new ConflictException(
      "Semantic import receipt already exists with another command"
    );
  }
}

function receiptEntitlement(
  receipt: SemanticImportReceipt
): InternalBeginSemanticImportInput["entitlement"] {
  return {
    planCode: receipt.planCode,
    planVersion: receipt.planVersion,
    storedKeywords: safeCapacityNumber(
      receipt.storedKeywordsLimit,
      "storedKeywordsLimit"
    ),
    keywordsPerProject: safeCapacityNumber(
      receipt.keywordsPerProjectLimit,
      "keywordsPerProjectLimit"
    ),
    foldersPerProject: safeNonNegativeCapacityNumber(
      receipt.foldersPerProjectLimit,
      "foldersPerProjectLimit"
    ),
    // This snapshot is only used for keyword-capacity enforcement.
    trackedContextPairs: 1
  };
}

function safeNonNegativeCapacityNumber(value: bigint, field: string): number {
  if (value < 0n) {
    throw new Error(`Stored ${field} is invalid`);
  }
  return value > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(value);
}

function safeCapacityNumber(value: bigint, field: string): number {
  if (value <= 0n) {
    throw new Error(`Stored ${field} is invalid`);
  }
  return value > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(value);
}

function assertReceiptScope(
  receipt: SemanticImportReceipt,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorId: string;
  }
): void {
  if (
    receipt.workspaceId !== input.workspaceId ||
    receipt.projectId !== input.projectId ||
    receipt.actorId !== input.actorId
  ) {
    throw new NotFoundException("Semantic import receipt not found");
  }
}

function assertChunkHash(
  chunk: SemanticImportChunkReceipt,
  payloadHashValue: string
): void {
  if (chunk.payloadHash !== payloadHashValue) {
    throw new ConflictException(
      "Semantic import chunk index was reused with another payload"
    );
  }
}

function receiptSummary(
  receipt: SemanticImportReceipt,
  receivedChunks: number
): InternalSemanticImportReceipt {
  return {
    importId: receipt.importId,
    status: receipt.status,
    receivedChunks,
    expectedChunks: receipt.expectedChunks
  };
}

function chunkSummary(
  chunk: SemanticImportChunkReceipt
): InternalSemanticImportChunkResult {
  return {
    chunkIndex: chunk.chunkIndex,
    createdKeywords: chunk.createdKeywords.toString(),
    updatedKeywords: chunk.updatedKeywords.toString(),
    skippedKeywords: chunk.skippedKeywords.toString(),
    createdGroups: chunk.createdGroups.toString(),
    createdPages: chunk.createdPages.toString(),
    createdTags: chunk.createdTags.toString(),
    createdMetricSnapshots: chunk.createdMetricSnapshots.toString(),
    trashedDuplicateCandidates: semanticImportTrashCandidates(
      chunk.trashedDuplicateCandidates
    )
  };
}

function resultSummary(value: unknown): SemanticImportResultSummary | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const stringFields = [
    "semanticVersionId",
    "createdKeywords",
    "updatedKeywords",
    "skippedKeywords",
    "createdGroups",
    "createdPages",
    "createdTags",
    "createdMetricSnapshots"
  ] as const;
  if (
    stringFields.some((field) => typeof record[field] !== "string") ||
    typeof record.partial !== "boolean" ||
    !Number.isSafeInteger(record.semanticVersionNumber) ||
    (record.trashedDuplicateCandidates !== undefined &&
      !Array.isArray(record.trashedDuplicateCandidates)) ||
    (record.trashedDuplicateCandidatesTruncated !== undefined &&
      typeof record.trashedDuplicateCandidatesTruncated !== "boolean")
  ) {
    return undefined;
  }
  return value as unknown as SemanticImportResultSummary;
}

function semanticImportTrashCandidates(value: unknown): Array<{
  readonly keywordId: string;
  readonly version: number;
  readonly text: string;
  readonly language: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) return [];
    const row = candidate as Readonly<Record<string, unknown>>;
    return typeof row.keywordId === "string" &&
      Number.isSafeInteger(row.version) &&
      Number(row.version) > 0 &&
      typeof row.text === "string" &&
      row.text.length > 0 &&
      row.text.length <= 2_000 &&
      typeof row.language === "string" &&
      row.language.length > 0 &&
      row.language.length <= 16
      ? [{
          keywordId: row.keywordId,
          version: Number(row.version),
          text: row.text,
          language: row.language
        }]
      : [];
  });
}
