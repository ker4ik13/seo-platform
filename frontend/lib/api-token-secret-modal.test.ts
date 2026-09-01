import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("one-time API token secret cannot be dismissed before it is copied", () => {
  const settingsSource = readFileSync(
    new URL("../components/api-token-settings.tsx", import.meta.url),
    "utf8"
  );
  const modalSource = readFileSync(
    new URL("../components/semantic-modal.tsx", import.meta.url),
    "utf8"
  );

  assert.match(settingsSource, /closeDisabled=\{!issuedCopied\}/u);
  assert.match(settingsSource, /onCopy=\{handleIssuedTokenCopy\}/u);
  assert.match(
    settingsSource,
    /window\.getSelection\(\)\?\.toString\(\) !== secretText/u
  );
  assert.match(settingsSource, /disabled=\{!issuedCopied\}/u);
  assert.match(modalSource, /if \(!closeDisabled\) onClose\(\)/u);
  assert.match(modalSource, /disabled=\{closeDisabled\}/u);
});
