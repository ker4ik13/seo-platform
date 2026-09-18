import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/u;
const CODE = /^[A-Z][A-Z0-9_]{0,79}$/u;
const FINGERPRINT = /^[a-f0-9]{16,64}$/u;
const TOKEN = /^[!-~]{32,255}$/u;
const BOT_TOKEN = /^\d{6,15}:[A-Za-z0-9_-]{30,80}$/u;
const CHAT_ID = /^-?\d{1,20}$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const BODY_LIMIT_BYTES = 4_096;
const DELIVERY_TIMEOUT_MS = 5_000;
const CLIENT_TIMEOUT_MS = 1_500;
const DEDUPE_WINDOW_MS = 5 * 60_000;
const RATE_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT = 20;
const CONTEXT_KEY = /^[a-z][A-Za-z0-9]{0,31}$/u;
const MAX_CONTEXT_ENTRIES = 10;
const MAX_CONTEXT_VALUE_LENGTH = 128;

export type OperationalAlertSeverity = "ERROR" | "CRITICAL";

export interface OperationalAlertInput {
  readonly source: string;
  readonly code: string;
  readonly severity: OperationalAlertSeverity;
  readonly fingerprint?: string;
  /** Bounded, pre-redacted diagnostic fields. Never pass secrets or PII. */
  readonly context?: Readonly<Record<string, string>>;
}

export interface OperationalAlertReporter {
  capture(alert: OperationalAlertInput): boolean;
  flush(): Promise<void>;
}

interface AlertEnvelope extends OperationalAlertInput {
  readonly version: 1;
  readonly service: string;
}

interface AlertEnvelopeReporter {
  capture(envelope: AlertEnvelope): boolean;
  flush(): Promise<void>;
  confirm?(envelope: AlertEnvelope): Promise<boolean>;
}

interface ReporterDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly writeDiagnostic?: (message: string) => void;
}

export function createOperationalAlertClient(
  env: NodeJS.ProcessEnv,
  service: string,
  dependencies: ReporterDependencies = {}
): OperationalAlertReporter {
  assertIdentifier(service, "operational alert service");
  if (!enabled(env)) return NOOP_REPORTER;
  const origin = canonicalHttpOrigin(
    required(env, "OPERATIONAL_ALERTS_INTERNAL_URL")
  );
  const token = secret(env, "OPERATIONAL_ALERT_TOKEN", TOKEN);
  return new QueuedReporter(
    service,
    async (envelope) => {
      const response = await (dependencies.fetch ?? fetch)(
        new URL("/internal/alerts", origin),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(envelope),
          redirect: "error",
          signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS)
        }
      );
      await response.body?.cancel();
      if (response.status !== 202) {
        throw new Error("Operational alert receiver rejected the event");
      }
    },
    dependencies
  );
}

/** Business monitors retain a durable pending flag until Telegram delivery is acknowledged. */
export async function sendConfirmedOperationalAlert(env: NodeJS.ProcessEnv, service: string, alert: OperationalAlertInput, dependencies: ReporterDependencies = {}): Promise<boolean> {
  if (!enabled(env)) return false;
  const origin = canonicalHttpOrigin(required(env, "OPERATIONAL_ALERTS_INTERNAL_URL"));
  const token = secret(env, "OPERATIONAL_ALERT_TOKEN", TOKEN);
  try {
    const response = await (dependencies.fetch ?? fetch)(new URL("/internal/alerts/confirmed", origin), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(alertEnvelope(service, alert)), redirect: "error", signal: AbortSignal.timeout(8_000) });
    await response.body?.cancel();
    return response.status === 200;
  } catch { return false; }
}

export async function startOperationalAlertServer(
  env: NodeJS.ProcessEnv,
  dependencies: ReporterDependencies = {}
): Promise<Server> {
  const token = secret(env, "OPERATIONAL_ALERT_TOKEN", TOKEN);
  const reporter = telegramReporter(env, dependencies);
  const hostname = env.BIND_ADDRESS?.trim() || "127.0.0.1";
  const port = boundedInteger(
    env.OPERATIONAL_ALERTS_PORT ?? "4004",
    "OPERATIONAL_ALERTS_PORT",
    1,
    65_535
  );
  const server = createServer((request, response) => {
    void handleRequest(request, response, token, reporter).catch((error: unknown) => {
      const status = error instanceof HttpInputError ? error.status : 500;
      if (!response.headersSent) empty(response, status);
      else response.end();
    });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 100;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, hostname, () => {
      server.off("error", onError);
      resolve();
    });
  });
  server.on("close", () => {
    void reporter.flush();
  });
  return server;
}

