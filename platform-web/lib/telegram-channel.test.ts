import assert from "node:assert/strict";
import test from "node:test";
import { resolveTelegramChannelUrl } from "./telegram-channel.ts";

test("uses the official product channel until another channel is configured", () => {
  assert.equal(
    resolveTelegramChannelUrl(undefined),
    "https://t.me/seonorita_app"
  );
  assert.equal(resolveTelegramChannelUrl(""), "https://t.me/seonorita_app");
});

test("accepts HTTPS Telegram channel and invite links", () => {
  assert.equal(
    resolveTelegramChannelUrl("https://t.me/seonorita_updates"),
    "https://t.me/seonorita_updates"
  );
  assert.equal(
    resolveTelegramChannelUrl("https://t.me/+AbCdEf123"),
    "https://t.me/+AbCdEf123"
  );
  assert.equal(
    resolveTelegramChannelUrl("https://telegram.me/seonorita"),
    "https://telegram.me/seonorita"
  );
});

test("rejects unsafe or unrelated URLs", () => {
  assert.equal(
    resolveTelegramChannelUrl("http://t.me/seonorita"),
    "https://t.me/seonorita_app"
  );
  assert.equal(
    resolveTelegramChannelUrl("https://example.com/seonorita"),
    "https://t.me/seonorita_app"
  );
  assert.equal(
    resolveTelegramChannelUrl("javascript:alert(1)"),
    "https://t.me/seonorita_app"
  );
  assert.equal(
    resolveTelegramChannelUrl("https://user:secret@t.me/seonorita"),
    "https://t.me/seonorita_app"
  );
});
