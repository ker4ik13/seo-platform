const fallbackTelegramChannelUrl = "https://t.me/ker4ik13";
const allowedTelegramHosts = new Set(["t.me", "telegram.me"]);

export function resolveTelegramChannelUrl(
  configuredUrl: string | undefined
): string {
  if (!configuredUrl) return fallbackTelegramChannelUrl;

  try {
    const candidate = new URL(configuredUrl);
    const hasSafeProtocol = candidate.protocol === "https:";
    const hasAllowedHost = allowedTelegramHosts.has(
      candidate.hostname.toLowerCase()
    );
    const hasCredentials = Boolean(candidate.username || candidate.password);

    if (!hasSafeProtocol || !hasAllowedHost || hasCredentials) {
      return fallbackTelegramChannelUrl;
    }

    return candidate.toString();
  } catch {
    return fallbackTelegramChannelUrl;
  }
}

export const developerTelegramUrl = "https://t.me/ker4ik13";
