import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { AuditService } from "../audit/audit.service.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { AuthCryptoService } from "./auth-crypto.service.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { IdentityService } from "./identity.service.js";
import { MfaService } from "./mfa.service.js";
import { RecentAuthenticationService } from "./recent-authentication.service.js";
import { SessionService } from "./session.service.js";
import { TelegramLoginService } from "./telegram-login.service.js";
import { totpCode } from "./totp.js";

const databaseUrl = process.env.PLATFORM_API_TELEGRAM_TEST_DATABASE_URL;

test("PostgreSQL Telegram linking, browser binding, one-time consumption, MFA and unlink races", { skip: !databaseUrl, timeout: 30_000 }, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432", "Use a disposable database cluster");
  const config = loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, AUTH_DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), AUTH_EMAIL_VERIFICATION_REQUIRED: "false", TELEGRAM_LOGIN_ENABLED: "true", TELEGRAM_LOGIN_BOT_TOKEN: `123456:${"a".repeat(40)}`, TELEGRAM_LOGIN_BOT_USERNAME: "seo_example_bot", TELEGRAM_LOGIN_WEBHOOK_SECRET: "b".repeat(40), TELEGRAM_LOGIN_WEBHOOK_URL: "https://api.example.test/api/v1/auth/telegram/webhook" });
  const prisma = new PrismaService(config);
  const crypto = new AuthCryptoService(config);
  const audit = new AuditService(prisma);
  const outbox = new OutboxService();
  const rates = new AuthRateLimitService(prisma, crypto);
  const sessions = new SessionService(prisma, crypto, audit, outbox, config);
  const recent = new RecentAuthenticationService(config);
  const mfa = new MfaService(prisma, crypto, rates, sessions, audit, outbox, recent, config);
  const identity = new IdentityService(prisma, crypto, rates, mfa, sessions, audit, outbox, config);
  const sent: Record<string, unknown>[] = [];
  const bot = { call: async (method: string, body?: Record<string, unknown>) => { if (method === "getMe") return { id: 123456, username: "seo_example_bot" }; if (method === "getWebhookInfo") return { url: "" }; if (method === "sendMessage" && body) sent.push(body); return {}; } };
  const telegram = new TelegramLoginService(prisma, sessions, identity, audit, rates, bot as never, config);
  const context = { requestId: `tg-audit-${randomUUID()}`, ipAddress: "192.0.2.15" };
  const subject = 987654321;
  let updateId = 1;
  const register = async () => identity.register({ email: `telegram-${randomUUID()}@example.invalid`, displayName: "Telegram test", password: "only for isolated test 2026", termsVersion: "2026-09-06", privacyVersion: "2026-09-06", locale: "ru", timezone: "Europe/Moscow" }, context);
  const approve = async (start: Awaited<ReturnType<TelegramLoginService["start"]>>, actor = subject) => {
    const payload = new URL(start.response.botUrl).searchParams.get("start");
    assert.ok(payload);
    const first = { update_id: updateId++, message: { from: { id: actor }, chat: { id: actor, type: "private" }, text: `/start ${payload}` } };
    await Promise.all([telegram.webhook(first), telegram.webhook(first)]);
    assert.equal(await prisma.telegramBotOutbox.count({ where: { challengeId: start.response.id, kind: "LOGIN_CONFIRM" } }), 1, "Webhook replay must not duplicate the confirmation");
    await telegram.webhook({ update_id: updateId++, callback_query: { from: { id: actor + 1 }, message: { chat: { id: actor + 1, type: "private" } }, data: `tgok:${start.response.id}` } });
    assert.equal((await telegram.status(start.response.id, start.browserSecret)).status, "BOT_SEEN", "Another Telegram user cannot approve the proof");
    await telegram.webhook({ update_id: updateId++, callback_query: { from: { id: actor }, message: { chat: { id: actor, type: "private" } }, data: `tgok:${start.response.id}` } });
  };
  try {
    telegram.onModuleInit();
    for (let attempt = 0; !telegram.configuration().available && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(telegram.configuration().available, true);
    const owner = await register();
    const other = await register();
    assert.ok(owner.credentials && other.credentials);
    const principal = (await sessions.authenticate(owner.credentials.accessToken)).principal;
    const otherPrincipal = (await sessions.authenticate(other.credentials.accessToken)).principal;
    const link = await telegram.start("LINK", "ru", context, principal);
    await approve(link);
    await assert.rejects(() => telegram.finishLink(link.response.id, link.browserSecret, otherPrincipal, context));
    await assert.rejects(() => telegram.finishLink(link.response.id, randomBytes(32).toString("base64url"), principal, context));
    await telegram.finishLink(link.response.id, link.browserSecret, principal, context);
    assert.equal((await telegram.connection(principal.userId)).connected, true);
    await assert.rejects(() => telegram.finishLink(link.response.id, link.browserSecret, principal, context));

    const login = await telegram.start("LOGIN", "en", context);
    await approve(login);
    const finishes = await Promise.allSettled([telegram.finishLogin(login.response.id, login.browserSecret, context), telegram.finishLogin(login.response.id, login.browserSecret, context)]);
    assert.equal(finishes.filter(result => result.status === "fulfilled").length, 1);
    const success = finishes.find(result => result.status === "fulfilled");
    assert.ok(success?.status === "fulfilled" && success.value.credentials);
    const newAccessToken = success.value.credentials.accessToken;
    assert.equal((await sessions.authenticate(newAccessToken)).principal.userId, principal.userId);

    const setup = await mfa.setupTotp(principal, context);
    await mfa.confirmTotp(principal, { methodId: setup.methodId, code: totpCode(setup.secret) }, context);
    const withMfa = await telegram.start("LOGIN", "ru", context);
    await approve(withMfa);
    const secured = await telegram.finishLogin(withMfa.response.id, withMfa.browserSecret, context);
    assert.equal(secured.credentials, undefined, "Telegram must never bypass an active second factor");
    assert.ok("mfaRequired" in secured.response && secured.response.mfaRequired);

    const pending = await telegram.start("LOGIN", "ru", context);
    await approve(pending);
    await telegram.unlink(principal, context);
    await assert.rejects(() => telegram.finishLogin(pending.response.id, pending.browserSecret, context));
    await assert.rejects(() => sessions.authenticate(newAccessToken));
    await sessions.authenticate(owner.credentials.accessToken);
    assert.equal((await telegram.connection(principal.userId)).connected, false);

    const cancelled = await telegram.start("LOGIN", "ru", context);
    await approve(cancelled);
    await telegram.cancel(cancelled.response.id, cancelled.browserSecret);
    await assert.rejects(() => telegram.finishLogin(cancelled.response.id, cancelled.browserSecret, context));
    const unknown = await telegram.start("LOGIN", "ru", context);
    await approve(unknown, subject + 10);
    await assert.rejects(() => telegram.finishLogin(unknown.response.id, unknown.browserSecret, context), { code: "TELEGRAM_ACCOUNT_NOT_LINKED" });
  } finally { await telegram.onModuleDestroy(); await prisma.$disconnect(); }
});
