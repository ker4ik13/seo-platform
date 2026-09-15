import type {
  SemanticImportDelimiter,
  SemanticImportEncoding,
  SemanticImportHeaderMode
} from "@seo-platform/contracts";

const SAMPLE_BYTES = 64 * 1_024;
const DEFAULT_MAX_COLUMNS = 500;
const DEFAULT_MAX_FIELD_CHARS = 1_000_000;
const DEFAULT_MAX_ROW_CHARS = 8_000_000;

export type DetectedImportEncoding = Exclude<
  SemanticImportEncoding,
  "AUTO"
>;
export type DetectedImportDelimiter = Exclude<
  SemanticImportDelimiter,
  "AUTO"
>;

export class DelimitedParseError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "DelimitedParseError";
  }
}

export async function prepareDelimitedText(
  source: AsyncIterable<Uint8Array>,
  requestedEncoding: SemanticImportEncoding
): Promise<{
  readonly encoding: DetectedImportEncoding;
  readonly sampleText: string;
  readonly text: AsyncIterable<string>;
}> {
  const iterator = source[Symbol.asyncIterator]();
  const buffered: Uint8Array[] = [];
  let bufferedBytes = 0;
  let done = false;
  while (bufferedBytes < SAMPLE_BYTES && !done) {
    const next = await iterator.next();
    done = Boolean(next.done);
    if (!next.done) {
      const chunk = Uint8Array.from(next.value);
      buffered.push(chunk);
      bufferedBytes += chunk.byteLength;
    }
  }
  const sample = concatBytes(buffered).subarray(0, SAMPLE_BYTES);
  const encoding = detectTextEncoding(sample, requestedEncoding);
  const sampleText = decodeSample(sample, encoding);

  async function* text(): AsyncGenerator<string> {
    const decoder = new TextDecoder(encodingLabel(encoding), {
      fatal: encoding === "UTF_8"
    });
    let first = true;
    try {
      for (const chunk of buffered) {
        const decoded = decoder.decode(chunk, { stream: true });
        if (decoded) {
          yield first ? withoutBom(decoded) : decoded;
          first = false;
        }
      }
      while (!done) {
        const next = await iterator.next();
        done = Boolean(next.done);
        if (!next.done) {
          const decoded = decoder.decode(next.value, { stream: true });
          if (decoded) {
            yield first ? withoutBom(decoded) : decoded;
            first = false;
          }
        }
      }
      const tail = decoder.decode();
      if (tail) yield first ? withoutBom(tail) : tail;
    } catch (error) {
      if (error instanceof TypeError) {
        throw new DelimitedParseError("INVALID_TEXT_ENCODING");
      }
      throw error;
    } finally {
      if (!done) await iterator.return?.();
    }
  }

  return {
    encoding,
    sampleText,
    text: text()
  };
}

export function detectTextEncoding(
  sample: Uint8Array,
  requested: SemanticImportEncoding
): DetectedImportEncoding {
  if (requested !== "AUTO") return requested;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample, {
      stream: true
    });
    return "UTF_8";
  } catch {
    return "WINDOWS_1251";
  }
}

export function detectDelimiter(
  sampleText: string,
  requested: SemanticImportDelimiter,
  fallback: DetectedImportDelimiter
): DetectedImportDelimiter {
  if (requested !== "AUTO") return requested;
  const candidates = [
    ["TAB", "\t"],
    ["SEMICOLON", ";"],
    ["COMMA", ","]
  ] as const;
  const scored = candidates.map(([name, delimiter]) => ({
    name,
    score: delimiterScore(sampleText, delimiter)
  }));
  scored.sort((left, right) => right.score - left.score);
  return scored[0] && scored[0].score > 0
    ? scored[0].name
    : fallback;
}

export function delimiterCharacter(
  delimiter: DetectedImportDelimiter
): string {
  if (delimiter === "TAB") return "\t";
  if (delimiter === "SEMICOLON") return ";";
  return ",";
}

