import { BadRequestException, ConflictException } from "@nestjs/common";
import { Buffer } from "node:buffer";

export interface RankReadCursor {
  readonly asOf: string;
  readonly anchor?: string;
}

export function decodeRankReadCursor(value: string | undefined, hash: string): RankReadCursor {
  if (!value) return { asOf: new Date().toISOString() };
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error();
    const record: unknown = JSON.parse(bytes.toString("utf8"));
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error();
    const cursor = record as Record<string, unknown>;
    if (Object.keys(cursor).length !== 4 || cursor.v !== 2 || cursor.hash !== hash ||
      typeof cursor.asOf !== "string" || new Date(cursor.asOf).toISOString() !== cursor.asOf ||
      typeof cursor.anchor !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(cursor.anchor)) throw new Error();
    if (Date.parse(cursor.asOf) > Date.now() + 5_000) throw new Error();
    return { asOf: cursor.asOf, anchor: cursor.anchor };
  } catch { throw new BadRequestException("Rank workbench cursor is invalid; refresh the report"); }
}

export function encodeRankReadCursor(anchor: string, asOf: string, hash: string): string {
  return Buffer.from(JSON.stringify({ v: 2, hash, asOf, anchor }), "utf8").toString("base64url");
}

export interface RankReadWindow {
  readonly ids: readonly string[];
  readonly index: ReadonlyMap<string, number>;
}

export function rankReadWindow(ids: readonly string[]): RankReadWindow {
  return { ids, index: new Map(ids.map((id, index) => [id, index])) };
}

export function rankReadPage(window: RankReadWindow, anchor: string | undefined, limit: number) {
  const previous = anchor ? window.index.get(anchor) : -1;
  if (previous === undefined) throw new ConflictException("Report changed; refresh it to continue");
  const ids = window.ids.slice(previous + 1, previous + 1 + limit);
  return { ids, hasNext: previous + 1 + ids.length < window.ids.length };
}

/** Bounded owner-local acceleration, not a source of truth. Cold replicas rebuild at cursor.asOf. */
export class RankReadWindowCache {
  private readonly entries = new Map<string, { value: unknown; bytes: number; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private bytes = 0;
  public constructor(private readonly maximumBytes = 32 * 1024 * 1024, private readonly now = Date.now) {}

  public async read<T>(key: string, load: () => Promise<{ value: T; bytes: number }>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > this.now()) {
      this.entries.delete(key);
      existing.expiresAt = this.now() + 120_000;
      this.entries.set(key, existing);
      return existing.value as T;
    }
    if (existing) this.remove(key);
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    const request = load().then(({ value, bytes }) => {
      if (bytes <= this.maximumBytes) {
        this.remove(key);
        while (this.entries.size >= 16 || this.bytes + bytes > this.maximumBytes) {
          const oldest = this.entries.keys().next().value;
          if (!oldest) break;
          this.remove(oldest);
        }
        this.entries.set(key, { value, bytes, expiresAt: this.now() + 120_000 });
        this.bytes += bytes;
      }
      return value;
    }).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); });
    if (this.pending.size < 16) this.pending.set(key, request);
    return request;
  }
  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
}
