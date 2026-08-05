import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import {
  Open,
  type CentralDirectory,
  type File as ZipEntry
} from "unzipper-esm";
import { DelimitedParseError } from "./delimited-parser.js";

export const MAX_XLSX_BYTES = 256 * 1_024 * 1_024;

const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 2 * 1_024 * 1_024 * 1_024;
const MAX_COMPRESSION_RATIO = 200;
const MAX_SHARED_STRINGS = 1_000_000;
const MAX_SHARED_STRING_CHARS = 256 * 1_024 * 1_024;
const MAX_METADATA_XML_BYTES = 16 * 1_024 * 1_024;
const MAX_WORKSHEET_XML_BYTES = MAX_ARCHIVE_UNCOMPRESSED_BYTES;
const MAX_COLUMNS = 500;
const MAX_FIELD_CHARS = 1_000_000;
const MAX_ROW_CHARS = 8_000_000;

interface WorkbookSheet {
  readonly name: string;
  readonly state: "visible" | "hidden" | "veryHidden";
  readonly relationshipId: string;
}

interface WorkbookMetadata {
  readonly sheets: readonly WorkbookSheet[];
  readonly date1904: boolean;
}

interface CellState {
  readonly column: number;
  readonly type: string | undefined;
  readonly styleIndex: number | undefined;
  raw: string;
  inline: string;
}

/**
 * XLSX is first copied to a mode-600 temporary file with a compressed-size
 * limit. Central-directory access then lets the parser stream only allowlisted
 * OpenXML entries in a deterministic order without buffering the workbook.
 */
