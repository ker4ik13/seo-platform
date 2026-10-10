import type { ProjectNoteFormat } from "@seo-platform/contracts";

export const noteFileExtensions: Readonly<Record<ProjectNoteFormat, string>> = { MARKDOWN: "md", TEXT: "txt", CSV: "csv", TSV: "tsv", JSON: "json" };
export const noteFileMimeTypes: Readonly<Record<ProjectNoteFormat, string>> = { MARKDOWN: "text/markdown", TEXT: "text/plain", CSV: "text/csv", TSV: "text/tab-separated-values", JSON: "application/json" };
export function noteFileName(title: string, format: ProjectNoteFormat): string {
  return `${title.trim().replace(/\.(?:md|txt|csv|tsv|json)$/iu, "") || "Без названия"}.${noteFileExtensions[format]}`;
}
export function tabularNote(format: ProjectNoteFormat): boolean { return format === "CSV" || format === "TSV"; }

export { parseDelimitedRows, serializeDelimitedRows, noteDelimiter } from "@seo-platform/contracts";

export function spreadsheetColumnName(index: number): string {
  let name = "", number = index + 1;
  while (number > 0) { number--; name = String.fromCharCode(65 + number % 26) + name; number = Math.floor(number / 26); }
  return name;
}

export function downloadNoteFile(title: string, content: string, format: ProjectNoteFormat): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${noteFileMimeTypes[format]};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url; link.download = noteFileName(title, format).replace(/[\\/:*?"<>|]/gu, "-");
  link.click(); URL.revokeObjectURL(url);
}
