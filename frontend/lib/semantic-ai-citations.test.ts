import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticAiAnswerMarkdownWithSources,
  semanticAiCitationTitle
} from "./semantic-ai-citations.ts";

const sources = [{
  position: 1,
  providerId: 6,
  url: "https://www.example.com/page",
  belongsToProject: false
}, {
  position: 2,
  url: "https://second.example/path",
  belongsToProject: false
}] as const;

test("replaces adjacent AI citation markers with linked domains", () => {
  assert.equal(
    semanticAiAnswerMarkdownWithSources("Ответ \\[6\\][2].", sources),
    `Ответ [example.com](<https://www.example.com/page> "${semanticAiCitationTitle}")` +
      `[second.example](<https://second.example/path> "${semanticAiCitationTitle}").`
  );
});

test("keeps unknown citations and existing markdown links intact", () => {
  assert.equal(
    semanticAiAnswerMarkdownWithSources("[1](https://already.test) [99]", sources),
    "[1](https://already.test) [99]"
  );
});
