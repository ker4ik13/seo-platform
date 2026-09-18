const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;

export function operationConfirmationExpiryDelay(
  expiresAt: string,
  now = Date.now()
): number {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || !Number.isFinite(now)) {
    throw new TypeError("Invalid operation estimate expiry");
  }
  return Math.min(Math.max(0, expiry - now), MAX_BROWSER_TIMEOUT_MS);
}
