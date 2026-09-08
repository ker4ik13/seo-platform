import assert from "node:assert/strict";
import test from "node:test";
import { telegramMessage, telegramUpdate } from "./telegram-login.service.js";
import { loadAppConfig } from "../config/app-config.js";
const id = "01900000-0000-7000-8000-000000000001";

test("accepts only direct private Telegram approvals and rejects forwarded/group/bot messages", () => {
  const update = { update_id: 123, message: { from: { id: 100, username: "sample_user", is_bot: false }, chat: { id: 100, type: "private" }, text: `/start login_${"a".repeat(43)}` } };
  assert.equal(telegramUpdate(update)?.kind, "START");
  assert.equal(telegramUpdate({ ...update, message: { ...update.message, chat: { id: -100, type: "group" } } }), undefined);
  assert.equal(telegramUpdate({ ...update, message: { ...update.message, forward_origin: { type: "user" } } }), undefined);
  assert.equal(telegramUpdate({ ...update, message: { ...update.message, from: { id: 100, is_bot: true } } }), undefined);
  assert.equal(telegramUpdate({ ...update, message: { ...update.message, text: "ordinary text" } }), undefined);
  const callback = { update_id: 124, callback_query: { from: { id: 100, is_bot: false }, data: `tgok:${id}`, message: { chat: { id: 100, type: "private" } } } };
  assert.equal(telegramUpdate(callback)?.kind, "CONFIRM");
  assert.equal(telegramUpdate({ ...callback, callback_query: { ...callback.callback_query, from: { id: 101 } } }), undefined);
});
test("requires explicit confirmation and shows the trusted origin and matching browser code", () => {
  const body = telegramMessage("LOGIN_CONFIRM", "en", "https://seonorita.ru", { id, code: "123456", intent: "LINK", expiresAt: new Date(Date.now() + 60_000) });
  assert.match(String(body.text), /123456/u);
  assert.match(String(body.text), /seonorita\.ru/u);
  assert.match(String(body.text), /Only confirm/u);
  assert.ok(body.reply_markup);
  const expired = telegramMessage("LOGIN_CONFIRM", "ru", "https://seonorita.ru", { id, code: "123456", intent: "LOGIN", expiresAt: new Date(0) });
  assert.equal(expired.reply_markup, undefined);
});
test("Telegram auth is disabled by default and requires a complete dedicated bot setup", () => {
  const base = { NODE_ENV: "test", DATABASE_URL: "postgresql://test" };
  assert.equal(loadAppConfig(base).telegramLogin?.enabled, false);
  assert.throws(() => loadAppConfig({ ...base, TELEGRAM_LOGIN_ENABLED: "true" }));
  const config = loadAppConfig({ ...base, TELEGRAM_LOGIN_ENABLED: "true", TELEGRAM_LOGIN_BOT_TOKEN: "123456:" + "a".repeat(40), TELEGRAM_LOGIN_BOT_USERNAME: "seo_example_bot", TELEGRAM_LOGIN_WEBHOOK_SECRET: "b".repeat(40), TELEGRAM_LOGIN_WEBHOOK_URL: "https://api.example.test/api/v1/auth/telegram/webhook" });
  assert.equal(config.telegramLogin?.enabled, true);
});
