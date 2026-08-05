export interface CoreProcessProfile {
  readonly databaseUrl: string;
  readonly databasePoolMax?: string;
  readonly port: string;
  readonly natsUser?: string;
  readonly natsPassword?: string;
}

export function coreProcessProfile(
  env: NodeJS.ProcessEnv,
  name: "PLATFORM" | "SEO",
  defaultPort: number
): CoreProcessProfile {
  const databaseUrl = env[`${name}_DATABASE_URL`]?.trim();
  if (!databaseUrl) {
    throw new Error(`${name}_DATABASE_URL is required by backend-core`);
  }
  const databasePoolMax = env[`${name}_DATABASE_POOL_MAX`]?.trim();
  const natsUser = env[`${name}_NATS_USER`]?.trim();
  const natsPassword = env[`${name}_NATS_PASSWORD`];
  return {
    databaseUrl,
    ...(databasePoolMax ? { databasePoolMax } : {}),
    port: env[`${name}_PORT`]?.trim() || String(defaultPort),
    ...(natsUser ? { natsUser } : {}),
    ...(natsPassword ? { natsPassword } : {})
  };
}

export async function withCoreProcessProfile<T>(
  profile: CoreProcessProfile,
  operation: () => Promise<T>
): Promise<T> {
  const overlay: Readonly<Record<string, string | undefined>> = {
    DATABASE_URL: profile.databaseUrl,
    DATABASE_POOL_MAX: profile.databasePoolMax,
    PORT: profile.port,
    NATS_USER: profile.natsUser,
    NATS_PASSWORD: profile.natsPassword
  };
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overlay)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
