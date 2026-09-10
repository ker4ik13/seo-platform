import assert from "node:assert/strict";
import test from "node:test";
import {
  aiAnswerHtmlToMarkdown,
  arsenkinAiAnswerRequest,
  arsenkinAiAnswerValues
} from "./arsenkin-ai-answer.connector.js";

const query = "подбор подшипника по нагрузке";
const context = {
  searchEngine: "YANDEX" as const,
  regionCode: "225",
  device: "DESKTOP" as const,
  host: "nt-g.ru",
  excludeSubdomains: false,
  brands: ["Новая Технология"]
};

test("builds the documented Arsenkin ai-serp request", () => {
  assert.deepEqual(
    arsenkinAiAnswerRequest({ ...context, keywords: [`  ${query}  `] }),
    {
      tools_name: "ai-serp",
      data: {
        queries: [query],
        se: 1,
        region: 225,
        device: "desktop",
        host: "nt-g.ru",
        subdomain: false,
        brands: ["Новая Технология"]
      }
    }
  );
});

test("normalizes the documented ai-serp result and removes executable HTML", () => {
  const result = arsenkinAiAnswerValues(
    {
      code: "TASK_RESULT",
      task_id: 42,
      result: {
        queries: [query],
        info: { se: "Яндекс" },
        table: [
          {
            found: 1,
            position: { position: 2, url: "https://nt-g.ru/podshipniki" },
            brand: 1,
            details: "<h2>Подбор подшипника</h2><p>Используйте <strong>нагрузку</strong>.</p><script>alert('x')</script>",
            sources: [
              {
                id: 7,
                url: "https://nt-g.ru/podshipniki",
                title: "Подбор подшипника",
                description: "Расчёт по нагрузке"
              }
            ]
          }
        ]
      }
    },
    "42",
    [query],
    context
  );

  assert.equal(result?.length, 1);
  assert.deepEqual(result?.[0]?.snapshot, {
    answerPresent: true,
    siteFound: true,
    position: 2,
    rankingUrl: "https://nt-g.ru/podshipniki",
    brandFound: true,
    answerMarkdown: "## Подбор подшипника\n\nИспользуйте **нагрузку**.",
    sources: [
      {
        providerId: 7,
        url: "https://nt-g.ru/podshipniki",
        title: "Подбор подшипника",
        description: "Расчёт по нагрузке"
      }
    ]
  });
  assert.doesNotMatch(result?.[0]?.snapshot.answerMarkdown ?? "", /alert|script/u);
});

test("rejects ambiguous query-to-row alignment", () => {
  const result = arsenkinAiAnswerValues(
    {
      code: "TASK_RESULT",
      task_id: "task-1",
      result: {
        queries: ["другой запрос"],
        info: { se: "Яндекс" },
        table: [{ found: 0, brand: 0, details: "", sources: [] }]
      }
    },
    "task-1",
    [query],
    context
  );
  assert.equal(result, undefined);
});

test("accepts omitted optional fields when brands or an AI answer are absent", () => {
  const secondQuery = "ресурс подшипника L10";
  const result = arsenkinAiAnswerValues(
    {
      code: "TASK_RESULT",
      task_id: "task-optional",
      result: {
        queries: [secondQuery.toLocaleLowerCase("ru-RU"), query],
        info: { se: "Яндекс" },
        table: [
          {
            found: false,
            position: false
          },
          {
            found: true,
            position: false,
            details: "<p>Ответ без упоминания проверяемого сайта.</p>",
            sources: [
              {
                id: 1,
                url: "https://example.com/source",
                title: "Источник",
                description: null
              }
            ]
          }
        ]
      }
    },
    "task-optional",
    [query, secondQuery],
    { ...context, brands: [] }
  );

  assert.deepEqual(result?.map(({ snapshot }) => snapshot), [
    {
      answerPresent: true,
      siteFound: false,
      brandFound: false,
      answerMarkdown: "Ответ без упоминания проверяемого сайта.",
      sources: [
        {
          providerId: 1,
          url: "https://example.com/source",
          title: "Источник"
        }
      ]
    },
    {
      answerPresent: false,
      siteFound: false,
      brandFound: false,
      sources: []
    }
  ]);
});

test("HTML converter preserves readable structure without raw tags", () => {
  assert.equal(
    aiAnswerHtmlToMarkdown("<p>Первый<br>второй</p><ul><li>Пункт</li></ul>"),
    "Первый\nвторой\n\n- Пункт"
  );
  assert.equal(
    aiAnswerHtmlToMarkdown(
      "<p>[ссылка](javascript:alert(1))</p><script>alert(2)</script>"
    ),
    "\\[ссылка\\]\\(javascript:alert\\(1\\)\\)"
  );
});

test("keeps an unambiguous Google AI top when the row omits source details", () => {
  const result = arsenkinAiAnswerValues(
    {
      code: "TASK_RESULT",
      task_id: "google-one",
      result: {
        queries: [query],
        info: { se: "Google" },
        table: [{
          found: true,
          position: false,
          brand: false,
          details: "Google AI Overview",
          sources: []
        }],
        top: {
          urls: {
            "https://competitor.example/one": 1,
            "https://competitor.example/two": 1
          }
        }
      }
    },
    "google-one",
    [query],
    {
      ...context,
      searchEngine: "GOOGLE",
      regionCode: "1011969"
    }
  );

  assert.deepEqual(result?.[0]?.snapshot.sources, [
    { url: "https://competitor.example/one" },
    { url: "https://competitor.example/two" }
  ]);
});

test("does not assign an aggregate Google top across several queries", () => {
  const secondQuery = "второй google ai запрос";
  const result = arsenkinAiAnswerValues(
    {
      code: "TASK_RESULT",
      task_id: "google-many",
      result: {
        queries: [query, secondQuery],
        info: { se: "Google" },
        table: [
          { found: true, position: false, brand: false, sources: [] },
          { found: true, position: false, brand: false, sources: [] }
        ],
        top: { urls: { "https://competitor.example/ambiguous": 2 } }
      }
    },
    "google-many",
    [query, secondQuery],
    {
      ...context,
      searchEngine: "GOOGLE",
      regionCode: "1011969"
    }
  );

  assert.deepEqual(result?.map(({ snapshot }) => snapshot.sources), [[], []]);
});
