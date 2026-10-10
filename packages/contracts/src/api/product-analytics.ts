export const analyticsSections = [
  "DASHBOARD",
  "SEMANTICS",
  "RANKINGS",
  "SERP",
  "WORDSTAT",
  "AI",
  "CLUSTERING",
  "CRAWL",
  "IMPORT",
  "EXPORT",
  "SETTINGS",
  "BILLING",
  "TEAM",
  "OTHER",
] as const;
export type AnalyticsSection = (typeof analyticsSections)[number];
export const analyticsEventKinds = [
  "PAGE_VIEW",
  "ACTION",
  "RESULT_VIEW",
  "CLIENT_ERROR",
  "API_TIMING",
  "API_ERROR",
  "LCP",
  "CLS",
  "INTERACTION",
] as const;
export type AnalyticsEventKind = (typeof analyticsEventKinds)[number];
export const analyticsLatencyBuckets = [
  50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000,
] as const;
export interface AnalyticsInterval {
  readonly id: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly section: AnalyticsSection;
}
export interface AnalyticsEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly section: AnalyticsSection;
  readonly kind: AnalyticsEventKind;
  readonly count: number;
  readonly value: number;
  readonly histogram?: readonly number[];
}
export interface AnalyticsActivityBatch {
  readonly version: 1;
  readonly sessionId: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly intervals: readonly AnalyticsInterval[];
  readonly events: readonly AnalyticsEvent[];
}
export interface AnalyticsReportQuery {
  readonly days: 7 | 30 | 90;
  readonly includeInternal: boolean;
}
export interface AnalyticsOperationsQuery {
  readonly days: 7 | 30 | 90;
  readonly excludeWorkspaceIds: readonly string[];
}
export interface AnalyticsActivityTotals {
  readonly users: number;
  readonly workspaces: number;
  readonly projects: number;
  readonly seconds: number;
  readonly views: number;
  readonly actions: number;
  readonly results: number;
  readonly sessions: number;
  readonly errors: number;
}
export interface AnalyticsDailyActivity extends AnalyticsActivityTotals {
  readonly date: string;
}
export interface AnalyticsFeature extends AnalyticsActivityTotals {
  readonly section: AnalyticsSection;
  readonly requests: number;
  readonly requestErrors: number;
  readonly latencyP95Ms: number | null;
  readonly latencyAverageMs: number | null;
}
export interface AnalyticsRetention {
  readonly eligible: number;
  readonly returned: number;
}
export interface AnalyticsCohort {
  readonly week: string;
  readonly users: number;
  readonly weeks: readonly AnalyticsRetention[];
}
export interface AnalyticsLifecycleDay {
  readonly date: string;
  readonly registered: number;
  readonly verified: number;
  readonly workspaces: number;
  readonly projects: number;
  readonly invited: number;
  readonly accepted: number;
}
export interface AnalyticsFinanceDay {
  readonly date: string;
  readonly receivedMinor: number;
  readonly refundsMinor: number;
  readonly payments: number;
  readonly payers: number;
}
export interface AnalyticsFinance {
  readonly monthlyPlanValueMinor: number;
  readonly payingWorkspaces: number;
  readonly daily: readonly AnalyticsFinanceDay[];
}
export interface AnalyticsOperationRow {
  readonly key: string;
  readonly total: number;
  readonly completed: number;
  readonly partial: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly processed: number;
  readonly durationP50Ms: number | null;
  readonly durationP95Ms: number | null;
  readonly queueAverageMs: number | null;
  readonly firstResultAverageMs: number | null;
  readonly providerCostMicro: string;
}
export interface AnalyticsOperations {
  readonly since: string | null;
  readonly daily: readonly AnalyticsOperationRow[];
  readonly types: readonly AnalyticsOperationRow[];
  readonly providers: readonly AnalyticsOperationRow[];
  readonly origins: readonly AnalyticsOperationRow[];
  readonly errors: readonly { readonly code: string; readonly count: number }[];
}
export interface ProductAnalyticsReport {
  readonly version: 1;
  readonly generatedAt: string;
  readonly since: string | null;
  readonly period: {
    readonly days: 7 | 30 | 90;
    readonly from: string;
    readonly before: string;
    readonly timezone: "UTC";
    readonly includeInternal: boolean;
  };
  readonly audience: {
    readonly dau: number;
    readonly wau: number;
    readonly mau: number;
    readonly online: number;
    readonly current: AnalyticsActivityTotals;
    readonly previous: AnalyticsActivityTotals;
    readonly d1: AnalyticsRetention;
    readonly d7: AnalyticsRetention;
    readonly d30: AnalyticsRetention;
  };
  readonly daily: readonly AnalyticsDailyActivity[];
  readonly features: readonly AnalyticsFeature[];
  readonly cohorts: readonly AnalyticsCohort[];
  readonly activation: {
    readonly registered: number;
    readonly verified: number;
    readonly engaged: number;
    readonly resultViewed: number;
    readonly timeToValueMedianMs: number | null;
  };
  readonly lifecycle: readonly AnalyticsLifecycleDay[];
  readonly operations: AnalyticsOperations | null;
  readonly finance?: AnalyticsFinance;
  readonly quality: {
    readonly apiRequests: number;
    readonly apiErrors: number;
    readonly apiP95Ms: number | null;
    readonly lcpAverageMs: number | null;
    readonly clsAverageMilli: number | null;
    readonly interactionP95Ms: number | null;
    readonly serverErrors: readonly {
      readonly service: string;
      readonly code: string;
      readonly count: number;
    }[];
    readonly serverErrorDaily: readonly {
      readonly date: string;
      readonly count: number;
    }[];
  };
  readonly degraded: readonly ("OPERATIONS" | "FINANCE")[];
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
function exact(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TypeError("Invalid analytics object");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new TypeError("Invalid analytics identifier");
  return value;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max)
    throw new TypeError("Invalid analytics number");
  return Number(value);
}
function time(value: unknown, now: number): string {
  if (
    typeof value !== "string" ||
    !ISO.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) < now - 86_400_000 ||
    Date.parse(value) > now + 5000
  )
    throw new TypeError("Invalid analytics time");
  return value;
}
function section(value: unknown): AnalyticsSection {
  if (!analyticsSections.includes(value as AnalyticsSection))
    throw new TypeError("Invalid analytics section");
  return value as AnalyticsSection;
}
export function parseAnalyticsActivityBatch(
  value: unknown,
  now = Date.now(),
): AnalyticsActivityBatch {
  const body = exact(value, [
    "version",
    "sessionId",
    "workspaceId",
    "projectId",
    "intervals",
    "events",
  ]);
  if (
    body.version !== 1 ||
    !Array.isArray(body.intervals) ||
    body.intervals.length > 32 ||
    !Array.isArray(body.events) ||
    body.events.length > 32 ||
    body.intervals.length + body.events.length === 0 ||
    JSON.stringify(value).length > 64 * 1024
  )
    throw new TypeError("Invalid analytics batch");
  const intervals = body.intervals.map((value) => {
    const row = exact(value, ["id", "startedAt", "durationMs", "section"]);
    const startedAt = time(row.startedAt, now),
      durationMs = integer(row.durationMs, 60_000);
    if (durationMs < 1 || Date.parse(startedAt) + durationMs > now + 5000)
      throw new TypeError("Invalid activity interval");
    return {
      id: id(row.id),
      startedAt,
      durationMs,
      section: section(row.section),
    };
  });
  const events = body.events.map((value) => {
    const row = exact(value, [
      "id",
      "occurredAt",
      "section",
      "kind",
      "count",
      "value",
      "histogram",
    ]);
    if (!analyticsEventKinds.includes(row.kind as AnalyticsEventKind))
      throw new TypeError("Invalid analytics event");
    const count = integer(row.count, 1000),
      amount = integer(row.value, 60_000_000);
    if (count < 1) throw new TypeError("Invalid event count");
    const kind = row.kind as AnalyticsEventKind;
    if (
      (kind === "API_TIMING" || kind === "INTERACTION") &&
      (!Array.isArray(row.histogram) ||
        row.histogram.length !== analyticsLatencyBuckets.length + 1 ||
        row.histogram.some(
          (value) => !Number.isSafeInteger(value) || Number(value) < 0,
        ) ||
        row.histogram.reduce((sum: number, value: number) => sum + value, 0) !==
          count ||
        amount > count * 60_000)
    )
      throw new TypeError("Invalid timing distribution");
    if (
      kind !== "API_TIMING" &&
      kind !== "INTERACTION" &&
      row.histogram !== undefined
    )
      throw new TypeError("Unexpected histogram");
    return {
      id: id(row.id),
      occurredAt: time(row.occurredAt, now),
      section: section(row.section),
      kind,
      count,
      value: amount,
      ...(row.histogram === undefined
        ? {}
        : { histogram: row.histogram as number[] }),
    };
  });
  const ids = [...intervals, ...events].map((row) => row.id);
  if (new Set(ids).size !== ids.length)
    throw new TypeError("Duplicate analytics event");
  return {
    version: 1,
    sessionId: id(body.sessionId),
    ...(body.workspaceId === undefined
      ? {}
      : { workspaceId: id(body.workspaceId) }),
    ...(body.projectId === undefined ? {} : { projectId: id(body.projectId) }),
    intervals,
    events,
  };
}
export function parseAnalyticsReportQuery(
  value: unknown,
): AnalyticsReportQuery {
  const row = exact(value, ["days", "includeInternal"]);
  const days = row.days === undefined ? 30 : Number(row.days);
  if (
    ![7, 30, 90].includes(days) ||
    Array.isArray(row.days) ||
    (row.includeInternal !== undefined &&
      ![true, false, "true", "false"].includes(row.includeInternal as boolean))
  )
    throw new TypeError("Invalid analytics report query");
  return {
    days: days as 7 | 30 | 90,
    includeInternal:
      row.includeInternal === true || row.includeInternal === "true",
  };
}
export function parseAnalyticsOperationsQuery(
  value: unknown,
): AnalyticsOperationsQuery {
  const row = exact(value, ["days", "excludeWorkspaceIds"]);
  if (
    !Array.isArray(row.excludeWorkspaceIds) ||
    row.excludeWorkspaceIds.length > 10_000
  )
    throw new TypeError("Invalid analytics workspace exclusions");
  return {
    days: parseAnalyticsReportQuery({ days: row.days }).days,
    excludeWorkspaceIds: row.excludeWorkspaceIds.map(id),
  };
}

