import assert from "node:assert/strict";
import test from "node:test";
import {
  developerTelegramUrl,
  resolveTelegramChannelUrl
} from "./telegram-channel.ts";

test("uses the developer Telegram contact until a channel is configured", () => {
  assert.equal(resolveTelegramChannelUrl(undefined), developerTelegramUrl);
  assert.equal(resolveTelegramChannelUrl(""), developerTelegramUrl);
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
    developerTelegramUrl
  );
  assert.equal(
    resolveTelegramChannelUrl("https://example.com/seonorita"),
    developerTelegramUrl
  );
  assert.equal(
    resolveTelegramChannelUrl("javascript:alert(1)"),
    developerTelegramUrl
  );
  assert.equal(
    resolveTelegramChannelUrl("https://user:secret@t.me/seonorita"),
    developerTelegramUrl
  );
});
