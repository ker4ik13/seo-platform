import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type {
  InternalApplySemanticNegativeKeywordsInput,
  InternalCreateSemanticNegativeKeywordPresetInput,
  InternalDeleteSemanticNegativeKeywordPresetInput,
  InternalSemanticNegativeKeywordCommandInput,
  InternalSemanticNegativeKeywordPreviewInput,
  InternalUpdateSemanticNegativeKeywordPresetInput,
  SemanticNegativeKeywordApplyResult,
  SemanticNegativeKeywordHighlightRange,
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
import { preciseRussianWordStem } from "../text-analysis/russian-word-form.js";

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

interface NegativeKeywordPreviewPlan {
  readonly preview: SemanticNegativeKeywordPreview;
  readonly batch: readonly SemanticNegativeKeywordMatch[];
}

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
          ignoreWordOrder: input.rules.ignoreWordOrder,
          ignorePunctuation: input.rules.ignorePunctuation,
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
                caseSensitive: input.rules.caseSensitive,
                ignoreWordOrder: input.rules.ignoreWordOrder,
                ignorePunctuation: input.rules.ignorePunctuation
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
    input: InternalSemanticNegativeKeywordPreviewInput
  ): Promise<SemanticNegativeKeywordPreview> {
    return (await this.buildPreview(input)).preview;
  }

  public async apply(
    input: InternalApplySemanticNegativeKeywordsInput
  ): Promise<SemanticNegativeKeywordApplyResult> {
    const plan = await this.buildPreview(input);
    const preview = plan.preview;
    if (preview.previewHash !== input.previewHash) {
      throw new HttpException(
        {
          code: "RESOURCE_STATE_CONFLICT",
          message: "Negative keyword preview is no longer current"
        },
        HttpStatus.CONFLICT
      );
    }
    if (preview.batchCount === 0) {
      return { deletedCount: 0, deletedKeywordIds: [], hasMore: false };
    }
    const batchIds = plan.batch.map(({ keywordId }) => keywordId);
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
        plan.batch.map((match) => [match.keywordId, match.version])
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
    return { deletedCount, deletedKeywordIds: batchIds, hasMore: preview.hasMore };
  }

  private async buildPreview(
    input: InternalSemanticNegativeKeywordCommandInput &
      Partial<Pick<InternalSemanticNegativeKeywordPreviewInput, "page" | "pageSize">>
  ): Promise<NegativeKeywordPreviewPlan> {
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
    const matchKeyword = compileNegativeKeywordMatcher(resolvedRules);
    const matches = rows.flatMap((row) => {
      const match = matchKeyword(row.textOriginal);
      return match.matchedWords.length === 0
        ? []
        : [{
            keywordId: row.id,
            text: row.textOriginal,
            version: row.version,
            matchedWords: match.matchedWords,
            highlightRanges: match.highlightRanges
          } satisfies SemanticNegativeKeywordMatch];
    });
    const batch = matches.slice(0, APPLY_BATCH_SIZE);
    const pageSize = input.pageSize ?? 100;
    const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
    const page = Math.min(input.page ?? 1, pageCount);
    const pageMatches = matches.slice(
      (page - 1) * pageSize,
      page * pageSize
    );
    const preview = {
      scannedCount: rows.length,
      matchedCount: matches.length,
      batchCount: batch.length,
      hasMore: matches.length > batch.length,
      previewHash: previewHash(resolvedRules, input.scope, batch),
      matches: pageMatches,
      matchesTruncated: matches.length > pageMatches.length,
      page,
      pageSize,
      pageCount
    } satisfies SemanticNegativeKeywordPreview;
    return { preview, batch };
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
        caseSensitive: row.caseSensitive,
        ignoreWordOrder: row.ignoreWordOrder,
        ignorePunctuation: row.ignorePunctuation
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
  return compileNegativeKeywordMatcher(rules)(text).matchedWords;
}

export function negativeKeywordHighlightRanges(
  text: string,
  rules: SemanticNegativeKeywordRules
): readonly SemanticNegativeKeywordHighlightRange[] {
  return compileNegativeKeywordMatcher(rules)(text).highlightRanges;
}

