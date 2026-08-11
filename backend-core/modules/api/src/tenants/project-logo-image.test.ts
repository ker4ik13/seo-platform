import assert from "node:assert/strict";
import test from "node:test";
import { detectedProjectLogoContentType } from "./project-logo-image.js";

test("detects supported project logo formats from bytes", () => {
  assert.equal(
    detectedProjectLogoContentType(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    ),
    "image/png"
  );
  assert.equal(
    detectedProjectLogoContentType(Buffer.from("GIF89a0000", "ascii")),
    "image/gif"
  );
  assert.equal(
    detectedProjectLogoContentType(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>')
    ),
    "image/svg+xml"
  );
});

test("rejects executable or externally active SVG project logos", () => {
  for (const source of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://internal.test/a"/></svg>',
    '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>'
  ]) {
    assert.equal(detectedProjectLogoContentType(Buffer.from(source)), undefined);
  }
});
