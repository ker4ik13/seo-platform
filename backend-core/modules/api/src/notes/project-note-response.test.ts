import assert from "node:assert/strict";
import test from "node:test";
import { projectNoteFormats } from "@seo-platform/contracts";
import { projectNote, publicProjectNote } from "./project-note-response.js";

const note = { id: "note", workspaceId: "workspace", projectId: "project", title: "Файл", markdown: '  001,"значение"\n', visibility: "PROJECT_MEMBERS", createdBy: "actor", updatedBy: "actor", version: 1, createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-10T10:00:00Z" };

test("strict private and public consumers preserve every supported file format and content", () => {
  for (const format of projectNoteFormats) {
    const input = { ...note, format };
    assert.equal(projectNote(input).format, format);
    assert.equal(projectNote(input).markdown, note.markdown);
    assert.equal(publicProjectNote(input).format, format);
    assert.equal(publicProjectNote(input).markdown, note.markdown);
  }
  assert.equal(projectNote(note).format, "MARKDOWN");
  assert.equal(publicProjectNote(note).format, "MARKDOWN");
  assert.throws(() => projectNote({ ...note, format: "PDF" }));
  assert.throws(() => publicProjectNote({ ...note, format: "PDF" }));
  assert.throws(() => projectNote(note, { workspaceId: "other", projectId: "project" }));
});

test("strict note consumers preserve CSV delimiters and reject invalid metadata", () => {
  for (const delimiter of [",", ";", "|", "🧩"]) {
    const input = { ...note, format: "CSV", delimiter };
    assert.equal(projectNote(input).delimiter, delimiter);
    assert.equal(publicProjectNote(input).delimiter, delimiter);
  }
  for (const delimiter of ["", "ab", '"', "\n", "\t", 42]) {
    assert.throws(() => projectNote({ ...note, format: "CSV", delimiter }));
    assert.throws(() => publicProjectNote({ ...note, format: "CSV", delimiter }));
  }
  assert.throws(() => projectNote({ ...note, format: "TEXT", delimiter: ";" }));
});
