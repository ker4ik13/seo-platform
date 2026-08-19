import assert from "node:assert/strict";
import test from "node:test";
import { aiAnswerSeoFailureCode } from "./ai-answer-runtime.service.js";

test("does not mask an invalid persisted AI answer as a missing keyword", () => {
  assert.equal(
    aiAnswerSeoFailureCode("INVALID_COMMAND"),
    "AI_ANSWER_RESULT_REJECTED"
  );
  assert.equal(aiAnswerSeoFailureCode("NOT_FOUND"), "KEYWORD_NOT_AVAILABLE");
  assert.equal(aiAnswerSeoFailureCode("CONFLICT"), "KEYWORD_VERSION_CONFLICT");
});
