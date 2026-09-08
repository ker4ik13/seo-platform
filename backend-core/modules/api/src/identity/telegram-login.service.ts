import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { TelegramAccountConnection, TelegramLoginConfiguration, TelegramLoginStart, TelegramLoginStatus } from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { DomainError } from "../common/domain-error.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma, TelegramLoginChallenge } from "../generated/prisma/client.js";
import { IdentityService, type LoginCommandResult } from "./identity.service.js";
import type { AuthenticatedPrincipal, RequestContext } from "./identity.types.js";
import { SessionService } from "./session.service.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { TelegramBotClient } from "./telegram-bot.client.js";

const TTL_MS = 5 * 60_000;
const PROVIDER = "TELEGRAM";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hash = (value: string) => createHash("sha256").update(value).digest();

@Injectable()
export class TelegramLoginService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramLoginService.name);
  private botId?: string;
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private nextInitialization = 0;
  private nextCleanup = 0;
  public constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    private readonly rates: AuthRateLimitService,
    private readonly bot: TelegramBotClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}
  public onModuleInit(): void {
    if (!this.config.telegramLogin?.enabled) return;
    void this.tick(); this.timer = setInterval(() => void this.tick(), 2_000); this.timer.unref();
  }
  public async onModuleDestroy(): Promise<void> { this.stopping = true; if (this.timer) clearInterval(this.timer); while (this.running) await new Promise(resolve => setTimeout(resolve, 50)); }
  public configuration(): TelegramLoginConfiguration {
    return { available: Boolean(this.config.telegramLogin?.enabled && this.botId), ...(this.config.telegramLogin?.botUsername ? { botUsername: this.config.telegramLogin.botUsername } : {}) };
  }
  public async connection(userId: string): Promise<TelegramAccountConnection> {
    const identity = await this.prisma.userIdentity.findFirst({ where: { userId, provider: PROVIDER } });
    const username = record(identity?.metadata).username;
    return { available: this.configuration().available, connected: Boolean(identity), ...(typeof username === "string" ? { username } : {}) };
  }
  public async start(intent: "LOGIN" | "LINK", locale: "ru" | "en", context: RequestContext, principal?: AuthenticatedPrincipal): Promise<{ response: TelegramLoginStart; browserSecret: string }> {
    if (!this.configuration().available) throw unavailable();
    await this.rates.consume("LOGIN", [`telegram-start:ip:${context.ipAddress ?? "unknown"}`]);
    const nonce = randomBytes(32).toString("base64url");
    const browserSecret = randomBytes(32).toString("base64url");
    const challenge = await this.prisma.$transaction(async transaction => {
      let userVersion: number | undefined;
      if (intent === "LINK") {
        if (!principal) throw invalid();
        await this.sessions.assertSessionLifecyclePrincipal(transaction, principal);
        const user = await transaction.user.findUniqueOrThrow({ where: { id: principal.userId } });
        if (!user.emailVerifiedAt) throw invalid();
        userVersion = user.version;
      }
      return transaction.telegramLoginChallenge.create({ data: {
        nonceHash: hash(nonce), browserHash: hash(browserSecret), intent, locale,
        code: String(randomInt(100000, 1000000)), expiresAt: new Date(Date.now() + TTL_MS),
        ...(principal && intent === "LINK" ? { targetUserId: principal.userId, sessionFamilyId: principal.sessionFamilyId, ...(userVersion !== undefined ? { approvedUserVersion: userVersion } : {}) } : {})
      } });
    });
    return { response: { id: challenge.id, code: challenge.code, expiresAt: challenge.expiresAt.toISOString(), botUrl: `https://t.me/${this.config.telegramLogin!.botUsername}?start=login_${nonce}` }, browserSecret };
  }
  public async status(id: string, browserSecret: string): Promise<TelegramLoginStatus> {
    const challenge = await this.challenge(id, browserSecret);
    return { status: challenge.expiresAt <= new Date() && challenge.status !== "CONSUMED" ? "EXPIRED" : challenge.status as TelegramLoginStatus["status"] };
  }
  public async cancel(id: string, browserSecret: string): Promise<void> {
    await this.challenge(id, browserSecret);
    await this.prisma.telegramLoginChallenge.updateMany({ where: { id, status: { in: ["PENDING", "BOT_SEEN", "APPROVED"] }, consumedAt: null }, data: { status: "DENIED" } });
  }
  public async finishLogin(id: string, browserSecret: string, context: RequestContext): Promise<LoginCommandResult> {
    if (!this.config.telegramLogin?.enabled) throw unavailable();
    const challenge = await this.challenge(id, browserSecret);
    if (challenge.intent !== "LOGIN" || challenge.status !== "APPROVED" || !challenge.telegramSubject || challenge.expiresAt <= new Date()) throw invalid();
    return this.prisma.$transaction(async transaction => {
      const binding = await transaction.userIdentity.findUnique({ where: { provider_providerSubject: { provider: PROVIDER, providerSubject: challenge.telegramSubject! } }, include: { user: true } });
      if (!binding || !binding.user.emailVerifiedAt) throw new DomainError({ statusCode: 409, code: "TELEGRAM_ACCOUNT_NOT_LINKED", message: "Сначала создайте аккаунт по email и подключите Telegram в настройках безопасности." });
      await this.sessions.assertSessionLifecycleUser(transaction, binding.user);
      if (binding.user.version !== challenge.approvedUserVersion) throw invalid();
      const currentBinding = await transaction.userIdentity.findUnique({ where: { id: binding.id } });
      if (!currentBinding || currentBinding.userId !== binding.user.id) throw invalid();
      await consume(transaction, challenge);
      const result = await this.identity.issueVerifiedIdentity(transaction, binding.user, context);
      await transaction.userIdentity.update({ where: { id: binding.id }, data: { lastUsedAt: new Date() } });
      await this.audit.record({ actorId: binding.user.id, action: "identity.telegram.login", resourceType: "user", resourceId: binding.user.id, requestId: context.requestId }, transaction);
      return result;
    });
  }
  public async finishLink(id: string, browserSecret: string, principal: AuthenticatedPrincipal, context: RequestContext): Promise<void> {
    if (!this.config.telegramLogin?.enabled) throw unavailable();
    const challenge = await this.challenge(id, browserSecret);
    if (challenge.intent !== "LINK" || challenge.status !== "APPROVED" || challenge.targetUserId !== principal.userId || challenge.sessionFamilyId !== principal.sessionFamilyId || !challenge.telegramSubject || challenge.expiresAt <= new Date()) throw invalid();
    await this.prisma.$transaction(async transaction => {
      await this.sessions.assertSessionLifecyclePrincipal(transaction, principal, { id: principal.userId, version: challenge.approvedUserVersion ?? -1 });
      const existing = await transaction.userIdentity.findUnique({ where: { provider_providerSubject: { provider: PROVIDER, providerSubject: challenge.telegramSubject! } } });
      if (existing && existing.userId !== principal.userId) throw new DomainError({ statusCode: 409, code: "RESOURCE_STATE_CONFLICT", message: "Этот Telegram уже подключён к другому аккаунту." });
      const own = await transaction.userIdentity.findFirst({ where: { userId: principal.userId, provider: PROVIDER } });
      if (own && own.providerSubject !== challenge.telegramSubject) throw new DomainError({ statusCode: 409, code: "RESOURCE_STATE_CONFLICT", message: "Сначала отключите предыдущую привязку Telegram." });
      await consume(transaction, challenge);
      if (!existing) await transaction.userIdentity.create({ data: { userId: principal.userId, provider: PROVIDER, providerSubject: challenge.telegramSubject!, metadata: challenge.telegramUsername ? { username: challenge.telegramUsername } : {} } });
      await transaction.user.update({ where: { id: principal.userId }, data: { version: { increment: 1 } } });
      await this.audit.record({ actorId: principal.userId, action: "identity.telegram.linked", resourceType: "user", resourceId: principal.userId, requestId: context.requestId }, transaction);
    });
  }
  public async unlink(principal: AuthenticatedPrincipal, context: RequestContext): Promise<void> {
    await this.prisma.$transaction(async transaction => {
      await this.sessions.assertSessionLifecyclePrincipal(transaction, principal);
      await transaction.userIdentity.deleteMany({ where: { userId: principal.userId, provider: PROVIDER } });
      await this.sessions.revokeFamilies(transaction, { userId: principal.userId, excludeFamilyIds: [principal.sessionFamilyId], requestId: context.requestId });
      await transaction.user.update({ where: { id: principal.userId }, data: { version: { increment: 1 } } });
      await this.audit.record({ actorId: principal.userId, action: "identity.telegram.unlinked", resourceType: "user", resourceId: principal.userId, requestId: context.requestId }, transaction);
    });
  }
  public verifySecret(secret: string | undefined): boolean {
    const expected = this.config.telegramLogin?.webhookSecret;
    return Boolean(expected && secret && this.botId && timingSafeEqual(hash(expected), hash(secret)));
  }
  public async webhook(value: unknown): Promise<void> {
    const event = telegramUpdate(value); if (!event || !this.botId) return;
    await this.prisma.$transaction(async transaction => {
      const inserted = await transaction.telegramWebhookReceipt.createMany({ data: [{ botId: this.botId!, updateId: BigInt(event.updateId) }], skipDuplicates: true });
      if (!inserted.count) return;
      if (event.kind === "START") {
        const challenge = await transaction.telegramLoginChallenge.findUnique({ where: { nonceHash: hash(event.nonce) } });
        if (!challenge || challenge.expiresAt <= new Date() || challenge.status !== "PENDING") return;
        const identity = challenge.intent === "LOGIN" ? await transaction.userIdentity.findUnique({ where: { provider_providerSubject: { provider: PROVIDER, providerSubject: event.subject } }, include: { user: true } }) : null;
        const changed = await transaction.telegramLoginChallenge.updateMany({ where: { id: challenge.id, status: "PENDING", telegramSubject: null }, data: { status: "BOT_SEEN", telegramSubject: event.subject, telegramUsername: event.username ?? null, ...(challenge.intent === "LOGIN" ? { approvedUserVersion: identity?.user.version ?? null } : {}) } });
        if (changed.count) await message(transaction, event.subject, "LOGIN_CONFIRM", challenge);
      } else if (event.kind === "CONFIRM") {
        const challenge = await transaction.telegramLoginChallenge.findUnique({ where: { id: event.challengeId } });
        if (!challenge || challenge.telegramSubject !== event.subject || challenge.expiresAt <= new Date() || challenge.status !== "BOT_SEEN") return;
        const changed = await transaction.telegramLoginChallenge.updateMany({ where: { id: challenge.id, status: "BOT_SEEN", telegramSubject: event.subject }, data: { status: event.approve ? "APPROVED" : "DENIED" } });
        if (changed.count) await message(transaction, event.subject, event.approve ? "LOGIN_APPROVED" : "LOGIN_DENIED", challenge);
      } else await message(transaction, event.subject, "HELP");
    });
  }
  private async challenge(id: string, secret: string): Promise<TelegramLoginChallenge> {
    if (!UUID.test(id) || !/^[A-Za-z0-9_-]{43}$/u.test(secret)) throw invalid();
    const row = await this.prisma.telegramLoginChallenge.findUnique({ where: { id } });
    if (!row || !timingSafeEqual(Buffer.from(row.browserHash), hash(secret))) throw invalid();
    return row;
  }
  private async tick(): Promise<void> {
    if (this.running || this.stopping) return; this.running = true;
    try {
      if (!this.botId) {
        if (Date.now() < this.nextInitialization) return;
        this.nextInitialization = Date.now() + 60_000;
        const me = await this.bot.call("getMe");
        if (!Number.isSafeInteger(me.id) || String(me.username).toLowerCase() !== this.config.telegramLogin?.botUsername?.toLowerCase()) throw new Error("Telegram bot identity mismatch");
        const webhook = await this.bot.call("getWebhookInfo");
        if (webhook.url && webhook.url !== this.config.telegramLogin?.webhookUrl) throw new Error("Telegram bot belongs to another application");
        await this.bot.call("setWebhook", { url: this.config.telegramLogin!.webhookUrl, secret_token: this.config.telegramLogin!.webhookSecret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
        this.botId = String(me.id);
      }
      await this.prisma.telegramBotOutbox.updateMany({ where: { status: "PENDING", attempts: { gte: 3 }, availableAt: { lte: new Date() } }, data: { status: "FAILED" } });
      const messages = await this.prisma.telegramBotOutbox.findMany({ where: { status: "PENDING", attempts: { lt: 3 }, availableAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 5 });
      for (const entry of messages) {
        const claimed = await this.prisma.telegramBotOutbox.updateMany({ where: { id: entry.id, status: "PENDING", availableAt: { lte: new Date() } }, data: { attempts: { increment: 1 }, availableAt: new Date(Date.now() + 30_000) } });
        if (!claimed.count) continue;
        try {
          const challenge = entry.challengeId ? await this.prisma.telegramLoginChallenge.findUnique({ where: { id: entry.challengeId } }) : null;
          const body = telegramMessage(entry.kind, entry.locale, this.config.webPublicUrl ?? "https://seonorita.ru", challenge);
          await this.bot.call("sendMessage", { chat_id: entry.chatId, ...body, link_preview_options: { is_disabled: true } });
          await this.prisma.telegramBotOutbox.updateMany({ where: { id: entry.id, status: "PENDING" }, data: { status: "SENT" } });
        } catch {
          await this.prisma.telegramBotOutbox.updateMany({ where: { id: entry.id, status: "PENDING" }, data: { status: entry.attempts >= 2 ? "FAILED" : "PENDING" } });
        }
      }
      if (Date.now() >= this.nextCleanup) {
        this.nextCleanup = Date.now() + 3_600_000;
        const old = new Date(Date.now() - 7 * 86_400_000);
        const challenges = await this.prisma.telegramLoginChallenge.findMany({ where: { expiresAt: { lt: old } }, select: { id: true }, take: 500 });
        const receipts = await this.prisma.telegramWebhookReceipt.findMany({ where: { createdAt: { lt: old } }, select: { id: true }, take: 500 });
        const outbox = await this.prisma.telegramBotOutbox.findMany({ where: { createdAt: { lt: old }, status: { in: ["SENT", "FAILED"] } }, select: { id: true }, take: 500 });
        await this.prisma.telegramLoginChallenge.deleteMany({ where: { id: { in: challenges.map(row => row.id) } } });
        await this.prisma.telegramWebhookReceipt.deleteMany({ where: { id: { in: receipts.map(row => row.id) } } });
        await this.prisma.telegramBotOutbox.deleteMany({ where: { id: { in: outbox.map(row => row.id) } } });
      }
    } catch { this.logger.error("Telegram login dependency or configuration requires attention"); }
    finally { this.running = false; }
  }
}
async function consume(transaction: Prisma.TransactionClient, challenge: TelegramLoginChallenge): Promise<void> {
  const result = await transaction.telegramLoginChallenge.updateMany({ where: { id: challenge.id, status: "APPROVED", expiresAt: { gt: new Date() }, consumedAt: null }, data: { status: "CONSUMED", consumedAt: new Date() } });
  if (result.count !== 1) throw invalid();
}
async function message(transaction: Prisma.TransactionClient, chatId: string, kind: string, challenge?: TelegramLoginChallenge) {
  if (kind === "HELP" && await transaction.telegramBotOutbox.findFirst({ where: { chatId, kind, createdAt: { gt: new Date(Date.now() - 60_000) } }, select: { id: true } })) return;
  await transaction.telegramBotOutbox.create({ data: { chatId, kind, locale: challenge?.locale ?? "ru", ...(challenge ? { challengeId: challenge.id } : {}) } });
}
function invalid(): DomainError { return new DomainError({ statusCode: 409, code: "TELEGRAM_CHALLENGE_INVALID", message: "Запрос входа истёк или уже использован. Начните вход заново." }); }
function unavailable(): DomainError { return new DomainError({ statusCode: 503, code: "FEATURE_NOT_AVAILABLE", message: "Вход через Telegram пока недоступен." }); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export type TelegramUpdate = { updateId: number; subject: string; username?: string } & ({ kind: "START"; nonce: string } | { kind: "CONFIRM"; challengeId: string; approve: boolean } | { kind: "HELP" });
export function telegramUpdate(value: unknown): TelegramUpdate | undefined {
  const input = record(value); if (!Number.isSafeInteger(input.update_id) || Number(input.update_id) < 0) return undefined;
  const callback = record(input.callback_query); const message = record(input.message ?? callback.message); const sender = record(input.message ? message.from : callback.from); const chat = record(message.chat);
  if (!Number.isSafeInteger(sender.id) || Number(sender.id) < 1 || chat.type !== "private" || chat.id !== sender.id || message.forward_origin || sender.is_bot) return undefined;
  const common = { updateId: Number(input.update_id), subject: String(sender.id), ...(typeof sender.username === "string" && /^[A-Za-z0-9_]{5,32}$/u.test(sender.username) ? { username: sender.username } : {}) };
  if (typeof callback.data === "string") { const match = /^(tgok|tgno):([0-9a-f-]{36})$/iu.exec(callback.data); if (!match?.[2] || !UUID.test(match[2])) return undefined; return { ...common, kind: "CONFIRM", challengeId: match[2], approve: match[1] === "tgok" }; }
  if (typeof message.text === "string") { const match = /^\/start(?:@[A-Za-z0-9_]+)? login_([A-Za-z0-9_-]{43})$/u.exec(message.text); if (match?.[1]) return { ...common, kind: "START", nonce: match[1] }; }
  return typeof message.text === "string" && /^\/(?:start|help)(?:@[A-Za-z0-9_]+)?(?:\s.*)?$/u.test(message.text) ? { ...common, kind: "HELP" } : undefined;
}
export function telegramMessage(kind: string, locale: string, origin: string, challenge: Pick<TelegramLoginChallenge, "id" | "code" | "intent" | "expiresAt"> | null): Record<string, unknown> {
  const en = locale === "en";
  if (kind === "LOGIN_CONFIRM" && challenge && challenge.expiresAt > new Date()) return {
    text: en ? `Confirm ${challenge.intent === "LINK" ? "linking Telegram" : "sign-in"} at ${origin}. Browser code: ${challenge.code}. Only confirm if you started this request and the code matches.` : `Подтвердите ${challenge.intent === "LINK" ? "подключение Telegram" : "вход"} на ${origin}. Код в браузере: ${challenge.code}. Подтверждайте только свой запрос с совпадающим кодом.`,
    reply_markup: { inline_keyboard: [[{ text: en ? "Confirm" : "Подтвердить", callback_data: `tgok:${challenge.id}` }, { text: en ? "Cancel" : "Отменить", callback_data: `tgno:${challenge.id}` }]] }
  };
  if (kind === "LOGIN_APPROVED") return { text: en ? "Confirmed. Return to the browser to finish. Your account security checks still apply." : "Подтверждено. Вернитесь в браузер для завершения. Проверки безопасности аккаунта сохраняются." };
  if (kind === "LOGIN_DENIED") return { text: en ? "Request cancelled." : "Запрос отменён." };
  return { text: en ? `To sign in, open ${origin}/app/login. Link Telegram in account security settings first.` : `Для входа откройте ${origin}/app/login. Сначала подключите Telegram в настройках безопасности аккаунта.` };
}
