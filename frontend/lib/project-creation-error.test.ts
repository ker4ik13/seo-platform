import assert from "node:assert/strict";
import test from "node:test";
import { BrowserApiError } from "./browser-api.ts";
import { projectCreationErrorMessage } from "./project-creation-error.ts";

test("explains the project quota instead of blaming form validation", () => {
  assert.match(
    projectCreationErrorMessage(
      new BrowserApiError(
        409,
        "QUOTA_EXCEEDED",
        "The projects limit for the current plan has been reached"
      )
    ),
    /Лимит проектов/u
  );
});

test("keeps the form retryable on dependency failures", () => {
  assert.equal(
    projectCreationErrorMessage(
      new BrowserApiError(503, "PROVIDER_UNAVAILABLE", "unavailable")
    ),
    "Сервис временно недоступен. Данные формы сохранены."
  );
});
