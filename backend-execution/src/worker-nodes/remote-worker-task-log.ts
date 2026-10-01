import type { RemoteRankPollTaskV1, RemoteWorkTask } from "@seo-platform/contracts";

type WorkerTask = RemoteWorkTask | RemoteRankPollTaskV1;

const capabilityLabels: Readonly<Record<string, string>> = {
  RANK: "позиции и выдача",
  WORDSTAT: "частотность",
  RESEARCH: "расширение семантики",
  AI_ANSWER: "ИИ-ответы",
  CLUSTERING: "кластеризация",
  CRAWL: "обход сайта",
  IMPORT: "импорт",
  EXPORT: "экспорт",
  INSPECTION: "антивирус"
};

/** Never includes a credential, provider task ID, ticket, URL or raw payload. */
export function workerTaskLogContext(task: WorkerTask, logQueries: boolean): string {
  const rank = task.schemaVersion === "worker-rank-poll-task@1";
  const intent = rank ? record(task.requestSnapshot) : undefined;
  const id = rank ? safeUuid(intent?.jobItemId) : task.id;
  const capability = rank ? "RANK" : task.capability;
  const label = capabilityLabels[capability] ?? "операция";
  const provider = rank ? "XMLStock" : providerName(task);
  const phrases = logQueries ? taskPhrases(task, intent) : [];
  const secretValues = rank
    ? [task.secret.apiKey, task.secret.accountIdentifier]
    : Array.isArray(task.payload.sensitiveValues) ? task.payload.sensitiveValues : [];
  const safePhrases = phrases.slice(0, 3).flatMap(value => {
    const phrase = safePhrase(value, secretValues);
    return phrase ? [JSON.stringify(phrase)] : [];
  });
  return `${label} · ${provider} · задание ${id}${safePhrases.length
    ? ` · фразы ${safePhrases.join(", ")}${phrases.length > 3 ? ` (+${phrases.length - 3})` : ""}`
    : ""}`;
}

export function workerTaskStartLog(context: string): string {
  return `Воркер: начал ${context}`;
}

export function workerTaskFinishLog(context: string, elapsedMs: number, errorCode?: string): string {
  const elapsed = Math.max(0, Math.round(elapsedMs));
  return errorCode
    ? `Воркер: ошибка ${errorCode} · ${context} · ${elapsed} мс · ответ передан центру`
    : `Воркер: обработал ${context} · ${elapsed} мс · ответ передан центру`;
}

function taskPhrases(task: WorkerTask, intent: Record<string, unknown> | undefined): unknown[] {
  if (task.schemaVersion === "worker-rank-poll-task@1") {
    return Array.isArray(intent?.keywords) ? intent.keywords.map(item => record(item)?.keywordText) : [];
  }
  if (task.command !== "PROVIDER_HTTP") return [];
  const urlValue = task.payload.url;
  if (typeof urlValue !== "string") return [];
  let url: URL;
  try { url = new URL(urlValue); } catch { return []; }
  if (url.hostname === "xmlstock.com") return [url.searchParams.get("query")];
  if (url.hostname !== "arsenkin.ru" || url.pathname !== "/api/tools/set") return [];
  const body = task.payload.body;
  if (typeof body !== "string") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return []; }
  const input = record(parsed);
  const nested = record(input?.data);
  const values = input?.queries ?? nested?.queries;
  return Array.isArray(values) ? values : [];
}

function providerName(task: RemoteWorkTask): string {
  if (task.command !== "PROVIDER_HTTP" || typeof task.payload.url !== "string") return "внутренняя задача";
  try {
    const host = new URL(task.payload.url).hostname;
    if (host === "xmlstock.com") return "XMLStock";
    if (host === "arsenkin.ru") return "Arsenkin";
    if (host === "api.keys.so") return "Keys.so";
  } catch { /* The executor reports the invalid request without logging it. */ }
  return "провайдер";
}

function safePhrase(value: unknown, secrets: readonly unknown[]): string | undefined {
  if (typeof value !== "string") return undefined;
  let phrase = value.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) phrase = phrase.replaceAll(secret, "[скрыто]");
  }
  return phrase ? phrase.slice(0, 160) : undefined;
}

function safeUuid(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/iu.test(value) ? value : "без ID";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
