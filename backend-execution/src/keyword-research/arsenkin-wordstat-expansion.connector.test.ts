import assert from "node:assert/strict";
import test from "node:test";
import { parseResult, requestBody } from "./arsenkin-wordstat-expansion.connector.js";

test("builds the documented Arsenkin Wordstat phrase expansion request", () => {
  assert.deepEqual(
    requestBody({
      queries: ["ремонт холодильников", "купить морозильник"],
      regionCode: "213",
      device: "ALL",
      minusWords: ["бесплатно"],
      clearMinusPhrases: false,
      includeRightColumn: true,
      clearPlus: false,
      maxKeywords: 5000
    }),
    {
      tools_name: "wordstat",
      data: {
        type: 2,
        queries: ["ремонт холодильников", "купить морозильник"],
        device: "",
        region: 213,
        minus_words: ["бесплатно"],
        is_clear_minus: false,
        is_right: true,
        is_clear: false
      }
    }
  );
});

test("normalizes the observed type-2 result and keeps seed provenance", () => {
  assert.deepEqual(
    parseResult(
      {
        code: "TASK_RESULT",
        task_id: "task-1",
        result: {
          type: 2,
          queries: ["ремонт холодильников", "купить морозильник"],
          data: {
            0: {
              freq: 100,
              left: { "ремонт холодильников": 100, "ремонт холодильника цена": 40 },
              right: { "ремонт холодильников москва": 30 }
            },
            1: {
              freq: 80,
              left: { "купить морозильник": 80, "морозильник купить недорого": 20 },
              right: {}
            }
          }
        },
        finished_at: "2026-08-26 10:00:00"
      },
      "task-1",
      ["ремонт холодильников", "купить морозильник"],
      10
    ),
    [
      { keyword: "ремонт холодильников", frequencyBase: 100, sourceQuery: "ремонт холодильников", sourceColumn: "LEFT" },
      { keyword: "ремонт холодильника цена", frequencyBase: 40, sourceQuery: "ремонт холодильников", sourceColumn: "LEFT" },
      { keyword: "ремонт холодильников москва", frequencyBase: 30, sourceQuery: "ремонт холодильников", sourceColumn: "RIGHT" },
      { keyword: "купить морозильник", frequencyBase: 80, sourceQuery: "купить морозильник", sourceColumn: "LEFT" },
      { keyword: "морозильник купить недорого", frequencyBase: 20, sourceQuery: "купить морозильник", sourceColumn: "LEFT" }
    ]
  );
});

test("accepts the live Arsenkin type-2 response with array data blocks", () => {
  assert.deepEqual(
    parseResult(
      {
        code: "TASK_RESULT",
        task_id: "31102876",
        result: {
          type: 2,
          task_id: "31102876",
          queries: ["нейросети"],
          is_clear: false,
          device: null,
          minus: [],
          data: [
            {
              freq: 4_360_445,
              left: {
                "нейросеть": 4_360_414,
                "нейросеть бесплатно": 877_330
              },
              right: {
                "что такое нейросеть": 501_234
              }
            }
          ]
        },
        created_at: "2026-08-26 17:02:55",
        finished_at: "2026-08-26 17:03:19"
      },
      "31102876",
      ["нейросети"],
      10_000
    ),
    [
      {
        keyword: "нейросети",
        frequencyBase: 4_360_445,
        sourceQuery: "нейросети",
        sourceColumn: "LEFT"
      },
      {
        keyword: "нейросеть",
        frequencyBase: 4_360_414,
        sourceQuery: "нейросети",
        sourceColumn: "LEFT"
      },
      {
        keyword: "нейросеть бесплатно",
        frequencyBase: 877_330,
        sourceQuery: "нейросети",
        sourceColumn: "LEFT"
      },
      {
        keyword: "что такое нейросеть",
        frequencyBase: 501_234,
        sourceQuery: "нейросети",
        sourceColumn: "RIGHT"
      }
    ]
  );
});

test("rejects a result that cannot be aligned with every seed", () => {
  assert.equal(
    parseResult(
      {
        code: "TASK_RESULT",
        task_id: "task-1",
        result: { type: 2, data: { 0: { freq: 1, left: {}, right: {} } } }
      },
      "task-1",
      ["один", "два"],
      100
    ),
    undefined
  );
});
