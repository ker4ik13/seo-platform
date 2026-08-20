import assert from "node:assert/strict";
import test from "node:test";
import {
  arsenkinClusteringRequest,
  arsenkinClusteringValues
} from "./arsenkin-clustering.connector.js";

const keywords = ["купить диван", "диван цена", "ремонт дивана"] as const;
const context = {
  searchEngine: "YANDEX" as const,
  regionCode: "213",
  method: "SOFT" as const,
  overlapCount: 3,
  depth: 20 as const,
  excludeMainPages: true,
  stopDomains: ["market.yandex.ru"],
  frequencyTypes: ["OVERALL", "EXACT"] as const
};

test("builds the documented Arsenkin clustering command", () => {
  assert.deepEqual(arsenkinClusteringRequest({ ...context, keywords }), {
    tools_name: "clustering",
    data: {
      queries: [...keywords],
      se: 1,
      region: 213,
      group: "soft",
      count: 3,
      depth: 20,
      stoplist: ["market.yandex.ru"],
      ws: ["overal", "exact"],
      main: true
    }
  });
});

test("normalizes clustered and unclustered provider rows without positional guessing", () => {
  const result = arsenkinClusteringValues(
    {
      code: "TASK_RESULT",
      task_id: "cluster-42",
      result: {
        info: { se: "Яндекс" },
        queries: [keywords[1], keywords[0], keywords[2]],
        table: [
          {
            query: keywords[1],
            clustered: "Коммерческие диваны",
            topurl: "https://example.com/divany",
            ws: "1 200",
            ws_strict: 310,
            agregators: "12,5%",
            geo: "Да"
          },
          {
            query: keywords[0],
            cluster: "Коммерческие диваны",
            topurl: "https://example.com/divany",
            wssumm: "2400",
            main: 2
          },
          { query: keywords[2], geo: false }
        ]
      }
    },
    "cluster-42",
    keywords,
    context
  );

  assert.deepEqual(result?.clusters, [{
    sequence: 0,
    providerKey: "коммерческие диваны",
    name: "Коммерческие диваны",
    topUrl: "https://example.com/divany",
    topUrls: [{ url: "https://example.com/divany" }],
    frequencySum: "2400",
    mainPageCount: 2
  }]);
  assert.deepEqual(result?.items, [
    { sequence: 0, query: keywords[0], clusterSequence: 0 },
    {
      sequence: 1,
      query: keywords[1],
      clusterSequence: 0,
      frequency: "1200",
      exactFrequency: "310",
      aggregatorsPercent: 12.5,
      geoDependent: true
    },
    { sequence: 2, query: keywords[2], geoDependent: false }
  ]);
});

test("preserves cluster-level metrics in the grouped Arsenkin result shape", () => {
  const result = arsenkinClusteringValues(
    {
      code: "TASK_RESULT",
      task_id: "cluster-43",
      result: {
        info: { se: "Яндекс" },
        clustered: [{
          name: "Коммерческие диваны",
          topurl: "https://example.com/divany",
          wssumm: 2400,
          main: "2",
          words: [
            { words: keywords[0], ws: 1200 },
            keywords[1]
          ]
        }],
        unclustered: [{ words: keywords[2], geo: "Нет" }]
      }
    },
    "cluster-43",
    keywords,
    context
  );

  assert.deepEqual(result?.clusters, [{
    sequence: 0,
    providerKey: "коммерческие диваны",
    name: "Коммерческие диваны",
    topUrl: "https://example.com/divany",
    topUrls: [{ url: "https://example.com/divany" }],
    frequencySum: "2400",
    mainPageCount: 2
  }]);
  assert.deepEqual(result?.items, [
    { sequence: 0, query: keywords[0], clusterSequence: 0, frequency: "1200" },
    { sequence: 1, query: keywords[1], clusterSequence: 0 },
    { sequence: 2, query: keywords[2], geoDependent: false }
  ]);
});

test("parses the nested clustering shape returned by Arsenkin", () => {
  const result = arsenkinClusteringValues(
    {
      code: "TASK_RESULT",
      task_id: "cluster-44",
      result: {
        clustering: {
          clustered: {
            "Коммерческие диваны": {
              topurl: "https://example.com/divany",
              topurls: {
                "https://example.com/divany": 2,
                "https://market.example.com/divany": { count: 1 }
              },
              wssumm: 2400,
              words: {
                [keywords[0]]: {
                  agregators: "12.5%",
                  main: true,
                  toponim: "Москва",
                  ws: 1200
                },
                [keywords[1]]: {
                  agregators: 8,
                  main: false,
                  ws: "900"
                }
              }
            }
          },
          single: {
            [keywords[2]]: {
              topurl: "https://example.com/remont",
              words: {
                [keywords[2]]: {
                  main: false,
                  ws: 300
                }
              }
            }
          }
        }
      }
    },
    "cluster-44",
    keywords,
    context
  );

  assert.deepEqual(result?.clusters, [{
    sequence: 0,
    providerKey: "коммерческие диваны",
    name: "Коммерческие диваны",
    topUrl: "https://example.com/divany",
    topUrls: [
      { url: "https://example.com/divany", overlapCount: 2 },
      { url: "https://market.example.com/divany", overlapCount: 1 }
    ],
    frequencySum: "2400"
  }]);
  assert.deepEqual(result?.items, [
    {
      sequence: 0,
      query: keywords[0],
      clusterSequence: 0,
      frequency: "1200",
      aggregatorsPercent: 12.5,
      toponym: "Москва"
    },
    {
      sequence: 1,
      query: keywords[1],
      clusterSequence: 0,
      frequency: "900",
      aggregatorsPercent: 8
    },
    { sequence: 2, query: keywords[2], frequency: "300" }
  ]);
});

test("rejects missing, duplicate and foreign keyword rows", () => {
  assert.equal(arsenkinClusteringValues(
    {
      code: "TASK_RESULT",
      task_id: "cluster-42",
      result: {
        info: { se: "Яндекс" },
        table: [
          { query: keywords[0], cluster: "Диваны" },
          { query: keywords[0], cluster: "Диваны" },
          { query: "чужой запрос", cluster: "Диваны" }
        ]
      }
    },
    "cluster-42",
    keywords,
    context
  ), undefined);
});
