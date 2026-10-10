import { projectNoteDelimiter, type ProjectNoteFormat } from "./notes.js";

export function parseDelimitedRows(text: string, delimiter = ","): string[][] {
  assertDelimiter(delimiter);
  if (!text) return [[""]];
  const rows: string[][] = [], row: string[] = [];
  let cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"' && (quoted || cell.length === 0)) {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted;
    } else if (!quoted && text.startsWith(delimiter, index)) { row.push(cell); cell = ""; index += delimiter.length - 1; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell); rows.push([...row]); row.length = 0; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Незакрытые кавычки в таблице.");
  if (cell || row.length || !/[\r\n]$/u.test(text)) { row.push(cell); rows.push(row); }
  return rows.length ? rows : [[""]];
}
export function serializeDelimitedRows(rows: readonly (readonly string[])[], delimiter = ","): string {
  assertDelimiter(delimiter);
  return rows.map((row) => row.map((cell) => cell.includes(delimiter) || (delimiter === "," && cell.includes(";")) || /["\r\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell).join(delimiter)).join("\n");
}
export function noteDelimiter(content: string, format: ProjectNoteFormat, explicit?: string | null): string {
  if (format === "TSV") return "\t";
  if (explicit != null) return projectNoteDelimiter(explicit)!;
  let quoted = false, commas = 0, semicolons = 0;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '"') { if (quoted && content[index + 1] === '"') index++; else quoted = !quoted; }
    else if (!quoted && /[\r\n]/u.test(character!)) break;
    else if (!quoted && character === ",") commas++;
    else if (!quoted && character === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

function assertDelimiter(delimiter: string): void {
  if ([...delimiter].length !== 1 || (delimiter.codePointAt(0) === 0 || /["\r\n\p{Cs}]/u.test(delimiter))) throw new TypeError("Invalid table delimiter");
}