interface NegativeKeywordMatchResult {
  readonly matchedWords: readonly string[];
  readonly highlightRanges: readonly SemanticNegativeKeywordHighlightRange[];
}

type NegativeKeywordMatcher = (text: string) => NegativeKeywordMatchResult;

interface ComparableToken {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

interface CompiledNegativeKeyword {
  readonly original: string;
  readonly comparable: string;
  readonly tokens: readonly ComparableToken[];
  readonly tokenKeys: readonly string[];
  readonly boundaryPattern: RegExp;
}

function compileNegativeKeywordMatcher(
  rules: SemanticNegativeKeywordRules
): NegativeKeywordMatcher {
  const candidates = rules.words.map((word) => {
    const comparable = comparableText(word, rules);
    const tokens = comparableTokens(comparable);
    return {
      original: word,
      comparable,
      tokens,
      tokenKeys: tokens.map(({ value }) => tokenKey(value, rules)),
      boundaryPattern: wholeValuePattern(comparable)
    } satisfies CompiledNegativeKeyword;
  });

  return (text) => {
    const comparable = comparableText(text, rules);
    const subjectTokens = comparableTokens(comparable);
    const subjectKeys = subjectTokens.map(({ value }) => tokenKey(value, rules));
    const matched = candidates.filter((candidate) => matchesCandidate(
        comparable,
        subjectTokens,
        subjectKeys,
        candidate,
        rules
      ));
    return {
      matchedWords: matched.map(({ original }) => original),
      highlightRanges: matchedHighlightRanges(text, matched, rules)
    };
  };
}

interface SourceToken {
  readonly value: string;
  readonly comparable: string;
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

function matchedHighlightRanges(
  text: string,
  candidates: readonly CompiledNegativeKeyword[],
  rules: SemanticNegativeKeywordRules
): readonly SemanticNegativeKeywordHighlightRange[] {
  if (text.length === 0 || candidates.length === 0) return [];
  const sourceTokens = sourceComparableTokens(text, rules);
  const ranges = candidates.flatMap((candidate) => {
    if (rules.matchMode === "EXACT_PHRASE") {
      return [{ start: 0, end: text.length }];
    }
    const tokenIndexes = matchingSourceTokenIndexes(
      sourceTokens,
      candidate,
      rules
    );
    return tokenIndexes.map((index) => {
      const token = sourceTokens[index]!;
      if (
        rules.matchMode === "CONTAINS" &&
        candidate.tokens.length === 1
      ) {
        const fragment = candidate.tokens[0]!.value;
        const offset = token.comparable.indexOf(fragment);
        if (
          offset >= 0 &&
          token.comparable.length === token.end - token.start
        ) {
          return {
            start: token.start + offset,
            end: token.start + offset + fragment.length
          };
        }
      }
      return { start: token.start, end: token.end };
    });
  });
  return mergeHighlightRanges(ranges, text.length);
}

function sourceComparableTokens(
  text: string,
  rules: SemanticNegativeKeywordRules
): readonly SourceToken[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => {
    const start = match.index;
    const value = match[0];
    const comparable = comparableText(value, rules);
    return {
      value,
      comparable,
      key: tokenKey(comparable, rules),
      start,
      end: start + value.length
    };
  });
}

function matchingSourceTokenIndexes(
  subject: readonly SourceToken[],
  candidate: CompiledNegativeKeyword,
  rules: SemanticNegativeKeywordRules
): readonly number[] {
  const tokenMatches = (token: SourceToken, candidateIndex: number) =>
    rules.matchMode === "CONTAINS"
      ? token.comparable.includes(candidate.tokens[candidateIndex]!.value)
      : token.key === candidate.tokenKeys[candidateIndex];
  if (rules.ignoreWordOrder && candidate.tokens.length > 1) {
    const used = new Set<number>();
    for (let candidateIndex = 0; candidateIndex < candidate.tokens.length; candidateIndex += 1) {
      const subjectIndex = subject.findIndex(
        (token, index) => !used.has(index) && tokenMatches(token, candidateIndex)
      );
      if (subjectIndex < 0) return [];
      used.add(subjectIndex);
    }
    return [...used].sort((left, right) => left - right);
  }
  for (
    let start = 0;
    start <= subject.length - candidate.tokens.length;
    start += 1
  ) {
    if (
      candidate.tokens.every((_, offset) =>
        tokenMatches(subject[start + offset]!, offset)
      )
    ) {
      return candidate.tokens.map((_, offset) => start + offset);
    }
  }
  return [];
}

function mergeHighlightRanges(
  values: readonly SemanticNegativeKeywordHighlightRange[],
  textLength: number
): readonly SemanticNegativeKeywordHighlightRange[] {
  const sorted = values
    .filter(({ start, end }) => start >= 0 && end > start && end <= textLength)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const ranges: SemanticNegativeKeywordHighlightRange[] = [];
  for (const range of sorted) {
    const previous = ranges.at(-1);
    if (previous && range.start <= previous.end) {
      ranges[ranges.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, range.end)
      };
    } else {
      ranges.push(range);
    }
  }
  return ranges;
}