export function installUncaughtExceptionAlert(
  reporter: OperationalAlertReporter,
  source = "supervisor"
): () => void {
  assertIdentifier(source, "operational alert source");
  const listener = (error: Error): void => {
    reporter.capture({
      source,
      code: "UNCAUGHT_EXCEPTION",
      severity: "CRITICAL",
      fingerprint: localFingerprint(error)
    });
  };
  process.on("uncaughtExceptionMonitor", listener);
  return () => process.off("uncaughtExceptionMonitor", listener);
}

export function localFingerprint(value: unknown): string {
  let preimage: string = typeof value;
  if (value instanceof Error) {
    preimage = `${value.name}\u0000${value.stack ?? "NO_STACK"}`;
  }
  return createHash("sha256").update(preimage, "utf8").digest("hex").slice(0, 16);
}

class QueuedReporter implements OperationalAlertReporter {
  private queue: Promise<void> = Promise.resolve();
  private readonly observed = new Map<string, number>();

  public constructor(
    private readonly service: string,
    private readonly deliver: (envelope: AlertEnvelope) => Promise<void>,
    private readonly dependencies: ReporterDependencies
  ) {}

  public capture(alert: OperationalAlertInput): boolean {
    const envelope = alertEnvelope(this.service, alert);
    const now = (this.dependencies.now ?? Date.now)();
    const dedupeKey = [
      envelope.source,
      envelope.code,
      envelope.fingerprint ?? "NO_FINGERPRINT"
    ].join("\u0000");
    const previous = this.observed.get(dedupeKey);
    if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) {
      return false;
    }
    this.prune(now);
    this.observed.set(dedupeKey, now);
    this.queue = this.queue
      .then(() => this.deliver(envelope))
      .catch(() => {
        (this.dependencies.writeDiagnostic ?? defaultDiagnostic)(
          "[operational-alerts] delivery unavailable\n"
        );
      });
    return true;
  }

  public async flush(): Promise<void> {
    for (;;) {
      const pending = this.queue;
      await pending;
      if (pending === this.queue) return;
    }
  }

  private prune(now: number): void {
    if (this.observed.size < 256) return;
    for (const [key, observedAt] of this.observed) {
      if (now - observedAt >= DEDUPE_WINDOW_MS) this.observed.delete(key);
    }
    while (this.observed.size >= 256) {
      const oldest = this.observed.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.observed.delete(oldest);
    }
  }
}

function telegramReporter(
  env: NodeJS.ProcessEnv,
  dependencies: ReporterDependencies
): AlertEnvelopeReporter {
  if (!enabled(env)) return NOOP_ENVELOPE_REPORTER;
  const botToken = secret(env, "TELEGRAM_ALERT_BOT_TOKEN", BOT_TOKEN);
  const chatId = secret(env, "TELEGRAM_ALERT_CHAT_ID", CHAT_ID);
  const threadId = optionalInteger(env.TELEGRAM_ALERT_THREAD_ID, "TELEGRAM_ALERT_THREAD_ID");
  const environment = label(env.TELEGRAM_ALERT_ENVIRONMENT ?? env.NODE_ENV ?? "unknown", "TELEGRAM_ALERT_ENVIRONMENT");
  const serviceVersion = label(env.SERVICE_VERSION ?? "unknown", "SERVICE_VERSION");
  return new TelegramEnvelopeReporter(
    botToken,
    chatId,
    threadId,
    environment,
    serviceVersion,
    dependencies
  );
}

class TelegramEnvelopeReporter implements AlertEnvelopeReporter {
  private queue: Promise<void> = Promise.resolve();
  private readonly observed = new Map<string, number>();
  private readonly confirmed = new Map<string, number>();
  private readonly confirming = new Map<string, Promise<boolean>>();
  private windowStartedAt = 0;
  private sentInWindow = 0;

