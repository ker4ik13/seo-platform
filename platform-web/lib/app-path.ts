const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9-]+$/u;

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
