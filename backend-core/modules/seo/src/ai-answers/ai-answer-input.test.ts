import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { internalPersistAiAnswerSnapshotBatchInput } from "./ai-answer-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";

function command(snapshot: Readonly<Record<string, unknown>>) {
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    searchEngine: "YANDEX",
    regionCode: "213",
    device: "DESKTOP",
    provider: "ARSENKIN",
    host: "nt-g.ru",
    observedAt: "2026-08-19T10:00:00.000Z",
    items: [{ keywordId, keywordVersion: 2, snapshot }]
  };
}

test("accepts a complete normalized AI answer snapshot", () => {
  const input = internalPersistAiAnswerSnapshotBatchInput(command({
    answerPresent: true,
    siteFound: true,
    position: 2,
    rankingUrl: "https://nt-g.ru/catalog",
    brandFound: false,
    answerMarkdown: "Ответ",
    sources: [{ providerId: 1, url: "https://nt-g.ru/catalog", title: "Каталог" }]
  }));

  assert.equal(input.items[0]?.snapshot.position, 2);
  assert.equal(input.items[0]?.snapshot.sources[0]?.url, "https://nt-g.ru/catalog");
});

test("accepts a provider-confirmed AI answer before optional details are available", () => {
  const input = internalPersistAiAnswerSnapshotBatchInput(command({
    answerPresent: true,
    siteFound: false,
    brandFound: false,
    sources: []
  }));

  assert.equal(input.items[0]?.snapshot.answerPresent, true);
  assert.equal(input.items[0]?.snapshot.answerMarkdown, undefined);
  assert.deepEqual(input.items[0]?.snapshot.sources, []);
});

test("rejects contradictory provider flags and partial site positions", () => {
  assert.throws(
    () => internalPersistAiAnswerSnapshotBatchInput(command({
      answerPresent: false,
      siteFound: false,
      brandFound: false,
      answerMarkdown: "Несогласованный ответ",
      sources: []
    })),
    BadRequestException
  );
  assert.throws(
    () => internalPersistAiAnswerSnapshotBatchInput(command({
      answerPresent: true,
      siteFound: false,
      position: 3,
      brandFound: false,
      answerMarkdown: "Ответ",
      sources: []
    })),
    BadRequestException
  );
  assert.throws(
    () => internalPersistAiAnswerSnapshotBatchInput(command({
      answerPresent: false,
      siteFound: false,
      brandFound: true,
      sources: []
    })),
    BadRequestException
  );
});
