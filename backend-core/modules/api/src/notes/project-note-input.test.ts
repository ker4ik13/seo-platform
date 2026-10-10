import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createProjectNoteInput,
  projectNoteToken,
  updateProjectNoteInput
} from "./project-note-input.js";

test("normalizes a markdown note and its visibility", () => {
  assert.deepEqual(
    createProjectNoteInput({
      title: "  План продвижения  ",
      markdown: "  # План\n\n[Ссылка](https://example.com)  ",
      visibility: "PUBLIC"
    }),
    {
      title: "План продвижения",
      markdown: "  # План\n\n[Ссылка](https://example.com)  ",
      format: "MARKDOWN",
      visibility: "PUBLIC"
    }
  );
});

test("accepts project notes longer than the former 100 000 character limit", () => {
  const markdown = `# Большая заметка\n\n${"данные ".repeat(15_000)}`;
  assert.ok(markdown.length > 100_000);
  assert.equal(
    createProjectNoteInput({
      title: "Большая заметка",
      markdown,
      visibility: "PROJECT_MEMBERS"
    }).markdown,
    markdown
  );
});

test("rejects empty note patches and unknown fields", () => {
  assert.throws(() => updateProjectNoteInput({}), DomainError);
  assert.throws(
    () =>
      createProjectNoteInput({
        title: "План",
        markdown: "",
        visibility: "PROJECT_MEMBERS",
        publicToken: "must-not-be-accepted"
      }),
    DomainError
  );
});

test("accepts only opaque public note tokens", () => {
  const token = "a".repeat(43);
  assert.equal(projectNoteToken(token), token);
  assert.throws(() => projectNoteToken("short"), DomainError);
});

test("file format reaches the strict producer input and content remains byte-for-byte text", () => {
  const markdown = '  A,B\n"001","a,b"\n';
  const input = createProjectNoteInput({ title: "Таблица", markdown, format: "CSV", visibility: "PROJECT_MEMBERS" });
  assert.equal(input.format, "CSV"); assert.equal(input.markdown, markdown);
  assert.equal(updateProjectNoteInput({ format: "TEXT" }).format, "TEXT");
  assert.throws(() => createProjectNoteInput({ title: "x", markdown: "", format: "BINARY", visibility: "PUBLIC" }));
});

test("CSV commands accept explicit delimiters, including delimiter-only updates", () => {
  const base = { title: "CSV", markdown: "a;b", visibility: "PROJECT_MEMBERS", format: "CSV" };
  assert.equal(createProjectNoteInput({ ...base, delimiter: ";" }).delimiter, ";");
  assert.equal(updateProjectNoteInput({ delimiter: "🧩" }).delimiter, "🧩");
  for (const delimiter of ["", "ab", '"', "\n", "\t"]) assert.throws(() => createProjectNoteInput({ ...base, delimiter }));
  assert.throws(() => createProjectNoteInput({ ...base, format: "TEXT", delimiter: ";" }));
});
