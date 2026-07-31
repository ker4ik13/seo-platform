import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  parseSitemapXml,
  sitemapBodyText
} from "./sitemap.js";

test("parses URL sets and namespaced sitemap indexes", () => {
  assert.deepEqual(
    parseSitemapXml(
      '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        "<url><loc>https://example.com/a</loc></url>" +
        "<url><loc><![CDATA[https://example.com/b?x=1&y=2]]></loc></url>" +
        "</urlset>",
      10
    ),
    {
      pageUrls: [
        "https://example.com/a",
        "https://example.com/b?x=1&y=2"
      ],
      sitemapUrls: []
    }
  );
  assert.deepEqual(
    parseSitemapXml(
      "<sm:sitemapindex xmlns:sm=\"urn:test\">" +
        "<sm:sitemap><sm:loc>https://example.com/part.xml</sm:loc></sm:sitemap>" +
        "</sm:sitemapindex>",
      10
    ),
    {
      pageUrls: [],
      sitemapUrls: ["https://example.com/part.xml"]
    }
  );
});

test("rejects DTDs and mixed roots while truncating location overflow", () => {
  for (const xml of [
    "<!DOCTYPE x [<!ENTITY y 'boom'>]><urlset><url><loc>&y;</loc></url></urlset>",
    "<urlset><sitemap><loc>https://example.com/a.xml</loc></sitemap></urlset>"
  ]) {
    assert.throws(
      () => parseSitemapXml(xml, 10),
      /INVALID_SITEMAP/u
    );
  }
  assert.deepEqual(
    parseSitemapXml(
      "<urlset><url><loc>https://example.com/a</loc></url>" +
        "<url><loc>https://example.com/b</loc></url></urlset>",
      1
    ).pageUrls,
    ["https://example.com/a"]
  );
});

test("decodes bounded gzip sitemap documents", async () => {
  const xml =
    "<urlset><url><loc>https://example.com/a</loc></url></urlset>";
  assert.equal(
    await sitemapBodyText(gzipSync(xml), 1_000),
    xml
  );
  await assert.rejects(
    sitemapBodyText(gzipSync("x".repeat(2_000)), 1_000),
    /INVALID_SITEMAP/u
  );
});