function matchesCandidate(
  subject: string,
  subjectTokens: readonly ComparableToken[],
  subjectKeys: readonly string[],
  candidate: CompiledNegativeKeyword,
  rules: SemanticNegativeKeywordRules
): boolean {
  if (!candidate.comparable || candidate.tokens.length === 0) return false;
  if (rules.ignoreWordOrder && candidate.tokens.length > 1) {
    if (
      !rules.ignorePunctuation &&
      punctuationSignature(subject) !== punctuationSignature(candidate.comparable)
    ) return false;
    if (rules.matchMode === "CONTAINS") {
      return containsUnorderedFragments(
        subjectTokens.map(({ value }) => value),
        candidate.tokens.map(({ value }) => value)
      );
    }
    const exactSize = rules.matchMode === "EXACT_PHRASE";
    return containsTokenMultiset(subjectKeys, candidate.tokenKeys, exactSize);
  }
  if (rules.matchMode === "CONTAINS") {
    return subject.includes(candidate.comparable);
  }
  if (rules.matchMode === "EXACT_PHRASE") {
    return subject === candidate.comparable;
  }
  if (rules.matchMode === "WHOLE_WORD") {
    return candidate.boundaryPattern.test(subject);
  }
  return containsTokenSequence(
    subject,
    subjectTokens,
    subjectKeys,
    candidate,
    rules.ignorePunctuation
  );
}

function punctuationSignature(value: string): string {
  return [...value.matchAll(/[\p{P}\p{S}]/gu)].map((match) => match[0]).sort().join("");
}

function comparableText(value: string, rules: SemanticNegativeKeywordRules): string {
  let comparable = value.normalize("NFKC");
  if (
    rules.matchMode === "WORD_FORM_FAST" ||
    rules.matchMode === "WORD_FORM_PRECISE"
  ) {
    comparable = comparable.replace(/Ё/gu, "Е").replace(/ё/gu, "е");
  }
  if (!rules.caseSensitive) comparable = comparable.toLocaleLowerCase("ru-RU");
  if (rules.ignorePunctuation) {
    comparable = comparable.replace(/[\p{P}\p{S}]+/gu, " ");
  }
  return comparable.replace(/\s+/gu, " ").trim();
}

