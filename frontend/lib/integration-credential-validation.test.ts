import assert from "node:assert/strict";
import test from "node:test";
import type {
  IntegrationCredentialValidationStatus,
  IntegrationCredentialValidationSummary
} from "@seo-platform/contracts";
import {
  credentialValidationFailureMessage,
  credentialValidationPollDelayMs,
  credentialValidationPresentation,
  credentialValidationTransientRetryDelayMs,
  isTerminalCredentialValidationStatus,
  isTransientCredentialValidationPollError,
  persistedCredentialValidationPresentation,
  shouldAutoResumeCredentialValidation,
  supportsAutomaticCredentialValidation
} from "./integration-credential-validation.ts";

test("offers automatic validation only for account metadata mode", () => {
  assert.equal(
    supportsAutomaticCredentialValidation("ACCOUNT_METADATA"),
    true
  );
  assert.equal(
    supportsAutomaticCredentialValidation(
      "PROVIDER_DOCUMENTATION_REQUIRED"
    ),
    false
  );
  assert.equal(supportsAutomaticCredentialValidation(undefined), false);
});

test("polls every nonterminal credential validation status", () => {
  const nonTerminal: readonly IntegrationCredentialValidationStatus[] = [
    "QUEUED",
    "RUNNING",
    "RETRY_SCHEDULED"
  ];
  const terminal: readonly IntegrationCredentialValidationStatus[] = [
    "SUCCEEDED",
    "FAILED_RETRYABLE",
    "FAILED_FINAL",
    "STALE"
  ];

  for (const status of nonTerminal) {
    assert.equal(isTerminalCredentialValidationStatus(status), false);
  }
  for (const status of terminal) {
    assert.equal(isTerminalCredentialValidationStatus(status), true);
  }
});

test("does not resume a stale validation forever after reopening settings", () => {
  const nowMs = Date.parse("2026-09-17T10:20:00.000Z");
  assert.equal(
    shouldAutoResumeCredentialValidation(
      { status: "RUNNING", requestedAt: "2026-09-17T10:15:00.000Z" },
      nowMs
    ),
    true
  );
  assert.equal(
    shouldAutoResumeCredentialValidation(
      { status: "RETRY_SCHEDULED", requestedAt: "2026-09-17T09:00:00.000Z" },
      nowMs
    ),
    false
  );
  assert.equal(
    shouldAutoResumeCredentialValidation(
      { status: "SUCCEEDED", requestedAt: "2026-09-17T10:19:00.000Z" },
      nowMs
    ),
    false
  );
  assert.equal(
    shouldAutoResumeCredentialValidation(
      { status: "QUEUED", requestedAt: "invalid" },
      nowMs
    ),
    false
  );
});

test("uses honest terminal messages for success, stale and provider failures", () => {
  assert.deepEqual(credentialValidationPresentation("SUCCEEDED"), {
    message: "Провайдер подтвердил доступ к аккаунту.",
    terminal: true,
    tone: "success"
  });
  assert.equal(
    credentialValidationPresentation("STALE").message,
    "Ключ изменился во время проверки. Запустите её ещё раз."
  );
  assert.deepEqual(
    credentialValidationPresentation("RETRY_SCHEDULED"),
    {
      message:
        "Проверка временно отложена. Повторная попытка запланирована автоматически.",
      terminal: false,
      tone: "warning"
    }
  );
  assert.equal(
    credentialValidationPresentation(
      "FAILED_FINAL",
      "PROVIDER_PLAN_OR_REQUEST_REJECTED"
    ).message,
    "Провайдер отклонил запрос. Проверьте тариф и доступ к API."
  );
});

test("does not expose unknown provider errors", () => {
  assert.equal(
    credentialValidationFailureMessage("RAW_PROVIDER_SECRET_RESPONSE"),
    "Проверка завершилась ошибкой. Повторите её или обновите подключение."
  );
});

test("presents the persisted credential outcome after reload", () => {
  assert.equal(
    persistedCredentialValidationPresentation("ACTIVE")?.tone,
    "success"
  );
  assert.deepEqual(
    persistedCredentialValidationPresentation(
      "RATE_LIMITED",
      "PROVIDER_RATE_LIMITED"
    ),
    {
      message:
        "Провайдер временно ограничил запросы. Повторите проверку позже.",
      terminal: true,
      tone: "warning"
    }
  );
  assert.equal(
    persistedCredentialValidationPresentation(
      "PENDING_VERIFICATION"
    ),
    undefined
  );
});

test("uses retryAt without polling past the remaining timeout", () => {
  const nowMs = Date.parse("2026-07-29T10:00:00.000Z");
  const retryScheduled = validation({
    status: "RETRY_SCHEDULED",
    retryAt: "2026-07-29T10:00:12.000Z"
  });
  assert.equal(
    credentialValidationPollDelayMs(retryScheduled, {
      defaultDelayMs: 2_000,
      maxDelayMs: 30_000,
      nowMs
    }),
    12_000
  );
  assert.equal(
    credentialValidationPollDelayMs(retryScheduled, {
      defaultDelayMs: 2_000,
      maxDelayMs: 5_000,
      nowMs
    }),
    5_000
  );
  assert.equal(
    credentialValidationPollDelayMs(
      validation({ status: "RUNNING" }),
      {
        defaultDelayMs: 2_000,
        maxDelayMs: 30_000,
        nowMs
      }
    ),
    2_000
  );
});

test("retries only transient polling failures", () => {
  assert.equal(
    isTransientCredentialValidationPollError(
      browserApiError(429)
    ),
    true
  );
  assert.equal(
    isTransientCredentialValidationPollError(
      browserApiError(503)
    ),
    true
  );
  assert.equal(
    isTransientCredentialValidationPollError(
      browserApiError(403)
    ),
    false
  );
  assert.equal(
    isTransientCredentialValidationPollError(new TypeError("fetch failed")),
    true
  );
  assert.equal(
    isTransientCredentialValidationPollError(new Error("invalid response")),
    false
  );
});

test("uses bounded exponential backoff with jitter", () => {
  assert.equal(credentialValidationTransientRetryDelayMs(1, 0.5), 750);
  assert.equal(credentialValidationTransientRetryDelayMs(2, 0.5), 1_500);
  assert.equal(credentialValidationTransientRetryDelayMs(4, 0.5), 6_000);
  assert.equal(credentialValidationTransientRetryDelayMs(20, 1), 8_000);
});

function validation(
  input: Pick<IntegrationCredentialValidationSummary, "status"> &
    Partial<Pick<IntegrationCredentialValidationSummary, "retryAt">>
): Pick<IntegrationCredentialValidationSummary, "retryAt" | "status"> {
  return input;
}

function browserApiError(status: number): Error & { readonly status: number } {
  return Object.assign(new Error("Browser API failed"), {
    name: "BrowserApiError",
    status
  });
}
