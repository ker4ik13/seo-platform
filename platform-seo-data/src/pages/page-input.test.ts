import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateProjectPageInput,
  projectPageListQuery
} from "./page-input.js";
import { normalizePageUrl } from "./page-url.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";

test("normalizes page URLs and strict internal page commands", () => {
  assert.deepEqual(normalizePageUrl("HTTPS://Example.COM:443/a#part"), {
    original: "HTTPS://Example.COM:443/a#part",
    normalized: "https://example.com/a",
    hash: "2dce0a4c50441bfccfa9caf4b58c3cba6e06c420505dd829f0436de1aa44baac"
  });
  const input = internalCreateProjectPageInput({
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "page-create-1",
    url: "https://example.com/",
    aliases: ["https://example.com/home"],
    pageType: "EXISTING",
    indexability: "INDEXABLE",
    httpStatus: 200,
    title: " Главная ",
    language: "ru-ru",
    contentStatus: "PUBLISHED",
    priority: 80,
    publishedAt: "2026-07-30T10:00:00.000Z"
  });
  assert.equal(input.title, "Главная");
  assert.equal(input.language, "ru-RU");
  assert.equal(input.httpStatus, 200);
});

test("rejects credential-bearing URLs, unknown fields and unsafe bounds", () => {
  const base = {
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "page-create-1",
    url: "https://example.com/",
    aliases: [],
    pageType: "EXISTING",
    indexability: "INDEXABLE",
    priority: 0
  };
  assert.throws(
    () => internalCreateProjectPageInput({ ...base, extra: true }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalCreateProjectPageInput({
        ...base,
        url: "https://user:secret@example.com/"
      }),
    BadRequestException
  );
  assert.throws(
    () => internalCreateProjectPageInput({ ...base, httpStatus: 99 }),
    BadRequestException
  );
});

test("binds a page cursor to bounded filters", () => {
  assert.deepEqual(projectPageListQuery({}), { limit: 50 });
  assert.deepEqual(
    projectPageListQuery({
      limit: "100",
      search: " service ",
      pageType: "PLANNED",
      lifecycleStatus: "ARCHIVED"
    }),
    {
      limit: 100,
      search: "service",
      pageType: "PLANNED",
      lifecycleStatus: "ARCHIVED"
    }
  );
  assert.throws(
    () => projectPageListQuery({ limit: "101" }),
    BadRequestException
  );
});
