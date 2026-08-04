const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/u;

export function safeAppReturnTo(
  value: string | null | undefined,
  fallback = "/app"
): string {
  if (
    value &&
    value.startsWith("/app") &&
    !value.startsWith("//") &&
    !value.startsWith("/app/auth/refresh")
  ) {
    return value;
  }
  return fallback;
}

export function isSafeBrowserApiPath(
  pathSegments: readonly string[]
): boolean {
  return (
    pathSegments.length > 0 &&
    pathSegments.every((segment) => SAFE_PATH_SEGMENT.test(segment))
  );
}

export interface ExternalPageUrlPresentation {
  readonly href: string;
  readonly label: string;
}

export function externalPageUrlPresentation(
  value: string,
  maxLabelLength = 34
): ExternalPageUrlPresentation | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    const pagePath = `${url.pathname || "/"}${url.search}${url.hash}`;
    const label =
      pagePath.length > maxLabelLength
        ? `${pagePath.slice(0, Math.max(1, maxLabelLength - 1))}…`
        : pagePath;
    return { href: url.href, label };
  } catch {
    return undefined;
  }
}
