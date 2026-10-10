import assert from "node:assert/strict";
import test from "node:test";
import { noteFileName, noteDelimiter, parseDelimitedRows, serializeDelimitedRows, spreadsheetColumnName } from "./project-note-files.ts";

test("CSV preserves quoted separators, multiline cells, escaped quotes and blank trailing cells", () => {
  const rows = [["Запрос", "Описание", ""], ["ключ, слово", "две\nстроки", 'кавычки "текст"'], ["  пробелы  ", "001", ""]];
  assert.deepEqual(parseDelimitedRows(serializeDelimitedRows(rows)), rows);
  assert.deepEqual(parseDelimitedRows("a;b\r\n1;2\r\n", ";"), [["a", "b"], ["1", "2"]]);
  assert.equal(noteDelimiter('"a,b";c\n1;2', "CSV"), ";");
  assert.throws(() => parseDelimitedRows('"незакрытый'), /кавычки/u);
});

test("TSV and file names keep tabular content and selected extension", () => {
  const rows = [["A", "B"], ["текст\tс табом", ""]];
  assert.deepEqual(parseDelimitedRows(serializeDelimitedRows(rows, "\t"), "\t"), rows);
  assert.equal(noteFileName("Стратегия.md", "TEXT"), "Стратегия.txt");
  assert.equal(spreadsheetColumnName(25), "Z"); assert.equal(spreadsheetColumnName(26), "AA");
});

test("explicit and Unicode CSV delimiters round-trip without heuristic reinterpretation", () => {
  const rows = [["a;b,c|d", 'quote "', "001"], ["line\nnext", "", "🧩value"]];
  for (const delimiter of [",", ";", "|", "🧩"]) {
    const encoded = serializeDelimitedRows(rows, delimiter);
    assert.equal(noteDelimiter(encoded, "CSV", delimiter), delimiter);
    assert.deepEqual(parseDelimitedRows(encoded, delimiter), rows);
  }
  assert.equal(noteDelimiter("one;value", "CSV", ","), ",");
  assert.throws(() => parseDelimitedRows("a", ""));
});
