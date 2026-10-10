import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyProjectPageDraft,
  projectPageInput,
  projectPagesApiPath,
  projectPagesReturnTo,
  validateProjectPageDraft
} from "./project-pages.ts";

test("builds a normalized page map command", () => {
  const draft = {
    ...emptyProjectPageDraft(),
    url: "https://example.com/service/",
    aliases: "https://example.com/old\nhttps://example.com/old",
    pageType: "EXISTING" as const,
    indexability: "INDEXABLE" as const,
    httpStatus: "200",
    language: "ru-RU",
    priority: "90",
    title: " Service "
  };
  assert.deepEqual(validateProjectPageDraft(draft), {});
  assert.deepEqual(projectPageInput(draft), {
    url: "https://example.com/service/",
    aliases: ["https://example.com/old"],
    pageType: "EXISTING",
    indexability: "INDEXABLE",
    httpStatus: 200,
    title: "Service",
    language: "ru-RU",
    contentStatus: "IDEA",
    priority: 90
  });
});

test("rejects unsafe page drafts and encodes routes", () => {
  const errors = validateProjectPageDraft({
    ...emptyProjectPageDraft(),
    url: "javascript:alert(1)",
    aliases: "https://user:secret@example.com/",
    httpStatus: "700",
    priority: "-1"
  });
  assert.ok(errors.url);
  assert.ok(errors.aliases);
  assert.ok(errors.httpStatus);
  assert.ok(errors.priority);
  assert.equal(
    projectPagesApiPath("project/one"),
    "/app/api/projects/project%2Fone/pages"
  );
  assert.equal(
    projectPagesReturnTo("project one"),
    "/app/projects/project%20one/pages"
  );
});

test("page editor rejects a missing priority and invalid publication date before serialization", () => {
  const draft = emptyProjectPageDraft();
  assert.ok(validateProjectPageDraft({ ...draft, url: "https://example.com/", priority: "" }).priority);
  assert.ok(validateProjectPageDraft({ ...draft, url: "https://example.com/", publishedAt: "invalid-date" }).publishedAt);
});
