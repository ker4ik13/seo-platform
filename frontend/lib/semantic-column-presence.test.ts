import assert from "node:assert/strict";
import test from "node:test";
import { semanticColumnPresenceKey } from "./semantic-column-presence.ts";

test("dynamic rank columns become bounded realtime-safe presence anchors", () => {
  assert.equal(semanticColumnPresenceKey("query"), "query");
  const key = semanticColumnPresenceKey("rank:YANDEX|RU|213|ru|MOBILE:position");
  assert.match(key, /^dimension:[0-9a-f]+:[0-9a-f]+$/u);
  assert.equal(semanticColumnPresenceKey("rank:YANDEX|RU|213|ru|MOBILE:position"), key);
});
