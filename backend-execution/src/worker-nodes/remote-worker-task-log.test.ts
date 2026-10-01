import assert from "node:assert/strict";
import test from "node:test";
import type { RemoteRankPollTaskV1, RemoteWorkTask } from "@seo-platform/contracts";
import { workerTaskFinishLog, workerTaskLogContext, workerTaskStartLog } from "./remote-worker-task-log.js";

const task: RemoteWorkTask = {
  schemaVersion: "worker-work-task@1",
  id: "01900000-0000-7000-8000-000000000001",
  ticket: "private-ticket",
  capability: "WORDSTAT",
  command: "PROVIDER_HTTP",
  resource: "HTTP",
  payload: {
    url: "https://xmlstock.com/wordstat/json/?user=private-user&key=private-key&query=%D0%B4%D0%BE%D0%BC%0Aprivate-key",
    sensitiveValues: ["private-key"]
  },
  deadline: "2026-10-01T12:00:00.000Z"
};

test("worker logs are Russian and secret-free by default", () => {
  const context = workerTaskLogContext(task, false);
  assert.match(context, /частотность · XMLStock · задание/u);
  assert.doesNotMatch(context, /private-|дом/u);
  const start = workerTaskStartLog(context);
  const finish = workerTaskFinishLog(context, 604, "PROVIDER_RATE_LIMITED");
  assert.match(start, /^Воркер: начал/u);
  assert.match(finish, /ошибка PROVIDER_RATE_LIMITED.*604 мс/u);
  assert.doesNotMatch(`${start}${finish}`, /private-|дом/u);
});

test("opt-in query logs stay on one line, bounded and mask an embedded API key", () => {
  const text = workerTaskLogContext(task, true);
  assert.match(text, /дом \[скрыто\]/u);
  assert.doesNotMatch(text, /private-key|private-user|private-ticket|\n/u);
});

test("rank poll logs use the Job item, not the provider task ID", () => {
  const rank = {
    schemaVersion: "worker-rank-poll-task@1",
    ticket: "private-ticket",
    provider: "XMLSTOCK",
    providerTaskId: "private-provider-id",
    requestSnapshot: {
      jobItemId: "01900000-0000-7000-8000-000000000002",
      keywords: [{ keywordText: "купить стол", keywordId: "private-keyword-id" }]
    },
    secret: { apiKey: "private-key" },
    timeoutMs: 10_000
  } as RemoteRankPollTaskV1;
  assert.doesNotMatch(workerTaskLogContext(rank, false), /купить стол|private-/u);
  assert.match(workerTaskLogContext(rank, true), /купить стол/u);
  assert.doesNotMatch(workerTaskLogContext(rank, true), /private-/u);
});

test("Arsenkin batch logs only a bounded phrase preview, never its authorization", () => {
  const arsenkin: RemoteWorkTask = {
    ...task,
    capability: "AI_ANSWER",
    payload: {
      url: "https://arsenkin.ru/api/tools/set",
      headers: { authorization: "Bearer private-key" },
      sensitiveValues: ["private-key"],
      body: JSON.stringify({ tools_name: "ai-serp", data: {
        queries: ["первая", "вторая", "третья", "четвёртая"], host: "private-host.example" }
      })
    }
  };
  const context = workerTaskLogContext(arsenkin, true);
  assert.match(context, /первая.*вторая.*третья.*\(\+1\)/u);
  assert.doesNotMatch(context, /четвёртая|private-key|private-host/u);
});
