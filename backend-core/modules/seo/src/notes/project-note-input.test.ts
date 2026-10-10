import assert from "node:assert/strict";
import test from "node:test";
import {
  internalCreateProjectNoteInput,
  internalUpdateProjectNoteInput
} from "./project-note-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";

test("keeps large Markdown notes intact at the SEO storage boundary", () => {
  const markdown = `# Данные\n\n${"строка заметки\n".repeat(8_000)}`;
  assert.ok(markdown.length > 100_000);
  const created = internalCreateProjectNoteInput({
    workspaceId,
    projectId,
    actorId,
    title: "Данные",
    markdown,
    visibility: "PROJECT_MEMBERS"
  });
  const updated = internalUpdateProjectNoteInput({
    workspaceId,
    projectId,
    actorId,
    version: 2,
    markdown
  });

  assert.equal(created.markdown, markdown);
  assert.equal(updated.markdown, markdown);
});

test("owning CSV commands preserve the delimiter and reject invalid symbols", () => {
  const scope = { workspaceId: "01900000-0000-7000-8000-000000000001", projectId: "01900000-0000-7000-8000-000000000002", actorId: "01900000-0000-7000-8000-000000000003" };
  assert.equal(internalCreateProjectNoteInput({ ...scope, title: "CSV", markdown: "a;b", format: "CSV", delimiter: ";", visibility: "PROJECT_MEMBERS" }).delimiter, ";");
  assert.equal(internalUpdateProjectNoteInput({ ...scope, version: 1, delimiter: "|" }).delimiter, "|");
  assert.throws(() => internalUpdateProjectNoteInput({ ...scope, version: 1, delimiter: "ab" }));
});
