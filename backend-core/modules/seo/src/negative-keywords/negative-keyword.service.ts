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
    const matchKeyword = compileNegativeKeywordMatcher(resolvedRules);
    const matches = rows.flatMap((row) => {
      const matchedWords = matchKeyword(row.textOriginal);
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
  return compileNegativeKeywordMatcher(rules)(text);
}

type NegativeKeywordMatcher = (text: string) => readonly string[];

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
    return candidates
      .filter((candidate) => matchesCandidate(
        comparable,
        subjectTokens,
        subjectKeys,
        candidate,
        rules
      ))
      .map(({ original }) => original);
  };
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
      : preciseRussianStem(normalized)
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

function preciseRussianStem(value: string): string {
  if (!/^[а-яе]+$/u.test(value) || value.length <= 3) return value;
  const firstVowel = value.search(/[аеиоуыэюя]/u);
  if (firstVowel < 0 || firstVowel === value.length - 1) return value;
  const prefix = value.slice(0, firstVowel + 1);
  let rv = value.slice(firstVowel + 1);

  const perfective = removeRussianSuffix(
    rv,
    /(?:ив|ивши|ившись|ыв|ывши|ывшись)$/u,
    /([ая])(?:в|вши|вшись)$/u
  );
  if (perfective === rv) {
    rv = rv.replace(/(?:ся|сь)$/u, "");
    const adjective = removeRussianSuffix(
      rv,
      /(?:ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/u
    );
    if (adjective !== rv) {
      rv = removeRussianSuffix(
        adjective,
        /(?:ивш|ывш|ующ)$/u,
        /([ая])(?:ем|нн|вш|ющ|щ)$/u
      );
    } else {
      const verb = removeRussianSuffix(
        rv,
        /(?:ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)$/u,
        /([ая])(?:ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ны|ть|ешь|нно)$/u
      );
      rv = verb === rv
        ? rv.replace(/(?:а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/u, "")
        : verb;
    }
  } else {
    rv = perfective;
  }

  rv = rv.replace(/и$/u, "");
  let stem = prefix + rv;
  const r2Start = russianRegionStart(stem, russianRegionStart(stem, 0));
  const derivational = /(ость|ост)$/u.exec(stem);
  if (derivational?.index !== undefined && derivational.index >= r2Start) {
    stem = stem.slice(0, derivational.index);
  }
  stem = stem.replace(/ейше$/u, "").replace(/нн$/u, "н").replace(/ь$/u, "");
  return stem.length >= 3 ? stem : value;
}

function removeRussianSuffix(
  value: string,
  unconditional: RegExp,
  conditional?: RegExp
): string {
  const removed = value.replace(unconditional, "");
  return removed !== value || !conditional ? removed : value.replace(conditional, "$1");
}

function russianRegionStart(value: string, from: number): number {
  for (let index = Math.max(0, from); index < value.length - 1; index += 1) {
    if (/[аеиоуыэюя]/u.test(value[index]!) && !/[аеиоуыэюя]/u.test(value[index + 1]!)) {
      return index + 2;
    }
  }
  return value.length;
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