  public constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly threadId: number | undefined,
    private readonly environment: string,
    private readonly serviceVersion: string,
    private readonly dependencies: ReporterDependencies
  ) {}

  public capture(envelope: AlertEnvelope): boolean {
    const now = (this.dependencies.now ?? Date.now)();
    pruneObservations(this.observed, now);
    if (now - this.windowStartedAt >= RATE_WINDOW_MS) {
      this.windowStartedAt = now;
      this.sentInWindow = 0;
    }
    const key = [
      envelope.service,
      envelope.source,
      envelope.code,
      envelope.fingerprint ?? "NO_FINGERPRINT"
    ].join("\u0000");
    const previous = this.observed.get(key);
    if (
      previous !== undefined &&
      now - previous < DEDUPE_WINDOW_MS
    ) {
      return false;
    }
    if (this.sentInWindow >= RATE_LIMIT) return false;
    this.observed.set(key, now);
    this.sentInWindow += 1;
    this.queue = this.queue
      .then(() => this.deliver(envelope, now))
      .catch(() => {
        (this.dependencies.writeDiagnostic ?? defaultDiagnostic)(
          "[operational-alerts] telegram delivery unavailable\n"
        );
      });
    return true;
  }

  public async flush(): Promise<void> {
    for (;;) {
      const pending = this.queue;
      await pending;
      if (pending === this.queue) return;
    }
  }

  public async confirm(envelope: AlertEnvelope): Promise<boolean> {
    const now = (this.dependencies.now ?? Date.now)();
    const key = [envelope.service, envelope.source, envelope.code, envelope.fingerprint ?? ""].join("\u0000");
    const confirmedAt = this.confirmed.get(key);
    if (confirmedAt !== undefined && now - confirmedAt < DEDUPE_WINDOW_MS) return true;
    const existing = this.confirming.get(key); if (existing) return existing;
    if (now - this.windowStartedAt >= RATE_WINDOW_MS) { this.windowStartedAt = now; this.sentInWindow = 0; }
    if (this.sentInWindow >= RATE_LIMIT) return false;
    this.sentInWindow++;
    const pending = this.queue.then(async () => {
      try { await this.deliver(envelope, now); pruneObservations(this.confirmed, now); this.confirmed.set(key, now); return true; }
      catch { return false; }
    });
    this.queue = pending.then(() => {});
    this.confirming.set(key, pending);
    try { return await pending; } finally { this.confirming.delete(key); }
  }

  private async deliver(
    envelope: AlertEnvelope,
    observedAt: number
  ): Promise<void> {
    const body: Record<string, unknown> = {
      chat_id: this.chatId,
      text: telegramMessage(
        envelope,
        this.environment,
        this.serviceVersion,
        new Date(observedAt)
      ),
      parse_mode: "HTML",
      disable_web_page_preview: true
    };
    if (this.threadId !== undefined) {
      body.message_thread_id = this.threadId;
    }
    const response = await (this.dependencies.fetch ?? fetch)(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
      }
    );
    await response.body?.cancel();
    if (!response.ok) {
      throw new Error("Telegram rejected an operational alert");
    }
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  reporter: AlertEnvelopeReporter
): Promise<void> {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  if (request.url === "/health/live" || request.url === "/health/ready") {
    if (request.method !== "GET") return empty(response, 405);
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.writeHead(200);
    response.end('{"status":"ok"}');
    return;
  }
  if (request.url !== "/internal/alerts" && request.url !== "/internal/alerts/confirmed") return empty(response, 404);
  if (request.method !== "POST") return empty(response, 405);
  if (!authorized(request.headers.authorization, token)) return empty(response, 401);
  if (request.headers["content-type"] !== "application/json") return empty(response, 415);
  const envelope = parseEnvelope(await readBody(request));
  if (request.url === "/internal/alerts/confirmed") return empty(response, await reporter.confirm?.(envelope) ? 200 : 503);
  reporter.capture(envelope);
  return empty(response, 202);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT_BYTES) throw new HttpInputError(413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseEnvelope(body: string): AlertEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new HttpInputError(400);
  }
  if (!plainRecord(parsed)) throw new HttpInputError(400);
  const expected = [
    "code",
    ...(parsed.context === undefined ? [] : ["context"]),
    ...(parsed.fingerprint === undefined ? [] : ["fingerprint"]),
    "service",
    "severity",
    "source",
    "version"
  ].sort();
  if (Object.keys(parsed).sort().join("\u0000") !== expected.join("\u0000")) {
    throw new HttpInputError(400);
  }
  if (parsed.version !== 1 || (parsed.severity !== "ERROR" && parsed.severity !== "CRITICAL")) {
    throw new HttpInputError(400);
  }
  if (typeof parsed.service !== "string" || !IDENTIFIER.test(parsed.service)) throw new HttpInputError(400);
  if (typeof parsed.source !== "string" || !IDENTIFIER.test(parsed.source)) throw new HttpInputError(400);
  if (typeof parsed.code !== "string" || !CODE.test(parsed.code)) throw new HttpInputError(400);
  if (parsed.fingerprint !== undefined && (typeof parsed.fingerprint !== "string" || !FINGERPRINT.test(parsed.fingerprint))) {
    throw new HttpInputError(400);
  }
  let context: Readonly<Record<string, string>> | undefined;
  try {
    context = operationalAlertContext(parsed.context);
  } catch {
    throw new HttpInputError(400);
  }
  return {
    version: 1,
    service: parsed.service,
    source: parsed.source,
    code: parsed.code,
    severity: parsed.severity,
    ...(parsed.fingerprint ? { fingerprint: parsed.fingerprint } : {}),
    ...(context ? { context } : {})
  };
}

