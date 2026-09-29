import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../components/operation-result-workspace.tsx", import.meta.url),
  "utf8"
);

test("XMLStock monitor distinguishes live leases from physical HTTP threads", () => {
  assert.match(component, /label=\{uiText\("Заданий в обработке"\)\}/u);
  assert.match(component, /HTTP-запросов на один ключ/u);
  assert.match(component, /entry\.sequence \+ 1/u);
  assert.doesNotMatch(component, /Активных потоков|rankRuntimeLaneColor/u);
});