export async function* parseDelimitedText(
  source: AsyncIterable<string>,
  delimiter: string,
  limits: {
    readonly maxColumns?: number;
    readonly maxFieldChars?: number;
    readonly maxRowChars?: number;
  } = {}
): AsyncGenerator<readonly string[]> {
  const maxColumns = limits.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const maxFieldChars =
    limits.maxFieldChars ?? DEFAULT_MAX_FIELD_CHARS;
  const maxRowChars = limits.maxRowChars ?? DEFAULT_MAX_ROW_CHARS;
  let row: string[] = [];
  let field = "";
  let rowChars = 0;
  let inQuotes = false;
  let quotePending = false;
  let skipLf = false;
  let rowStarted = false;

  function append(value: string): void {
    field += value;
    if (field.length > maxFieldChars) {
      throw new DelimitedParseError("FIELD_TOO_LARGE");
    }
  }

  function endField(): void {
    row.push(field);
    field = "";
    if (row.length > maxColumns) {
      throw new DelimitedParseError("TOO_MANY_COLUMNS");
    }
  }

  function endRow(): readonly string[] {
    endField();
    const completed = row;
    row = [];
    rowChars = 0;
    rowStarted = false;
    return completed;
  }

  for await (const chunk of source) {
    for (const character of chunk) {
      if (skipLf) {
        skipLf = false;
        if (character === "\n") continue;
      }
      rowChars += 1;
      if (rowChars > maxRowChars) {
        throw new DelimitedParseError("ROW_TOO_LARGE");
      }

      if (inQuotes) {
        if (!quotePending) {
          if (character === "\"") quotePending = true;
          else append(character);
          rowStarted = true;
          continue;
        }
        if (character === "\"") {
          append("\"");
          quotePending = false;
          rowStarted = true;
          continue;
        }
        inQuotes = false;
        quotePending = false;
        if (
          character !== delimiter &&
          character !== "\r" &&
          character !== "\n"
        ) {
          throw new DelimitedParseError("INVALID_QUOTE");
        }
      }

      if (character === delimiter) {
        endField();
        rowStarted = true;
      } else if (character === "\r") {
        yield endRow();
        skipLf = true;
      } else if (character === "\n") {
        yield endRow();
      } else if (character === "\"" && field.length === 0) {
        inQuotes = true;
        rowStarted = true;
      } else {
        append(character);
        rowStarted = true;
      }
    }
  }

  if (inQuotes && !quotePending) {
    throw new DelimitedParseError("UNTERMINATED_QUOTE");
  }
  if (rowStarted || row.length > 0 || field.length > 0) {
    yield endRow();
  }
}

export function resolveHeaderMode(
  rows: readonly (readonly string[])[],
  requested: SemanticImportHeaderMode
): Exclude<SemanticImportHeaderMode, "AUTO"> {
  if (requested !== "AUTO") return requested;
  const first = rows[0];
  if (!first) return "ABSENT";
  if (first.some((value) => suggestedTarget(value).confidence >= 0.8)) {
    return "PRESENT";
  }
  const second = rows[1];
  if (!second) return "PRESENT";
  const firstMostlyLabels =
    first.filter((value) => value.trim() && !looksNumeric(value)).length >=
    Math.ceil(first.length * 0.7);
  const secondHasData = second.some(
    (value) => looksNumeric(value) || /^https?:\/\//iu.test(value.trim())
  );
  return firstMostlyLabels && secondHasData ? "PRESENT" : "ABSENT";
}

export function importHeaders(
  firstRow: readonly string[] | undefined,
  mode: Exclude<SemanticImportHeaderMode, "AUTO">
): readonly string[] {
  const width = firstRow?.length ?? 0;
  if (mode === "ABSENT") {
    return Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  }
  return (firstRow ?? []).map(
    (value, index) => value.trim() || `Column ${index + 1}`
  );
}

export function suggestColumnMapping(
  headers: readonly string[]
): readonly {
  readonly index: number;
  readonly sourceName: string;
  readonly suggestedTarget: string;
  readonly confidence: number;
}[] {
  return headers.map((sourceName, index) => ({
    index,
    sourceName,
    ...suggestedTarget(sourceName)
  }));
}