export async function* parseXlsxRows(
  source: AsyncIterable<Uint8Array>,
  declaredSizeBytes: bigint
): AsyncGenerator<readonly string[]> {
  if (
    declaredSizeBytes < 1n ||
    declaredSizeBytes > BigInt(MAX_XLSX_BYTES)
  ) {
    throw new DelimitedParseError("XLSX_TOO_LARGE");
  }

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "seo-platform-xlsx-")
  );
  const workbookPath = path.join(temporaryDirectory, "workbook.xlsx");
  try {
    await pipeline(
      Readable.from(boundedSource(source)),
      createWriteStream(workbookPath, {
        flags: "wx",
        mode: 0o600
      })
    );
    const archive = await Open.file(workbookPath);
    assertSafeArchive(archive, declaredSizeBytes);

    const workbookEntry = requiredEntry(archive, "xl/workbook.xml");
    const relationshipEntry = requiredEntry(
      archive,
      "xl/_rels/workbook.xml.rels"
    );
    const workbook = await readWorkbookMetadata(workbookEntry);
    const relationships = await readWorkbookRelationships(relationshipEntry);
    const selected = workbook.sheets.find(({ state }) => state === "visible");
    if (!selected) throw new DelimitedParseError("EMPTY_IMPORT");
    const worksheetPath = relationships.get(selected.relationshipId);
    if (!worksheetPath) {
      throw new DelimitedParseError("INVALID_XLSX");
    }
    const worksheetEntry = requiredEntry(archive, worksheetPath);
    assertEntryLimit(worksheetEntry, MAX_WORKSHEET_XML_BYTES);

    const sharedStringsEntry = optionalEntry(
      archive,
      "xl/sharedStrings.xml"
    );
    const sharedStrings = sharedStringsEntry
      ? await readSharedStrings(sharedStringsEntry)
      : [];
    const stylesEntry = optionalEntry(archive, "xl/styles.xml");
    const dateStyles = stylesEntry
      ? await readDateStyles(stylesEntry)
      : new Map<number, DateStyle>();

    yield* readWorksheetRows(
      worksheetEntry,
      sharedStrings,
      dateStyles,
      workbook.date1904
    );
  } catch (error) {
    if (error instanceof DelimitedParseError) throw error;
    throw new DelimitedParseError("INVALID_XLSX");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function* boundedSource(
  source: AsyncIterable<Uint8Array>
): AsyncGenerator<Uint8Array> {
  let bytes = 0;
  for await (const chunk of source) {
    bytes += chunk.byteLength;
    if (bytes > MAX_XLSX_BYTES) {
      throw new DelimitedParseError("XLSX_TOO_LARGE");
    }
    yield chunk;
  }
}

function assertSafeArchive(
  archive: CentralDirectory,
  compressedSizeBytes: bigint
): void {
  if (
    archive.files.length === 0 ||
    archive.files.length > MAX_ARCHIVE_ENTRIES
  ) {
    throw new DelimitedParseError("INVALID_XLSX");
  }
  let uncompressedBytes = 0;
  for (const entry of archive.files) {
    if ((entry.flags & 1) !== 0) {
      throw new DelimitedParseError("INVALID_XLSX");
    }
    if (
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize < 0
    ) {
      throw new DelimitedParseError("INVALID_XLSX");
    }
    uncompressedBytes += entry.uncompressedSize;
    if (uncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new DelimitedParseError("XLSX_ARCHIVE_TOO_LARGE");
    }
  }
  const compressed = Number(compressedSizeBytes);
  if (
    compressed > 0 &&
    uncompressedBytes / compressed > MAX_COMPRESSION_RATIO
  ) {
    throw new DelimitedParseError("XLSX_ARCHIVE_TOO_LARGE");
  }
}

async function readWorkbookMetadata(
  entry: ZipEntry
): Promise<WorkbookMetadata> {
  assertEntryLimit(entry, MAX_METADATA_XML_BYTES);
  const sheets: WorkbookSheet[] = [];
  let date1904 = false;
  await parseXml(entry, {
    onOpen(tag) {
      if (localName(tag.name) === "workbookPr") {
        date1904 = ["1", "true"].includes(
          attribute(tag, "date1904") ?? ""
        );
      }
      if (localName(tag.name) !== "sheet") return;
      const name = attribute(tag, "name");
      const relationshipId =
        attribute(tag, "r:id") ?? attribute(tag, "id");
      const rawState = attribute(tag, "state") ?? "visible";
      if (
        !name ||
        !relationshipId ||
        !["visible", "hidden", "veryHidden"].includes(rawState)
      ) {
        throw new DelimitedParseError("INVALID_XLSX");
      }
      sheets.push({
        name,
        relationshipId,
        state: rawState as WorkbookSheet["state"]
      });
    }
  });
  if (sheets.length === 0) {
    throw new DelimitedParseError("EMPTY_IMPORT");
  }
  return { sheets, date1904 };
}

async function readWorkbookRelationships(
  entry: ZipEntry
): Promise<ReadonlyMap<string, string>> {
  assertEntryLimit(entry, MAX_METADATA_XML_BYTES);
  const relationships = new Map<string, string>();
  await parseXml(entry, {
    onOpen(tag) {
      if (localName(tag.name) !== "Relationship") return;
      const id = attribute(tag, "Id");
      const target = attribute(tag, "Target");
      if (!id || !target) return;
      const normalized = path.posix.normalize(
        path.posix.join("xl", target)
      );
      if (
        !/^xl\/worksheets\/[^/]+\.xml$/u.test(normalized) ||
        normalized.includes("..")
      ) {
        return;
      }
      relationships.set(id, normalized);
    }
  });
  return relationships;
}

async function readSharedStrings(
  entry: ZipEntry
): Promise<readonly string[]> {
  assertEntryLimit(entry, MAX_SHARED_STRING_CHARS * 4);
  const values: string[] = [];
  let current: string | undefined;
  let insideText = false;
  let totalCharacters = 0;
  await parseXml(entry, {
    onOpen(tag) {
      const name = localName(tag.name);
      if (name === "si") current = "";
      if (name === "t" && current !== undefined) insideText = true;
    },
    onText(text) {
      if (insideText && current !== undefined) current += text;
    },
    onClose(tag) {
      const name = localName(tag.name);
      if (name === "t") insideText = false;
      if (name !== "si" || current === undefined) return;
      totalCharacters += current.length;
      if (
        values.length >= MAX_SHARED_STRINGS ||
        totalCharacters > MAX_SHARED_STRING_CHARS
      ) {
        throw new DelimitedParseError("XLSX_SHARED_STRINGS_TOO_LARGE");
      }
      values.push(current.normalize("NFC"));
      current = undefined;
    }
  });
  return values;
}

interface DateStyle {
  readonly includesTime: boolean;
}

async function readDateStyles(
  entry: ZipEntry
): Promise<ReadonlyMap<number, DateStyle>> {
  assertEntryLimit(entry, MAX_METADATA_XML_BYTES);
  const customFormats = new Map<number, string>();
  const dateStyles = new Map<number, DateStyle>();
  let insideCellFormats = false;
  let styleIndex = 0;
  await parseXml(entry, {
    onOpen(tag) {
      const name = localName(tag.name);
      if (name === "cellXfs") {
        insideCellFormats = true;
        styleIndex = 0;
        return;
      }
      if (name === "numFmt") {
        const id = safeInteger(attribute(tag, "numFmtId"));
        const code = attribute(tag, "formatCode");
        if (id !== undefined && code) customFormats.set(id, code);
        return;
      }
      if (name !== "xf" || !insideCellFormats) return;
      const formatId = safeInteger(attribute(tag, "numFmtId")) ?? 0;
      const format = dateFormat(formatId, customFormats.get(formatId));
      if (format) dateStyles.set(styleIndex, format);
      styleIndex += 1;
    },
    onClose(tag) {
      if (localName(tag.name) === "cellXfs") insideCellFormats = false;
    }
  });
  return dateStyles;
}

async function* readWorksheetRows(
  entry: ZipEntry,
  sharedStrings: readonly string[],
  dateStyles: ReadonlyMap<number, DateStyle>,
  date1904: boolean
): AsyncGenerator<readonly string[]> {
  const completed: string[][] = [];
  let currentRow: string[] | undefined;
  let currentCell: CellState | undefined;
  let captureRaw = false;
  let captureInline = false;
  let rowCharacters = 0;
  let implicitColumn = 0;
  const parser = safeXmlParser({
    onOpen(tag) {
      const name = localName(tag.name);
      if (name === "row") {
        currentRow = [];
        rowCharacters = 0;
        implicitColumn = 0;
        return;
      }
      if (name === "c" && currentRow) {
        const reference = attribute(tag, "r");
        const column = reference
          ? columnFromReference(reference)
          : implicitColumn + 1;
        if (column < 1 || column > MAX_COLUMNS) {
          throw new DelimitedParseError("TOO_MANY_COLUMNS");
        }
        implicitColumn = column;
        currentCell = {
          column,
          type: attribute(tag, "t"),
          styleIndex: safeInteger(attribute(tag, "s")),
          raw: "",
          inline: ""
        };
        return;
      }
      if (!currentCell) return;
      if (name === "v") captureRaw = true;
      if (name === "t") captureInline = true;
    },
    onText(text) {
      if (!currentCell) return;
      if (captureRaw) currentCell.raw += text;
      if (captureInline) currentCell.inline += text;
    },
    onClose(tag) {
      const name = localName(tag.name);
      if (name === "v") captureRaw = false;
      if (name === "t") captureInline = false;
      if (name === "c" && currentCell && currentRow) {
        const value = cellText(
          currentCell,
          sharedStrings,
          dateStyles,
          date1904
        );
        if (value.length > MAX_FIELD_CHARS) {
          throw new DelimitedParseError("FIELD_TOO_LARGE");
        }
        rowCharacters += value.length;
        if (rowCharacters > MAX_ROW_CHARS) {
          throw new DelimitedParseError("ROW_TOO_LARGE");
        }
        while (currentRow.length < currentCell.column - 1) {
          currentRow.push("");
        }
        currentRow[currentCell.column - 1] = value;
        currentCell = undefined;
      }
      if (name === "row" && currentRow) {
        completed.push(currentRow);
        currentRow = undefined;
      }
    }
  });

  try {
    let bytes = 0;
    for await (const chunk of entry.stream()) {
      bytes += chunk.byteLength;
      if (bytes > MAX_WORKSHEET_XML_BYTES) {
        throw new DelimitedParseError("XLSX_ARCHIVE_TOO_LARGE");
      }
      parser.write(chunk.toString("utf8"));
      while (completed.length > 0) yield completed.shift()!;
    }
    parser.close();
    while (completed.length > 0) yield completed.shift()!;
  } catch (error) {
    if (error instanceof DelimitedParseError) throw error;
    throw new DelimitedParseError("INVALID_XLSX");
  }
}

function cellText(
  cell: CellState,
  sharedStrings: readonly string[],
  dateStyles: ReadonlyMap<number, DateStyle>,
  date1904: boolean
): string {
  if (cell.type === "s") {
    const index = safeInteger(cell.raw);
    const value = index === undefined ? undefined : sharedStrings[index];
    if (value === undefined) throw new DelimitedParseError("INVALID_XLSX");
    return value;
  }
  if (cell.type === "inlineStr") return cell.inline.normalize("NFC");
  if (cell.type === "b") return cell.raw === "1" ? "TRUE" : "FALSE";
  if (cell.type === "e") return "";
  const dateStyle =
    cell.styleIndex === undefined
      ? undefined
      : dateStyles.get(cell.styleIndex);
  if (dateStyle && cell.raw) {
    return excelDate(cell.raw, date1904, dateStyle.includesTime);
  }
  return (cell.inline || cell.raw).normalize("NFC");
}

function excelDate(
  value: string,
  date1904: boolean,
  includesTime: boolean
): string {
  const serial = Number(value);
  if (!Number.isFinite(serial)) {
    throw new DelimitedParseError("INVALID_XLSX");
  }
  const epoch = date1904
    ? Date.UTC(1904, 0, 1)
    : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(serial * 86_400_000));
  if (!Number.isFinite(date.getTime())) {
    throw new DelimitedParseError("INVALID_XLSX");
  }
  return includesTime
    ? date.toISOString()
    : date.toISOString().slice(0, 10);
}

