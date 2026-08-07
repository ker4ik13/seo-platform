import { webPublicOrigin } from "./server-runtime-origin.ts";

export function canonicalHostRedirectUrl(
  requestUrl: URL,
  hostHeader: string | null,
  env: NodeJS.ProcessEnv = process.env
): URL | undefined {
  const redirectHost = normalizedHostname(env.WEB_WWW_REDIRECT_HOST);
  if (!redirectHost || normalizedHostname(hostHeader) !== redirectHost) {
    return undefined;
  }

  const canonicalOrigin = new URL(webPublicOrigin(env));
  if (canonicalOrigin.hostname === redirectHost) {
    return undefined;
  }
  return new URL(
    `${requestUrl.pathname}${requestUrl.search}`,
    canonicalOrigin
  );
}

function normalizedHostname(
  value: string | null | undefined
): string | undefined {
  const candidate = value?.trim().toLowerCase();
  if (!candidate || /[\s/@]/u.test(candidate)) return undefined;
  try {
    return new URL(`http://${candidate}`).hostname || undefined;
  } catch {
    return undefined;
  }
}
