import assert from "node:assert/strict";
import test from "node:test";
import { utf8Sha256 } from "@seo-platform/contracts/canonical-json";
import { XmlStockCredentialValidationConnector } from "../integrations/xmlstock-credential-validation.connector.js";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import {
  XmlStockRankConnector,
  stageXmlStockRankResult,
  type XmlStockRankFetchResult,
  type XmlStockRankPageProgress
} from "./xmlstock-rank.connector.js";
import type { RankProviderRequestIntentV1 } from "./rank-provider-request-intent.js";

interface PaidMatrixCase {
  readonly engine: "YANDEX" | "GOOGLE";
  readonly device: "DESKTOP" | "MOBILE";
  readonly depth: 10 | 30 | 50 | 100;
  readonly depthMode: "STRICT_DEPTH" | "STOP_AFTER_FOUND";
  readonly turbo: boolean;
}

const paidMatrix = (["YANDEX", "GOOGLE"] as const).flatMap((engine) =>
  (["DESKTOP", "MOBILE"] as const).flatMap((device) =>
    (["STRICT_DEPTH", "STOP_AFTER_FOUND"] as const).flatMap((depthMode) =>
      ([10, 30, 50, 100] as const).map((depth) => ({
        engine,
        device,
        depth,
        depthMode,
        turbo: false
      }))
    )
  )
).concat(
  (["DESKTOP", "MOBILE"] as const).flatMap((device) =>
    (["STRICT_DEPTH", "STOP_AFTER_FOUND"] as const).flatMap((depthMode) =>
      ([30, 50, 100] as const).map((depth) => ({
        engine: "YANDEX" as const,
        device,
        depth,
        depthMode,
        turbo: true
      }))
    )
  )
) satisfies readonly PaidMatrixCase[];

test("XMLStock paid smoke matrix covers every Live engine, device, depth and paging mode", () => {
  assert.equal(paidMatrix.length, 44);
  assert.equal(maximumPaidRequests(paidMatrix), 168);
  assert.equal(
    paidMatrix.filter(({ turbo, depth }) => turbo && depth === 50).length,
    4
  );
  assert.equal(
    paidMatrix.filter(({ turbo, depth }) => turbo && depth === 100).length,
    4
  );
});

const paidEnvironment = paidTestEnvironment(process.env);

test(
  "runs the explicitly budgeted XMLStock paid smoke matrix",
  {
    skip: paidEnvironment === undefined,
    timeout: 15 * 60 * 1_000
  },
  async () => {
    assert.ok(paidEnvironment);
    const secret: IntegrationCredentialSecret = {
      accountIdentifier: paidEnvironment.accountId,
      apiKey: paidEnvironment.apiKey
    };
    const validation = await new XmlStockCredentialValidationConnector()
      .validate(secret, 8_000);
    assert.equal(validation.ok, true, "read-only XMLStock preflight failed");
    if (!validation.ok) return;
    const prices = xmlStockPrices(validation.providerMeta);
    const selectedMatrix = paidEnvironment.filter === "TURBO"
      ? paidMatrix.filter(({ turbo }) => turbo)
      : paidEnvironment.filter === "TURBO_TOP100"
        ? paidMatrix.filter(({ turbo, depth }) => turbo && depth === 100)
        : paidMatrix;
    const maximumCost =
      matrixMaximumCostRoubles(selectedMatrix, prices) *
      paidEnvironment.queries.length;
    assert.ok(
      maximumCost <= paidEnvironment.maximumCostRoubles,
      `paid matrix costs up to ${maximumCost.toFixed(4)} RUB, above the accepted budget`
    );

    let paidRequests = 0;
    let spentRoubles = 0;
    let sequence = 0;
    const executions = paidEnvironment.queries.flatMap((query) =>
      selectedMatrix.map((matrixCase) => ({
        query,
        matrixCase,
        sequence: sequence++
      }))
    );
    await mapConcurrent(executions, 6, async ({ query, matrixCase, sequence }) => {
        const casePages = new Set<number>();
        const connector = new XmlStockRankConnector(async (input, init) => {
          const url = new URL(String(input));
          if (
            url.pathname === "/google/xml/" ||
            url.pathname === "/yandexlive/xml/"
          ) {
            if (matrixCase.turbo) {
              assert.equal(url.searchParams.get("groupby"), "50");
            }
            const requestPrice = url.pathname === "/google/xml/"
              ? prices.GOOGLE_LIVE / 1_000
              : url.searchParams.get("tbm") === "turbo"
                ? prices.YANDEX_TURBO / 1_000
                : prices.YANDEX_LIVE / 1_000;
            assert.ok(
              spentRoubles + requestPrice <= paidEnvironment.maximumCostRoubles,
              "XMLStock paid matrix reached its explicit RUB budget"
            );
            spentRoubles += requestPrice;
            paidRequests += 1;
            const page = Number(url.searchParams.get("page"));
            if (Number.isSafeInteger(page) && page >= 0) casePages.add(page);
          }
          return fetch(input, init);
        });
        const intent = rankIntent(
          matrixCase,
          sequence,
          query,
          paidEnvironment.projectDomain
        );
        const submitted = await connector.submit(intent, secret, 15_000);
        const label = `${matrixCase.engine}/${matrixCase.device}/TOP${matrixCase.depth}/${matrixCase.depthMode}/${matrixCase.turbo ? "TURBO" : "STANDARD"}`;
        assert.equal(submitted.status, "ACCEPTED", label);
        if (submitted.status !== "ACCEPTED") return;
        const ready = await liveResult(
          connector,
          submitted.taskId,
          secret,
          intent,
          label
        );
        const row = stageXmlStockRankResult(
          ready.value,
          submitted.taskId,
          intent,
          new Date().toISOString()
        ).snapshot.results[0];
        assert.ok(row);
        assert.ok((row.serpResults?.length ?? 0) <= matrixCase.depth);
        if (matrixCase.turbo) {
          assertContiguousSerpPositions(row.serpResults ?? [], label);
        }
        if (
          matrixCase.turbo &&
          matrixCase.depth === 100 &&
          matrixCase.depthMode === "STRICT_DEPTH"
        ) {
          assert.deepEqual(
            [...casePages].sort((left, right) => left - right),
            [0, 1],
            `${label}: Turbo Top-100 must address page=0 and page=1 only`
          );
          assertDistinctTurboPages(row.serpResults ?? []);
        }
    });
    assert.ok(paidRequests >= selectedMatrix.length * paidEnvironment.queries.length);
    assert.ok(
      spentRoubles <= paidEnvironment.maximumCostRoubles,
      "XMLStock paid matrix exceeded its explicit RUB budget"
    );
  }
);