function dateFormat(
  id: number,
  custom: string | undefined
): DateStyle | undefined {
  if (
    (id >= 14 && id <= 22) ||
    (id >= 27 && id <= 36) ||
    (id >= 45 && id <= 47) ||
    (id >= 50 && id <= 58)
  ) {
    return { includesTime: id >= 18 && id <= 22 || id >= 45 };
  }
  if (!custom) return undefined;
  const normalized = custom
    .replace(/"[^"]*"/gu, "")
    .replace(/\\./gu, "")
    .replace(/\[[^\]]*\]/gu, "")
    .toLowerCase();
  if (!/[yd]/u.test(normalized)) return undefined;
  return { includesTime: /[hs]/u.test(normalized) };
}

interface XmlHandlers {
  readonly onOpen?: (tag: SaxesTagPlain) => void;
  readonly onText?: (text: string) => void;
  readonly onClose?: (tag: SaxesTagPlain) => void;
}

async function parseXml(
  entry: ZipEntry,
  handlers: XmlHandlers
): Promise<void> {
  const parser = safeXmlParser(handlers);
  let bytes = 0;
  for await (const chunk of entry.stream()) {
    bytes += chunk.byteLength;
    if (bytes > MAX_METADATA_XML_BYTES * 16) {
      throw new DelimitedParseError("INVALID_XLSX");
    }
    parser.write(chunk.toString("utf8"));
  }
  parser.close();
}

