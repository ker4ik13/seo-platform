import assert from "node:assert/strict";
import test from "node:test";
import {
  assignSerpDomainColors,
  normalizedSerpDomain,
  repeatedSerpDomains
} from "./serp-domain-highlights.ts";

test("finds repeated domains across dimensions and different keywords", () => {
  const rows = [
    {
      snapshots: [
        { results: [
          { url: "https://unique.example/one" },
          { url: "https://www.shared.example/first" }
        ] },
        { results: [{ url: "https://same-serp.example/one" }, { url: "https://same-serp.example/two" }] }
      ],
      aiSnapshots: [{ results: [{ url: "https://ai-only.example/source" }] }]
    },
    {
      snapshots: [{ results: [{ url: "https://shared.example/second" }] }],
      aiSnapshots: [{ results: [{ url: "https://ai-only.example/another" }] }]
    }
  ];

  assert.deepEqual(
    [...repeatedSerpDomains(rows, "organic")].sort(),
    ["same-serp.example", "shared.example"]
  );
  assert.deepEqual(
    [...repeatedSerpDomains(rows, "ai")],
    ["ai-only.example"]
  );
  assert.equal(repeatedSerpDomains(rows, "organic").has("unique.example"), false);
});

test("normalizes domains and assigns distinct stable colors", () => {
  assert.equal(normalizedSerpDomain("HTTPS://WWW.Example.RU/path"), "example.ru");
  assert.equal(normalizedSerpDomain("not a domain"), undefined);

  const domains = Array.from({ length: 64 }, (_, index) => `domain-${index}.example`);
  const forward = assignSerpDomainColors(domains);
  const reverse = assignSerpDomainColors([...domains].reverse());

  assert.equal(forward.size, domains.length);
  assert.equal(new Set(forward.values()).size, domains.length);
  assert.deepEqual([...forward], [...reverse]);
});
