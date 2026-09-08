import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

@Injectable()
export class TelegramBotClient {
  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  public async call(method: "getMe" | "getWebhookInfo" | "setWebhook" | "sendMessage", body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const token = this.config.telegramLogin?.botToken;
    if (!this.config.telegramLogin?.enabled || !token) throw new Error("Telegram login is disabled");
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10_000) });
    } catch { throw new Error("Telegram request is unavailable"); }
    const reader = response.body?.getReader(); if (!reader) throw new Error("Telegram returned no response");
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 262_144) { await reader.cancel(); throw new Error("Telegram response is oversized"); } chunks.push(item.value); }
    } finally { reader.releaseLock(); }
    let payload: { ok?: boolean; result?: unknown };
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof payload; } catch { throw new Error("Telegram response is invalid"); }
    if (!response.ok || payload.ok !== true) throw new Error("Telegram rejected the request");
    return payload.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : {};
  }
}