function safeXmlParser(handlers: XmlHandlers): SaxesParser<{}> {
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => {
    throw new DelimitedParseError("INVALID_XLSX");
  });
  if (handlers.onOpen) parser.on("opentag", handlers.onOpen);
  if (handlers.onText) parser.on("text", handlers.onText);
  if (handlers.onClose) parser.on("closetag", handlers.onClose);
  return parser;
}

function requiredEntry(
  archive: CentralDirectory,
  name: string
): ZipEntry {
  const matches = archive.files.filter(
    (entry) => entry.type === "File" && entry.path === name
  );
  if (matches.length !== 1) {
    throw new DelimitedParseError("INVALID_XLSX");
  }
  return matches[0]!;
}

function optionalEntry(
  archive: CentralDirectory,
  name: string
): ZipEntry | undefined {
  const matches = archive.files.filter(
    (entry) => entry.type === "File" && entry.path === name
  );
  if (matches.length > 1) {
    throw new DelimitedParseError("INVALID_XLSX");
  }
  return matches[0];
}

function assertEntryLimit(entry: ZipEntry, limit: number): void {
  if (
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 0 ||
    entry.uncompressedSize > limit
  ) {
    throw new DelimitedParseError("XLSX_ARCHIVE_TOO_LARGE");
  }
}

function attribute(
  tag: SaxesTagPlain,
  name: string
): string | undefined {
  const value = tag.attributes[name];
  return typeof value === "string" ? value : undefined;
}

function localName(name: string): string {
  const separator = name.indexOf(":");
  return separator === -1 ? name : name.slice(separator + 1);
}

function safeInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function columnFromReference(reference: string): number {
  const match = /^([A-Z]+)\d+$/u.exec(reference);
  if (!match) throw new DelimitedParseError("INVALID_XLSX");
  let result = 0;
  for (const character of match[1]!) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}
