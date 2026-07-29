import { createHash, timingSafeEqual } from "node:crypto";

export function internalTokensEqual(
  expected: string,
  provided: string
): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}
