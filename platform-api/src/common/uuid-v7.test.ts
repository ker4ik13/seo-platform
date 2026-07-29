import assert from "node:assert/strict";
import test from "node:test";
import { uuidV7 } from "./uuid-v7.js";

test("encodes the RFC 9562 timestamp, version and variant deterministically", () => {
  assert.equal(
    uuidV7(0x0123456789ab, Buffer.alloc(16, 0xff)),
    "01234567-89ab-7fff-bfff-ffffffffffff"
  );
});

test("rejects an invalid timestamp or entropy length", () => {
  assert.throws(() => uuidV7(-1), {
    message: "UUIDv7 timestamp is outside the supported range"
  });
  assert.throws(() => uuidV7(Date.now(), Buffer.alloc(15)), {
    message: "UUIDv7 entropy must contain exactly 16 bytes"
  });
});