function suggestedTarget(header: string): {
  readonly suggestedTarget: string;
  readonly confidence: number;
} {
  const raw = header.normalize("NFKC").toLowerCase().replace(/ё/gu, "е");
  // Native KC4-only columns deliberately carry this prefix. Their words may
  // resemble ordinary fields (for example, a metric named `Label` or a group
  // comment), but they must stay custom instead of stealing a singleton
  // mapping such as tags or group.path.
  if (/^key collector\s*·/u.test(raw.trim())) {
    return { suggestedTarget: "custom", confidence: 0.99 };
  }
  const yandex = /(яндекс|yandex)/u.test(raw);
  const google = /(google|гугл)/u.test(raw);
  const positionChange =
    /(изменен|change|дельт|рел(?:ативн)?\.?\s*позици)/u.test(raw);
  const positionUrl =
    /(url|урл|ссылк).*(позици|выдач|serp)|(позици|выдач|serp).*(url|урл|ссылк)/u.test(
      raw
    );
  const relevantUrl =
    /(релевантн).*(url|урл|ссылк|страниц)/u.test(raw);

  // Key Collector puts the engine suffix after the field name in XLSX
  // exports (for example, `Рел. позиция [Yandex]`). Engine detection must
  // therefore be independent from the order of words in the header.
  if (yandex && positionChange) {
    return { suggestedTarget: "ranking.yandex.change", confidence: 0.99 };
  }
  if (google && positionChange) {
    return { suggestedTarget: "ranking.google.change", confidence: 0.99 };
  }
  if (relevantUrl) {
    return { suggestedTarget: "page.target_url", confidence: 0.99 };
  }
  if (yandex && positionUrl) {
    return { suggestedTarget: "ranking.yandex.url", confidence: 0.99 };
  }
  if (google && positionUrl) {
    return { suggestedTarget: "ranking.google.url", confidence: 0.99 };
  }
  if (yandex && /(позици|position|rank)/u.test(raw)) {
    return { suggestedTarget: "ranking.yandex.position", confidence: 0.99 };
  }
  if (google && /(позици|position|rank)/u.test(raw)) {
    return { suggestedTarget: "ranking.google.position", confidence: 0.99 };
  }
  if (/^["«]\s*!\s*["»]\s*\[(?:yw|wordstat)\]$/u.test(raw)) {
    return { suggestedTarget: "frequency.fixed", confidence: 0.99 };
  }
  if (/^["«]\s*["»]\s*\[(?:yw|wordstat)\]$/u.test(raw)) {
    return { suggestedTarget: "frequency.exact", confidence: 0.99 };
  }
  if (/^база\s*\[(?:yw|wordstat)\]$/u.test(raw)) {
    return { suggestedTarget: "frequency.base", confidence: 0.99 };
  }
  if (/(?:"|«)\s*!.*(?:частот|wordstat|frequency)/u.test(raw)) {
    return { suggestedTarget: "frequency.fixed", confidence: 0.99 };
  }
  if (/(?:"|«).*?(?:частот|wordstat|frequency)/u.test(raw)) {
    return { suggestedTarget: "frequency.exact", confidence: 0.98 };
  }
  const value = normalizeHeader(header);
  const rules: readonly [RegExp, string, number][] = [
    [
      /^(фраза|ключ(?:евая)? фраза|ключевое слово|запрос|keyword|query)$/u,
      "keyword.text",
      0.99
    ],
    [/(группа|папка|категория|group|folder)/u, "group.path", 0.96],
    [
      /(релевантн.*(?:url|страниц)|целевая страниц|target url|landing)/u,
      "page.target_url",
      0.94
    ],
    [
      /((точн|кавыч).*(частот|frequency)|(частот|frequency).*(точн|кавыч))/u,
      "frequency.exact",
      0.9
    ],
    [
      /((фикс|восклиц).*(частот|frequency)|(частот|frequency).*(фикс|восклиц))/u,
      "frequency.fixed",
      0.9
    ],
    [/(частот|frequency|wordstat)/u, "frequency.base", 0.82],
    [/(позици|position|rank)/u, "ranking.position", 0.86],
    [/(поисков.*систем|search engine)/u, "context.search_engine", 0.86],
    [/(регион|region|гео)/u, "context.region", 0.86],
    [/(дата.*проверк|checked at|check date)/u, "metric.observed_at", 0.86],
    [/(тег|метк|tag|label)/u, "keyword.tags", 0.82],
    [/^(язык|language|locale)$/u, "keyword.language", 0.9],
    [/(приоритет|priority)/u, "keyword.priority", 0.9],
    [/(избранн|favorite|favourite)/u, "keyword.favorite", 0.9],
    [/(отслеж|tracked|tracking)/u, "keyword.tracked", 0.9],
    [/^(заметк|коммент|note|comment)/u, "keyword.note", 0.88],
    [/(интент|intent)/u, "keyword.intent", 0.9],
    [/(^kei$|эффективност.*ключ)/u, "metric.kei", 0.84]
  ];
  for (const [pattern, target, confidence] of rules) {
    if (pattern.test(value)) {
      return { suggestedTarget: target, confidence };
    }
  }
  return { suggestedTarget: "custom", confidence: 0.35 };
}

function delimiterScore(value: string, delimiter: string): number {
  const fieldCounts: number[] = [];
  let fields = 1;
  let inQuotes = false;
  for (let index = 0; index < value.length && fieldCounts.length < 20; index += 1) {
    const character = value[index];
    if (character === "\"") {
      if (inQuotes && value[index + 1] === "\"") index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && character === delimiter) {
      fields += 1;
    } else if (!inQuotes && (character === "\r" || character === "\n")) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      if (fields > 1) fieldCounts.push(fields);
      fields = 1;
    }
  }
  if (fields > 1 && fieldCounts.length < 20) fieldCounts.push(fields);
  if (fieldCounts.length === 0) return 0;
  const frequencies = new Map<number, number>();
  for (const count of fieldCounts) {
    frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
  }
  const [modeFields, modeFrequency] = [...frequencies.entries()].sort(
    (left, right) => right[1] - left[1] || right[0] - left[0]
  )[0]!;
  return modeFrequency * 1_000 + modeFields * 10 - frequencies.size;
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[()[\]{}"'!|/_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function looksNumeric(value: string): boolean {
  return /^[-+]?\d+(?:[.,]\d+)?$/u.test(value.trim());
}

function decodeSample(
  value: Uint8Array,
  encoding: DetectedImportEncoding
): string {
  return withoutBom(
    new TextDecoder(encodingLabel(encoding)).decode(value)
  );
}

function encodingLabel(encoding: DetectedImportEncoding): string {
  return encoding === "UTF_8" ? "utf-8" : "windows-1251";
}

function withoutBom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function concatBytes(values: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    values.reduce((total, value) => total + value.byteLength, 0)
  );
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}
