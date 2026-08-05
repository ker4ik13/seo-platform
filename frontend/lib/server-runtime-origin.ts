const LOCALHOST = "localhost";

export function webPublicOrigin(
  env: NodeJS.ProcessEnv = process.env
): string {
  const origin = canonicalOrigin(required(env, "WEB_PUBLIC_URL"));
  const parsed = new URL(origin);
  if (
    (env.NODE_ENV === "production" && parsed.protocol !== "https:") ||
    parsed.hostname === LOCALHOST ||
    parsed.hostname.endsWith(`.${LOCALHOST}`)
  ) {
    throw new Error(
      "WEB_PUBLIC_URL must be the canonical public HTTPS origin in production"
    );
  }
  return origin;
}

export function platformApiInternalOrigin(
  env: NodeJS.ProcessEnv = process.env
): string {
  return canonicalOrigin(required(env, "PLATFORM_API_INTERNAL_URL"));
}

function canonicalOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Runtime service origin is invalid");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== value
  ) {
    throw new Error("Runtime service origin must be an explicit origin");
  }
  return parsed.origin;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value !== value.trim()) {
    throw new Error(`${name} is required and must not contain whitespace`);
  }
  return value;
}