function comparableTokens(value: string): readonly ComparableToken[] {
  const tokens: ComparableToken[] = [];
  const matcher = /[\p{L}\p{N}]+/gu;
  for (const match of value.matchAll(matcher)) {
    const start = match.index;
    tokens.push({ value: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

function wholeValuePattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "u");
}

function tokenKey(value: string, rules: SemanticNegativeKeywordRules): string {
  if (rules.matchMode !== "WORD_FORM_FAST" && rules.matchMode !== "WORD_FORM_PRECISE") {
    return value;
  }
  const casePrefix = rules.caseSensitive ? `${wordCase(value)}:` : "";
  const normalized = value.toLocaleLowerCase("ru-RU");
  return casePrefix + (
    rules.matchMode === "WORD_FORM_FAST"
      ? fastRussianStem(normalized)
      : preciseRussianWordStem(normalized)
  );
}

function wordCase(value: string): "LOWER" | "UPPER" | "TITLE" | "MIXED" {
  if (value === value.toLocaleLowerCase("ru-RU")) return "LOWER";
  if (value === value.toLocaleUpperCase("ru-RU")) return "UPPER";
  const [first = "", ...rest] = [...value];
  if (
    first === first.toLocaleUpperCase("ru-RU") &&
    rest.join("") === rest.join("").toLocaleLowerCase("ru-RU")
  ) return "TITLE";
  return "MIXED";
}

function containsTokenSequence(
  subject: string,
  subjectTokens: readonly ComparableToken[],
  subjectKeys: readonly string[],
  candidate: CompiledNegativeKeyword,
  ignorePunctuation: boolean
): boolean {
  if (candidate.tokenKeys.length > subjectKeys.length) return false;
  for (let start = 0; start <= subjectKeys.length - candidate.tokenKeys.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < candidate.tokenKeys.length; offset += 1) {
      if (subjectKeys[start + offset] !== candidate.tokenKeys[offset]) {
        matches = false;
        break;
      }
      if (ignorePunctuation || offset === 0) continue;
      const subjectGap = subject.slice(
        subjectTokens[start + offset - 1]!.end,
        subjectTokens[start + offset]!.start
      );
      const candidateGap = candidate.comparable.slice(
        candidate.tokens[offset - 1]!.end,
        candidate.tokens[offset]!.start
      );
      if (subjectGap !== candidateGap) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function containsTokenMultiset(
  subject: readonly string[],
  candidate: readonly string[],
  exactSize: boolean
): boolean {
  if (candidate.length > subject.length || (exactSize && candidate.length !== subject.length)) {
    return false;
  }
  const available = new Map<string, number>();
  for (const key of subject) available.set(key, (available.get(key) ?? 0) + 1);
  for (const key of candidate) {
    const count = available.get(key) ?? 0;
    if (count === 0) return false;
    available.set(key, count - 1);
  }
  return true;
}

function containsUnorderedFragments(
  subject: readonly string[],
  candidate: readonly string[]
): boolean {
  if (candidate.length > subject.length) return false;
  const orderedCandidates = [...candidate].sort((left, right) => right.length - left.length);
  const used = new Set<number>();
  const findMatch = (candidateIndex: number): boolean => {
    if (candidateIndex === orderedCandidates.length) return true;
    const fragment = orderedCandidates[candidateIndex]!;
    for (let index = 0; index < subject.length; index += 1) {
      if (used.has(index) || !subject[index]!.includes(fragment)) continue;
      used.add(index);
      if (findMatch(candidateIndex + 1)) return true;
      used.delete(index);
    }
    return false;
  };
  return findMatch(0);
}

const FAST_RUSSIAN_SUFFIXES = [
  "остью", "ениями", "аниями", "иями", "ение", "ания", "ого", "его", "ому",
  "ему", "ыми", "ими", "ями", "ами", "иться", "ыться", "аться", "яться",
  "еться", "ить", "ыть", "ать", "ять", "еть", "ия", "ья", "ию", "ью",
  "иях", "ах", "ях", "ов", "ев", "ей", "ам", "ям", "ом", "ем", "ой",
  "ий", "ый", "ая", "яя", "ое", "ее", "ые", "ие", "их", "ых", "ок",
  "ся", "сь", "у", "ю", "а", "я", "ы", "и", "е", "ь"
] as const;

function fastRussianStem(value: string): string {
  if (!/^[а-яе]+$/u.test(value) || value.length <= 3) return value;
  if (value.endsWith("ок") && value.length > 3) {
    return `${value.slice(0, -2)}к`;
  }
  for (const suffix of FAST_RUSSIAN_SUFFIXES) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 3) {
      return value.slice(0, -suffix.length);
    }
  }
  return value;
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
      caseSensitive: row.caseSensitive,
      ignoreWordOrder: row.ignoreWordOrder,
      ignorePunctuation: row.ignorePunctuation
    },
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function matchMode(value: string): SemanticNegativeKeywordRules["matchMode"] {
  if (
    value === "CONTAINS" ||
    value === "WHOLE_WORD" ||
    value === "EXACT_PHRASE" ||
    value === "WORD_FORM_FAST" ||
    value === "WORD_FORM_PRECISE"
  ) return value;
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