function paidTestEnvironment(env: NodeJS.ProcessEnv): Readonly<{
  accountId: string;
  apiKey: string;
  maximumCostRoubles: number;
  queries: readonly string[];
  projectDomain: string;
  filter?: "TURBO" | "TURBO_TOP100";
}> | undefined {
  if (env.XMLSTOCK_PAID_TEST_EXECUTE !== "true") return undefined;
  const accountId = env.XMLSTOCK_PAID_TEST_ACCOUNT_ID?.trim();
  const apiKey = env.XMLSTOCK_PAID_TEST_API_KEY?.trim();
  const maximumCostRoubles = Number(env.XMLSTOCK_PAID_TEST_MAX_RUB);
  const queries = (env.XMLSTOCK_PAID_TEST_QUERIES ?? env.XMLSTOCK_PAID_TEST_QUERY ?? "xmlstock")
    .split("\n")
    .map((query) => query.trim())
    .filter(Boolean);
  const projectDomain =
    env.XMLSTOCK_PAID_TEST_PROJECT_DOMAIN?.trim() || "xmlstock.com";
  const filter = env.XMLSTOCK_PAID_TEST_FILTER?.trim();
  if (
    !accountId ||
    !apiKey ||
    !Number.isFinite(maximumCostRoubles) ||
    maximumCostRoubles <= 0 ||
    queries.length < 1 ||
    queries.length > 3 ||
    queries.some((query) => query.length > 300) ||
    !/^[a-z0-9.-]+$/iu.test(projectDomain) ||
    (filter !== undefined &&
      filter !== "" &&
      filter !== "TURBO" &&
      filter !== "TURBO_TOP100")
  ) {
    throw new Error("Complete the XMLStock paid-test environment and RUB budget");
  }
  return {
    accountId,
    apiKey,
    maximumCostRoubles,
    queries,
    projectDomain,
    ...(filter === "TURBO" || filter === "TURBO_TOP100" ? { filter } : {})
  };
}

function assertDistinctTurboPages(
  results: readonly Readonly<{
    readonly position: number;
    readonly rankingUrl: string;
  }>[]
): void {
  const first = results
    .filter(({ position }) => position <= 50)
    .map(({ rankingUrl }) => rankingUrl);
  const second = results
    .filter(({ position }) => position > 50)
    .map(({ rankingUrl }) => rankingUrl);
  if (first.length === 0 || second.length === 0) return;
  assert.notDeepEqual(
    second.slice(0, Math.min(first.length, second.length)),
    first.slice(0, Math.min(first.length, second.length)),
    "Turbo Top-100 page=1 must not repeat page=0"
  );
}

function assertContiguousSerpPositions(
  results: readonly Readonly<{ readonly position: number }>[],
  label: string
): void {
  for (const [index, result] of results.entries()) {
    assert.equal(
      result.position,
      index + 1,
      `${label}: Turbo SERP positions must not contain page-width gaps`
    );
  }
}

function maximumPaidRequests(cases: readonly PaidMatrixCase[]): number {
  return cases.reduce(
    (total, item) =>
      total + Math.ceil(item.depth / (item.turbo ? 50 : 10)),
    0
  );
}