function alertEnvelope(service: string, alert: OperationalAlertInput): AlertEnvelope {
  assertIdentifier(alert.source, "operational alert source");
  if (!CODE.test(alert.code)) throw new TypeError("Invalid operational alert code");
  if (alert.severity !== "ERROR" && alert.severity !== "CRITICAL") throw new TypeError("Invalid operational alert severity");
  if (alert.fingerprint !== undefined && !FINGERPRINT.test(alert.fingerprint)) throw new TypeError("Invalid operational alert fingerprint");
  const context = operationalAlertContext(alert.context);
  return {
    version: 1,
    service,
    source: alert.source,
    code: alert.code,
    severity: alert.severity,
    ...(alert.fingerprint ? { fingerprint: alert.fingerprint } : {}),
    ...(context ? { context } : {})
  };
}

function telegramMessage(
  envelope: AlertEnvelope,
  environment: string,
  serviceVersion: string,
  observedAt: Date
): string {
  const balance = /^(XMLSTOCK|ARSENKIN)_LOW_BALANCE_([1-9][0-9]?)$/u.exec(envelope.code);
  if (balance) return ["SEOньорита: пора пополнить API-аккаунт", `${balance[1] === "XMLSTOCK" ? "XMLStock" : "Arsenkin"} #${balance[2]}: остаток ниже 500 ₽.`, ...(balance[1] === "ARSENKIN" ? ["Для Arsenkin это денежная оценка оставшихся лимитов."] : []), "Подробности — в разделе провайдеров административной панели.", `Среда: ${environment}`, `Время: ${observedAt.toISOString()}`].join("\n");
  return [
    "SEO Platform: внутренняя ошибка",
    `Среда: ${environment}`,
    `Сервис: ${envelope.service}`,
    `Источник: ${envelope.source}`,
    `Код: ${envelope.code}`,
    `Критичность: ${envelope.severity}`,
    ...(envelope.fingerprint ? [`Отпечаток: ${envelope.fingerprint}`] : []),
    ...(envelope.context
      ? [
          "Диагностика (секреты и персональные данные исключены):",
          `<blockquote>${Object.entries(envelope.context)
            .map(([key, value]) =>
              escapeTelegramHtml(`${key}: ${value}`)
            )
            .join("\n")}</blockquote>`
        ]
      : []),
    `Версия: ${serviceVersion}`,
    `Время: ${observedAt.toISOString()}`
  ].join("\n");
}

function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function operationalAlertContext(
  value: unknown
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!plainRecord(value)) throw new TypeError("Invalid operational alert context");
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > MAX_CONTEXT_ENTRIES) {
    throw new TypeError("Invalid operational alert context");
  }
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (
      !CONTEXT_KEY.test(key) ||
      typeof item !== "string" ||
      item.length < 1 ||
      item.length > MAX_CONTEXT_VALUE_LENGTH ||
      [...item].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 0x20 || code > 0x7e;
      })
    ) {
      throw new TypeError("Invalid operational alert context");
    }
    result[key] = item;
  }
  return result;
}

function pruneObservations(values: Map<string, number>, now: number): void {
  if (values.size < 1024) return;
  for (const [key, observedAt] of values) if (now - observedAt >= DEDUPE_WINDOW_MS) values.delete(key);
  while (values.size >= 1024) { const key = values.keys().next().value; if (key === undefined) break; values.delete(key); }
}

function enabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.TELEGRAM_ALERTS_ENABLED ?? "false";
  if (value !== "true" && value !== "false") throw new Error("TELEGRAM_ALERTS_ENABLED must be true or false");
  return value === "true";
}

function canonicalHttpOrigin(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("OPERATIONAL_ALERTS_INTERNAL_URL must be a canonical HTTP origin");
  }
  if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.origin !== value) {
    throw new Error("OPERATIONAL_ALERTS_INTERNAL_URL must be a canonical HTTP origin");
  }
  return parsed;
}

function secret(env: NodeJS.ProcessEnv, name: string, pattern: RegExp): string {
  const value = required(env, name);
  if (!pattern.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function label(value: string, name: string): string {
  if (!LABEL.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function optionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  return boundedInteger(value, name, 1, 2_147_483_647);
}

function boundedInteger(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}

function authorized(header: string | undefined, token: string): boolean {
  if (header === undefined) return false;
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  const actual = Buffer.from(header, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function assertIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new TypeError(`Invalid ${name}`);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function empty(response: ServerResponse, status: number): void {
  response.writeHead(status);
  response.end();
}

function defaultDiagnostic(message: string): void {
  process.stderr.write(message);
}

class HttpInputError extends Error {
  public constructor(public readonly status: number) {
    super("Invalid operational alert request");
  }
}

const NOOP_REPORTER: OperationalAlertReporter = Object.freeze({
  capture: () => false,
  flush: async () => undefined
});

const NOOP_ENVELOPE_REPORTER: AlertEnvelopeReporter = Object.freeze({
  capture: () => false,
  flush: async () => undefined
});
