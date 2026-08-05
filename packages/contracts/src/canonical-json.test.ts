import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeJson,
  canonicalJsonSha256,
  utf8Sha256
} from "./canonical-json.js";

test("canonicalizes object keys recursively and preserves array order", () => {
  assert.equal(
    canonicalizeJson({
      z: 3,
      nested: { b: true, a: null },
      array: [{ d: 4, c: 3 }, "ёж"]
    }),
    '{"array":[{"c":3,"d":4},"ёж"],"nested":{"a":null,"b":true},"z":3}'
  );
});

test("uses ECMAScript number and string serialization required by JCS", () => {
  assert.equal(
    canonicalizeJson({
      positiveExponent: 1e30,
      negativeExponent: 1e-27,
      negativeZero: -0,
      escaped: "\b\t\n\f\r\"\\",
      precise: 333333333.3333333
    }),
    '{"escaped":"\\b\\t\\n\\f\\r\\"\\\\","negativeExponent":1e-27,"negativeZero":0,"positiveExponent":1e+30,"precise":333333333.3333333}'
  );
});

test("matches the RFC 8785 primitive serialization sample", () => {
  assert.equal(
    canonicalizeJson({
      numbers: [
        // oxlint-disable-next-line no-loss-of-precision -- RFC 8785 sample intentionally demonstrates IEEE-754 rounding.
        333333333.33333329,
        1e30,
        4.5,
        2e-3,
        0.000000000000000000000000001
      ],
      string: "\u20ac$\u000f\nA'B\"\\\\\"/",
      literals: [null, true, false]
    }),
    String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`
  );
});

test("matches RFC 8785 UTF-16 property ordering and UTF-8 encoding", () => {
  const ordered = canonicalizeJson({
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    "1": "One",
    "\ud83d\ude00": "Emoji",
    "\u0080": "Control",
    "\u00f6": "Latin"
  });
  assert.equal(
    ordered,
    '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin","€":"Euro Sign","😀":"Emoji","דּ":"Hebrew Letter Dalet With Dagesh"}'
  );
  assert.equal(
    Buffer.from(canonicalizeJson({ "\u20ac": "\ud83d\ude00" }), "utf8")
      .toString("hex"),
    "7b22e282ac223a22f09f9880227d"
  );
});

test("hashes canonical JSON with an exact versioned domain separator", () => {
  assert.equal(
    canonicalJsonSha256("rank-manifest@1", { b: 2, a: 1 }),
    "5a3bf33228e51309e5a144707611be5dd32a7b54cdbc85ccd2733e8ff257b52b"
  );
  assert.notEqual(
    canonicalJsonSha256("rank-manifest@1", { a: 1, b: 2 }),
    canonicalJsonSha256("rank-manifest-chunk@1", { a: 1, b: 2 })
  );
  for (const domain of [
    "",
    "Rank-Manifest@1",
    "rank manifest@1",
    `a${"b".repeat(128)}`
  ]) {
    assert.throws(
      () => canonicalJsonSha256(domain, {}),
      /Invalid canonical JSON hash domain/u
    );
  }
});

test("hashes exact raw UTF-8 string bytes without implicit normalization", () => {
  assert.equal(
    utf8Sha256("Keyword 1"),
    "7acbafb5292fd9f277d97b65db34465d61ab779a234aa32832e6fbd7a7bba22c"
  );
  assert.notEqual(utf8Sha256("\u00e9"), utf8Sha256("e\u0301"));
  assert.notEqual(utf8Sha256("value"), utf8Sha256("value\n"));
});

test("supports null-prototype JSON records", () => {
  const value = Object.create(null) as Record<string, unknown>;
  value.b = 2;
  value.a = 1;
  assert.equal(canonicalizeJson(value), '{"a":1,"b":2}');
});

test("rejects values that are not parsed I-JSON", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const sparse = Array.from({ length: 1 });
  delete sparse[0];
  let getterCalls = 0;
  const getter = {};
  Object.defineProperty(getter, "value", {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return Math.random();
    }
  });
  const hidden = { visible: true };
  Object.defineProperty(hidden, "secret", {
    enumerable: false,
    value: "must-not-be-dropped"
  });
  const arrayWithExtra = [1] as Array<unknown> & {
    extra?: string;
  };
  arrayWithExtra.extra = "must-not-be-dropped";
  const arrayWithSymbol = [1] as unknown[];
  Object.defineProperty(arrayWithSymbol, Symbol("private"), {
    value: "must-not-be-dropped"
  });
  const arrayWithGetter = [1];
  Object.defineProperty(arrayWithGetter, "0", {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return Math.random();
    }
  });
  const hiddenToJson = { value: 1 };
  Object.defineProperty(hiddenToJson, "toJSON", {
    enumerable: false,
    value: () => ({ value: 2 })
  });
  let proxyTrapCalls = 0;
  const objectProxy = new Proxy(
    { value: 1 },
    {
      ownKeys: () => {
        proxyTrapCalls += 1;
        return ["value"];
      }
    }
  );
  const arrayProxy = new Proxy(
    [1],
    {
      getOwnPropertyDescriptor: (target, key) => {
        proxyTrapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    }
  );

  for (const value of [
    undefined,
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    { missing: undefined },
    sparse,
    new Date("2026-07-29T00:00:00.000Z"),
    { [Symbol("private")]: "value" },
    "\ud800",
    { "\udc00": "invalid-key" },
    getter,
    hidden,
    arrayWithExtra,
    arrayWithSymbol,
    arrayWithGetter,
    hiddenToJson,
    objectProxy,
    arrayProxy,
    circular
  ]) {
    assert.throws(
      () => canonicalizeJson(value),
      /not valid RFC 8785 I-JSON/u
    );
  }
  assert.equal(getterCalls, 0);
  assert.equal(proxyTrapCalls, 0);
});
