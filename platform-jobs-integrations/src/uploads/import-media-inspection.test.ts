import assert from "node:assert/strict";
import test from "node:test";
import { inspectImportMedia } from "./import-media-inspection.js";

test("accepts text imports including non-UTF8 bytes", () => {
  assert.equal(
    inspectImportMedia(
      Buffer.from("keyword\tgroup\r\nкупить\tтовары", "utf8"),
      "text/tab-separated-values"
    ).accepted,
    true
  );
  assert.equal(
    inspectImportMedia(
      Buffer.from([0xca, 0xeb, 0xfe, 0xf7, 0xe8]),
      "text/csv"
    ).accepted,
    true
  );
});

test("requires container signatures for Excel and ZIP", () => {
  assert.deepEqual(
    inspectImportMedia(
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ),
    { accepted: true, detectedMediaType: "application/zip" }
  );
  assert.equal(
    inspectImportMedia(
      Buffer.from("not an xls", "utf8"),
      "application/vnd.ms-excel"
    ).rejectionCode,
    "MIME_SIGNATURE_MISMATCH"
  );
});

test("rejects executable and binary content disguised as CSV", () => {
  assert.equal(
    inspectImportMedia(
      Buffer.from([0x4d, 0x5a, 0x00, 0x00]),
      "text/csv"
    ).rejectionCode,
    "FORBIDDEN_FILE_SIGNATURE"
  );
  assert.equal(
    inspectImportMedia(
      Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]),
      "text/csv"
    ).rejectionCode,
    "BINARY_TEXT_FILE"
  );
});
