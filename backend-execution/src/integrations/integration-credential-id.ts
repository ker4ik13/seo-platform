import { randomBytes } from "node:crypto";

export function integrationCredentialId(now = Date.now()): string {
  return integrationRecordId(now);
}

export function integrationRecordId(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new Error("UUIDv7 timestamp is outside the supported range");
  }
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20)
  ].join("-");
}