/** Strict cross-service/browser consumer. No extra fields or tenant data enter reports. */
export function parseAnalyticsOperations(value: unknown): AnalyticsOperations {
  const body = exact(value, [
    "since",
    "daily",
    "types",
    "providers",
    "origins",
    "errors",
  ]);
  if (
    body.since !== null &&
    (typeof body.since !== "string" || !ISO.test(body.since))
  )
    throw new TypeError("Invalid analytics coverage");
  const rows = (value: unknown, max: number): AnalyticsOperationRow[] => {
    if (!Array.isArray(value) || value.length > max)
      throw new TypeError("Invalid operation analytics rows");
    return value.map((value) => {
      const row = exact(value, [
        "key",
        "total",
        "completed",
        "partial",
        "failed",
        "cancelled",
        "processed",
        "durationP50Ms",
        "durationP95Ms",
        "queueAverageMs",
        "firstResultAverageMs",
        "providerCostMicro",
      ]);
      if (
        typeof row.key !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/u.test(row.key) ||
        typeof row.providerCostMicro !== "string" ||
        !/^\d{1,24}$/u.test(row.providerCostMicro)
      )
        throw new TypeError("Invalid analytics dimension");
      for (const key of [
        "total",
        "completed",
        "partial",
        "failed",
        "cancelled",
        "processed",
      ])
        integer(row[key]);
      for (const key of [
        "durationP50Ms",
        "durationP95Ms",
        "queueAverageMs",
        "firstResultAverageMs",
      ])
        if (row[key] !== null) integer(row[key]);
      return row as unknown as AnalyticsOperationRow;
    });
  };
  if (!Array.isArray(body.errors) || body.errors.length > 50)
    throw new TypeError("Invalid analytics errors");
  const errors = body.errors.map((value) => {
    const row = exact(value, ["code", "count"]);
    if (typeof row.code !== "string" || !/^[A-Z0-9_]{1,64}$/u.test(row.code))
      throw new TypeError("Invalid error code");
    return { code: row.code, count: integer(row.count) };
  });
  return {
    since: body.since as string | null,
    daily: rows(body.daily, 90),
    types: rows(body.types, 50),
    providers: rows(body.providers, 20),
    origins: rows(body.origins, 3),
    errors,
  };
}

