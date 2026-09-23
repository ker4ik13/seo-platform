import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("position UI exposes Top-10 only for XMLStock Live and persists it in contexts", async () => {
  const [dialog, settings] = await Promise.all([
    readFile(
      new URL("../components/semantic-position-dialog.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../components/tracking-context-settings.tsx", import.meta.url),
      "utf8"
    )
  ]);

  assert.match(
    dialog,
    /provider === "XMLSTOCK" && searchSource === "LIVE"[\s\S]*\[10, 30, 50, 100\]/u
  );
  assert.match(
    dialog,
    /source === "SEARCH_API" && current\.depth === 10[\s\S]*depth: 30/u
  );
  assert.match(
    dialog,
    /draft\.depth !== 10[\s\S]*semantic-position-turbo-toggle/u
  );
  assert.match(
    settings,
    /draft\.searchSource === "LIVE"[\s\S]*\[10, 30, 50, 100\]/u
  );
  assert.match(
    settings,
    /draft\.depth !== 10[\s\S]*tracking-context-turbo-toggle/u
  );
});
