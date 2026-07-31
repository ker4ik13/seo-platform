import type {
  AutomationRunStatus,
  AutomationSchedule,
  CreateRankTrackingAutomationInput,
  RankTrackingAutomationSummary
} from "@seo-platform/contracts";

export interface RankAutomationDraft {
  readonly name: string;
  readonly trackingContextId: string;
  readonly timezone: string;
  readonly cadence: AutomationSchedule["cadence"];
  readonly hour: string;
  readonly minute: string;
  readonly weekdays: readonly number[];
  readonly maxItems: string;
  readonly failureThreshold: string;
  readonly enabled: boolean;
}

export type RankAutomationDraftErrors = Readonly<
  Partial<
    Record<
      | "name"
      | "trackingContextId"
      | "timezone"
      | "time"
      | "weekdays"
      | "maxItems"
      | "failureThreshold",
      string
    >
  >
>;

export function emptyRankAutomationDraft(
  timezone = browserTimeZone()
): RankAutomationDraft {
  return {
    name: "",
    trackingContextId: "",
    timezone,
    cadence: "DAILY",
    hour: "2",
    minute: "0",
    weekdays: [1],
    maxItems: "1000",
    failureThreshold: "3",
    enabled: false
  };
}

export function rankAutomationDraft(
  automation: RankTrackingAutomationSummary
): RankAutomationDraft {
  return {
    name: automation.name,
    trackingContextId: automation.trackingContextId,
    timezone: automation.timezone,
    cadence: automation.schedule.cadence,
    hour: String(automation.schedule.hour),
    minute: String(automation.schedule.minute),
    weekdays:
      automation.schedule.cadence === "WEEKLY"
        ? automation.schedule.weekdays
        : [1],
    maxItems: String(automation.maxItems),
    failureThreshold: String(automation.failureThreshold),
    enabled: automation.enabled
  };
}

export function validateRankAutomationDraft(
  draft: RankAutomationDraft
): RankAutomationDraftErrors {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Введите название автоматизации.";
  else if (name.length > 160) {
    errors.name = "Название должно содержать не более 160 символов.";
  }
  if (!draft.trackingContextId) {
    errors.trackingContextId = "Выберите активный контекст.";
  }
  if (!validTimeZone(draft.timezone)) {
    errors.timezone = "Укажите действительный часовой пояс IANA.";
  }
  if (
    !boundedInteger(draft.hour, 0, 23) ||
    !boundedInteger(draft.minute, 0, 59)
  ) {
    errors.time = "Время должно быть от 00:00 до 23:59.";
  }
  if (
    draft.cadence === "WEEKLY" &&
    (draft.weekdays.length < 1 ||
      draft.weekdays.some(
        (weekday) =>
          !Number.isSafeInteger(weekday) || weekday < 1 || weekday > 7
      ) ||
      new Set(draft.weekdays).size !== draft.weekdays.length)
  ) {
    errors.weekdays = "Выберите хотя бы один уникальный день недели.";
  }
  if (!boundedInteger(draft.maxItems, 1, 1_000)) {
    errors.maxItems = "Укажите от 1 до 1000 элементов за запуск.";
  }
  if (!boundedInteger(draft.failureThreshold, 1, 10)) {
    errors.failureThreshold = "Укажите от 1 до 10 ошибок.";
  }
  return errors;
}

export function rankAutomationInput(
  draft: RankAutomationDraft
): CreateRankTrackingAutomationInput {
  const schedule: AutomationSchedule =
    draft.cadence === "DAILY"
      ? {
          cadence: "DAILY",
          hour: Number(draft.hour),
          minute: Number(draft.minute)
        }
      : {
          cadence: "WEEKLY",
          hour: Number(draft.hour),
          minute: Number(draft.minute),
          weekdays: [...draft.weekdays].sort(
            (left, right) => left - right
          )
        };
  return {
    name: draft.name.trim().normalize("NFC"),
    trackingContextId: draft.trackingContextId,
    timezone: draft.timezone.trim(),
    schedule,
    maxItems: Number(draft.maxItems),
    failureThreshold: Number(draft.failureThreshold),
    enabled: draft.enabled
  };
}

export function rankAutomationsApiPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/automations`;
}

export function rankAutomationApiPath(
  projectId: string,
  automationId: string
): string {
  return `${rankAutomationsApiPath(projectId)}/${encodeURIComponent(
    automationId
  )}`;
}

export function rankAutomationsReturnTo(projectId: string): string {
  return `/app/projects/${encodeURIComponent(projectId)}/rankings/automations`;
}

export function rankAutomationScheduleLabel(
  schedule: AutomationSchedule,
  timezone: string
): string {
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(
    schedule.minute
  ).padStart(2, "0")}`;
  if (schedule.cadence === "DAILY") {
    return `Каждый день в ${time} · ${timezone}`;
  }
  const weekdays = schedule.weekdays
    .map((weekday) => WEEKDAY_LABELS[weekday] ?? String(weekday))
    .join(", ");
  return `${weekdays} в ${time} · ${timezone}`;
}

export function automationRunStatusLabel(
  status: AutomationRunStatus
): string {
  return RUN_STATUS_LABELS[status];
}

const WEEKDAY_LABELS: Readonly<Record<number, string>> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс"
};

const RUN_STATUS_LABELS: Readonly<Record<AutomationRunStatus, string>> = {
  RUNNING: "Подготовка",
  DISPATCHED: "Выполняется",
  SKIPPED: "Пропущен",
  COMPLETED: "Завершён",
  FAILED: "Ошибка"
};

function boundedInteger(value: string, minimum: number, maximum: number) {
  return (
    /^(?:0|[1-9]\d*)$/u.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: value.trim()
    }).format();
    return value.trim().length > 0 && value.trim().length <= 64;
  } catch {
    return false;
  }
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