export function parseProductAnalyticsReport(
  value: unknown,
): ProductAnalyticsReport {
  const root = exact(value, [
    "version",
    "generatedAt",
    "since",
    "period",
    "audience",
    "daily",
    "features",
    "cohorts",
    "lifecycle",
    "activation",
    "operations",
    "finance",
    "quality",
    "degraded",
  ]);
  const timestamp = (value: unknown, nullable = false) => {
    if (nullable && value === null) return;
    if (
      typeof value !== "string" ||
      !ISO.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new TypeError("Invalid analytics timestamp");
  };
  const date = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
      throw new TypeError("Invalid analytics date");
  };
  const list = (value: unknown, max: number) => {
    if (!Array.isArray(value) || value.length > max)
      throw new TypeError("Invalid analytics list");
    return value;
  };
  const counts = (value: unknown, extra: readonly string[] = []) => {
    const keys = [
      "users",
      "workspaces",
      "projects",
      "seconds",
      "views",
      "actions",
      "results",
      "sessions",
      "errors",
    ];
    const row = exact(value, [...keys, ...extra]);
    for (const key of keys) integer(row[key]);
    return row;
  };
  const retention = (value: unknown) => {
    const row = exact(value, ["eligible", "returned"]);
    integer(row.eligible);
    integer(row.returned);
    if (Number(row.returned) > Number(row.eligible))
      throw new TypeError("Invalid retention");
  };
  if (root.version !== 1)
    throw new TypeError("Invalid analytics report version");
  timestamp(root.generatedAt);
  timestamp(root.since, true);
  const period = exact(root.period, [
    "days",
    "from",
    "before",
    "timezone",
    "includeInternal",
  ]);
  parseAnalyticsReportQuery({
    days: period.days,
    includeInternal: period.includeInternal,
  });
  timestamp(period.from);
  timestamp(period.before);
  if (period.timezone !== "UTC" || typeof period.includeInternal !== "boolean")
    throw new TypeError("Invalid report period");
  const audience = exact(root.audience, [
    "dau",
    "wau",
    "mau",
    "online",
    "current",
    "previous",
    "d1",
    "d7",
    "d30",
  ]);
  for (const key of ["dau", "wau", "mau", "online"]) integer(audience[key]);
  counts(audience.current);
  counts(audience.previous);
  for (const key of ["d1", "d7", "d30"]) retention(audience[key]);
  for (const row of list(root.daily, 90)) {
    const day = counts(row, ["date"]);
    date(day.date);
  }
  for (const value of list(root.features, analyticsSections.length)) {
    const row = counts(value, [
      "section",
      "requests",
      "requestErrors",
      "latencyP95Ms",
      "latencyAverageMs",
    ]);
    section(row.section);
    integer(row.requests);
    integer(row.requestErrors);
    for (const key of ["latencyP95Ms", "latencyAverageMs"])
      if (row[key] !== null) integer(row[key]);
  }
  for (const value of list(root.cohorts, 14)) {
    const row = exact(value, ["week", "users", "weeks"]);
    date(row.week);
    integer(row.users);
    for (const cell of list(row.weeks, 9)) retention(cell);
  }
  for (const value of list(root.lifecycle, 90)) {
    const row = exact(value, [
      "date",
      "registered",
      "verified",
      "workspaces",
      "projects",
      "invited",
      "accepted",
    ]);
    date(row.date);
    for (const key of [
      "registered",
      "verified",
      "workspaces",
      "projects",
      "invited",
      "accepted",
    ])
      integer(row[key]);
  }
  const activation = exact(root.activation, [
    "registered",
    "verified",
    "engaged",
    "resultViewed",
    "timeToValueMedianMs",
  ]);
  for (const key of Object.keys(activation))
    if (activation[key] !== null) integer(activation[key]);
  if (root.operations !== null) parseAnalyticsOperations(root.operations);
  if (root.finance !== undefined) {
    const row = exact(root.finance, [
      "monthlyPlanValueMinor",
      "payingWorkspaces",
      "daily",
    ]);
    integer(row.monthlyPlanValueMinor);
    integer(row.payingWorkspaces);
    for (const value of list(row.daily, 90)) {
      const day = exact(value, [
        "date",
        "receivedMinor",
        "refundsMinor",
        "payments",
        "payers",
      ]);
      date(day.date);
      for (const key of ["receivedMinor", "refundsMinor", "payments", "payers"])
        integer(day[key]);
    }
  }
  const quality = exact(root.quality, [
    "apiRequests",
    "apiErrors",
    "apiP95Ms",
    "lcpAverageMs",
    "clsAverageMilli",
    "interactionP95Ms",
    "serverErrors",
    "serverErrorDaily",
  ]);
  for (const key of [
    "apiRequests",
    "apiErrors",
    "apiP95Ms",
    "lcpAverageMs",
    "clsAverageMilli",
    "interactionP95Ms",
  ])
    if (quality[key] !== null) integer(quality[key]);
  for (const value of list(quality.serverErrors, 50)) {
    const row = exact(value, ["service", "code", "count"]);
    if (
      typeof row.service !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/u.test(row.service) ||
      typeof row.code !== "string" ||
      !/^[A-Z0-9_]{1,80}$/u.test(row.code)
    )
      throw new TypeError("Invalid diagnostic aggregate");
    integer(row.count);
  }
  for (const value of list(quality.serverErrorDaily, 16)) {
    const row = exact(value, ["date", "count"]);
    date(row.date);
    integer(row.count);
  }
  for (const value of list(root.degraded, 2))
    if (value !== "OPERATIONS" && value !== "FINANCE")
      throw new TypeError("Invalid degraded source");
  return root as unknown as ProductAnalyticsReport;
}
