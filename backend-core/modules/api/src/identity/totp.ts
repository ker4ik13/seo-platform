import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export interface TotpMatch {
  readonly counter: bigint;
}

export function createTotpSecret(bytes = 20): string {
  return encodeBase32(randomBytes(bytes));
}

export function totpCode(
  secret: string,
  timestampMs = Date.now(),
  digits = 6,
  periodSeconds = 30
): string {
  return hotpCode(
    decodeBase32(secret),
    BigInt(Math.floor(timestampMs / 1_000 / periodSeconds)),
    digits
  );
}

export function matchTotp(
  secret: string,
  code: string,
  timestampMs = Date.now(),
  window = 1,
  lastUsedCounter?: bigint | null
): TotpMatch | undefined {
  if (!/^\d{6}$/u.test(code)) return undefined;
  const current = BigInt(Math.floor(timestampMs / 1_000 / 30));
  const secretBytes = decodeBase32(secret);

  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + BigInt(offset);
    if (
      counter < 0n ||
      (lastUsedCounter !== undefined &&
        lastUsedCounter !== null &&
        counter <= lastUsedCounter)
    ) {
      continue;
    }
    const expected = hotpCode(secretBytes, counter, 6);
    if (safeCodeEqual(expected, code)) return { counter };
  }
  return undefined;
}

export function normalizeRecoveryCode(code: string): string {
  return code.normalize("NFKC").replace(/[^A-Z2-7]/giu, "").toUpperCase();
}

export function createRecoveryCode(): string {
  const raw = encodeBase32(randomBytes(10));
  return raw.match(/.{1,4}/gu)?.join("-") ?? raw;
}

export function encodeBase32(value: Uint8Array): string {
  let bits = 0;
  let buffer = 0;
  let result = "";

  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) result += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return result;
}

function decodeBase32(value: string): Buffer {
  const normalized = value
    .normalize("NFKC")
    .replace(/=+$/u, "")
    .replace(/\s+/gu, "")
    .toUpperCase();
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid Base32 value");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

function hotpCode(secret: Buffer, counter: bigint, digits: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  const modulus = 10 ** digits;
  return String(binary % modulus).padStart(digits, "0");
}

function safeCodeEqual(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}
