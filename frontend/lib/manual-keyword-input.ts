export interface ManualKeywordInputStats {
  readonly duplicates: number;
  readonly rows: readonly string[];
  readonly total: number;
  readonly unique: number;
  readonly uniqueRows: readonly string[];
}

export function manualKeywordInputStats(value: string): ManualKeywordInputStats {
  const rows = value
    .split(/\r?\n/u)
    .map((line) => line.normalize("NFKC").trim().replace(/\s+/gu, " "))
    .filter(Boolean);
  const uniqueRows = new Map<string, string>();
  for (const row of rows) {
    const key = row.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е");
    if (!uniqueRows.has(key)) uniqueRows.set(key, row);
  }
  return {
    duplicates: rows.length - uniqueRows.size,
    rows,
    total: rows.length,
    unique: uniqueRows.size,
    uniqueRows: [...uniqueRows.values()]
  };
}

export function manualKeywordTexts(
  value: string,
  skipDuplicates: boolean
): readonly string[] {
  const stats = manualKeywordInputStats(value);
  return skipDuplicates ? stats.uniqueRows : stats.rows;
}

export interface ManualKeywordBulkResultRow {
  readonly index: number;
  readonly outcome:
    | "CREATED"
    | "RESTORED"
    | "LINKED_EXISTING"
    | "SKIPPED_EXISTING"
    | "REJECTED_EXISTING"
      | "FAILED";
  readonly keywordId?: string;
  readonly version?: number;
  readonly trashed?: boolean;
}

export interface ManualKeywordBulkChunkResult {
  readonly selected: number;
  readonly created: number;
  readonly restored: number;
  readonly linked: number;
  readonly skipped: number;
  readonly rejected: number;
  readonly failed: number;
  readonly rows: readonly ManualKeywordBulkResultRow[];
}

export interface ManualKeywordBulkRunResult {
  readonly selected: number;
  readonly created: number;
  readonly restored: number;
  readonly linked: number;
  readonly skipped: number;
  readonly rejected: number;
  readonly failed: number;
  readonly retryRows: readonly string[];
  readonly trashCandidates: readonly ManualKeywordTrashCandidate[];
  readonly transportError?: unknown;
}

export interface ManualKeywordTrashCandidate {
  readonly index: number;
  readonly text: string;
  readonly keywordId: string;
  readonly version: number;
}

export const MANUAL_KEYWORD_BULK_CHUNK_SIZE = 100;

export function manualKeywordRetryRows(
  submittedRows: readonly string[],
  resultRows: readonly ManualKeywordBulkResultRow[]
): readonly string[] {
  return resultRows.flatMap((row) => {
    if (row.outcome !== "REJECTED_EXISTING" && row.outcome !== "FAILED") {
      return [];
    }
    const text = submittedRows[row.index];
    return text === undefined ? [] : [text];
  });
}

export async function runManualKeywordBulkChunks(
  submittedRows: readonly string[],
  submitChunk: (
    rows: readonly string[],
    offset: number
  ) => Promise<ManualKeywordBulkChunkResult>,
  chunkSize = MANUAL_KEYWORD_BULK_CHUNK_SIZE
): Promise<ManualKeywordBulkRunResult> {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 100) {
    throw new RangeError("chunkSize must be an integer between 1 and 100");
  }

  const summary = {
    selected: 0,
    created: 0,
    restored: 0,
    linked: 0,
    skipped: 0,
    rejected: 0,
    failed: 0
  };
  const retryIndices = new Set<number>();
  const trashCandidates: ManualKeywordTrashCandidate[] = [];

  for (let offset = 0; offset < submittedRows.length; offset += chunkSize) {
    const chunk = submittedRows.slice(offset, offset + chunkSize);
    let result: ManualKeywordBulkChunkResult;
    try {
      result = await submitChunk(chunk, offset);
      assertManualKeywordChunkResult(result, chunk.length);
    } catch (transportError) {
      for (let index = offset; index < submittedRows.length; index += 1) {
        retryIndices.add(index);
      }
      return {
        ...summary,
        retryRows: submittedRows.filter((_, index) => retryIndices.has(index)),
        trashCandidates,
        transportError
      };
    }

    summary.selected += result.selected;
    summary.created += result.created;
    summary.restored += result.restored;
    summary.linked += result.linked;
    summary.skipped += result.skipped;
    summary.rejected += result.rejected;
    summary.failed += result.failed;
    for (const row of result.rows) {
      if (row.outcome === "REJECTED_EXISTING" || row.outcome === "FAILED") {
        retryIndices.add(offset + row.index);
      }
      if (
        row.outcome === "SKIPPED_EXISTING" &&
        row.trashed === true &&
        typeof row.keywordId === "string" &&
        typeof row.version === "number"
      ) {
        const index = offset + row.index;
        const text = submittedRows[index];
        if (text !== undefined) {
          trashCandidates.push({
            index,
            text,
            keywordId: row.keywordId,
            version: row.version
          });
        }
      }
    }
  }

  return {
    ...summary,
    retryRows: submittedRows.filter((_, index) => retryIndices.has(index)),
    trashCandidates
  };
}

function assertManualKeywordChunkResult(
  result: ManualKeywordBulkChunkResult,
  expectedRows: number
): void {
  const indices = new Set(result.rows.map(({ index }) => index));
  const counted =
    result.created +
    result.restored +
    result.linked +
    result.skipped +
    result.rejected +
    result.failed;
  if (
    result.selected !== expectedRows ||
    counted !== expectedRows ||
    result.rows.length !== expectedRows ||
    indices.size !== expectedRows ||
    [...indices].some(
      (index) => !Number.isSafeInteger(index) || index < 0 || index >= expectedRows
    ) ||
    result.rows.some(
      (row) =>
        row.trashed === true &&
        (row.outcome !== "SKIPPED_EXISTING" ||
          typeof row.keywordId !== "string" ||
          !Number.isSafeInteger(row.version) ||
          Number(row.version) < 1)
    )
  ) {
    throw new Error("Bulk keyword response does not match the submitted chunk");
  }
}