function matrixMaximumCostRoubles(
  cases: readonly PaidMatrixCase[],
  prices: Readonly<{
    YANDEX_LIVE: number;
    YANDEX_TURBO: number;
    GOOGLE_LIVE: number;
  }>
): number {
  return cases.reduce((total, item) => {
    const requests = Math.ceil(item.depth / (item.turbo ? 50 : 10));
    const price = item.turbo
      ? prices.YANDEX_TURBO
      : item.engine === "GOOGLE"
        ? prices.GOOGLE_LIVE
        : prices.YANDEX_LIVE;
    return total + requests * price / 1_000;
  }, 0);
}

function xmlStockPrices(value: unknown): Readonly<{
  YANDEX_LIVE: number;
  YANDEX_TURBO: number;
  GOOGLE_LIVE: number;
}> {
  const meta = record(value);
  const pricing = record(meta?.xmlStockPricing);
  const prices = record(pricing?.pricesPerThousand);
  const result = {
    YANDEX_LIVE: Number(prices?.YANDEX_LIVE),
    YANDEX_TURBO: Number(prices?.YANDEX_TURBO),
    GOOGLE_LIVE: Number(prices?.GOOGLE_LIVE)
  };
  if (Object.values(result).some((price) => !Number.isFinite(price) || price < 0)) {
    throw new Error("XMLStock did not return safe account pricing");
  }
  return result;
}

async function liveResult(
  connector: XmlStockRankConnector,
  taskId: string,
  secret: IntegrationCredentialSecret,
  intent: RankProviderRequestIntentV1,
  label: string
): Promise<Extract<XmlStockRankFetchResult, { readonly status: "READY" }>> {
  let progress: XmlStockRankPageProgress | undefined;
  let completedPages = 0;
  for (let attempt = 0; attempt < 30 && completedPages < 10; attempt += 1) {
    const result = await connector.fetchResult(
      taskId,
      secret,
      25_000,
      intent,
      progress
    );
    if (result.status === "READY") return result;
    if (result.status === "CHECKPOINTED") {
      progress = result.progress;
      completedPages += 1;
      continue;
    }
    if (result.status === "RETRYABLE_FAILURE") {
      await delay((result.retryAfterSeconds ?? 1) * 1_000);
      continue;
    }
    if (result.status === "PENDING") {
      await delay(result.retryAfterSeconds * 1_000);
      continue;
    }
    throw new Error(
      `${label}: XMLStock returned ${result.status}` +
      ("code" in result ? `/${result.code}` : "")
    );
  }
  throw new Error(`${label}: XMLStock paid matrix exhausted bounded retries`);
}

async function mapConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  run: (value: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  let firstError: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length && firstError === undefined) {
        const index = cursor;
        cursor += 1;
        try {
          await run(values[index]!);
        } catch (error) {
          firstError ??= error;
        }
      }
    })
  );
  if (firstError !== undefined) throw firstError;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rankIntent(
  matrixCase: PaidMatrixCase,
  index: number,
  query: string,
  projectDomain: string
): RankProviderRequestIntentV1 {
  const providerMappingVersion = matrixCase.engine === "GOOGLE"
    ? "xmlstock-google-live@2"
    : matrixCase.turbo
      ? "xmlstock-yandex-live@3"
      : "xmlstock-yandex-live@2";
  return {
    schemaVersion: "rank-provider-request-intent@1",
    workspaceId: id(1),
    projectId: id(2),
    actorId: id(3),
    jobId: id(4),
    jobItemId: id(100 + index),
    estimateId: id(5),
    provider: "XMLSTOCK",
    operation: "POSITIONS",
    project: { domain: projectDomain, version: 1 },
    execution: {
      searchEngine: matrixCase.engine,
      countryCode: "RU",
      regionCode: matrixCase.engine === "YANDEX" ? "213" : "1011969",
      language: "ru",
      device: matrixCase.device,
      depth: matrixCase.depth,
      xmlStockDepthMode: matrixCase.depthMode,
      domainMatchRule: { mode: "INCLUDE_WWW" },
      safeSearch: false,
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE",
      providerMappingVersion
    },
    manifest: {
      id: id(6),
      hashSchemaVersion: "rank-manifest@1",
      manifestHash: hash("a"),
      pairCount: "1"
    },
    manifestChunk: {
      manifestId: id(6),
      chunkIndex: 0,
      hashSchemaVersion: "rank-manifest-chunk@1",
      chunkHash: hash("b")
    },
    executionConnectorVersion: "xmlstock-serp@1.0.0",
    providerPolicyVersion: "manual-xmlstock-serp@2.0.0",
    keywords: [{
      manifestEntryId: id(7),
      sequence: 0,
      keywordId: id(8),
      keywordText: query,
      keywordTextHash: {
        algorithm: "SHA_256",
        value: utf8Sha256(query)
      },
      language: "ru"
    }]
  };
}

function id(value: number): string {
  return `01900000-0000-7000-8000-${String(value).padStart(12, "0")}`;
}

function hash(character: string): Readonly<{
  algorithm: "SHA_256";
  value: string;
}> {
  return { algorithm: "SHA_256", value: character.repeat(64) };
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}
