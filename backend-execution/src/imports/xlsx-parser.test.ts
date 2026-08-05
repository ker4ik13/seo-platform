import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_XLSX_BYTES,
  parseXlsxRows
} from "./xlsx-parser.js";

test("rejects an oversized XLSX before consuming object storage", async () => {
  let consumed = false;
  async function* source(): AsyncGenerator<Uint8Array> {
    consumed = true;
    yield Uint8Array.of(1);
  }

  await assert.rejects(
    async () => {
      for await (const _row of parseXlsxRows(
        source(),
        BigInt(MAX_XLSX_BYTES + 1)
      )) {
        // The generator must reject before the source is observed.
      }
    },
    (error: unknown) =>
      error instanceof Error && error.message === "XLSX_TOO_LARGE"
  );
  assert.equal(consumed, false);
});

test("maps an invalid ZIP container to a finite terminal XLSX code", async () => {
  async function* source(): AsyncGenerator<Uint8Array> {
    yield Buffer.from("not an xlsx", "utf8");
  }

  await assert.rejects(
    async () => {
      for await (const _row of parseXlsxRows(source(), 11n)) {
        // No rows are expected from a malformed workbook.
      }
    },
    (error: unknown) =>
      error instanceof Error && error.message === "INVALID_XLSX"
  );
});
