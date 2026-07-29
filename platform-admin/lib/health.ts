interface Dependency {
  readonly name: string;
  readonly status: "ok" | "degraded" | "unavailable";
  readonly latencyMs?: number;
}

export interface PlatformHealth {
  readonly available: boolean;
  readonly status: "ok" | "degraded" | "unavailable";
  readonly dependencies: readonly Dependency[];
}

export async function getPlatformHealth(): Promise<PlatformHealth> {
  const baseUrl =
    process.env.PLATFORM_API_INTERNAL_URL ?? "http://localhost:4000";

  try {
    const response = await fetch(`${baseUrl}/internal/v1/health/ready`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000)
    });
    const payload = (await response.json()) as {
      status?: PlatformHealth["status"];
      dependencies?: readonly Dependency[];
    };

    return {
      available: response.ok,
      status: payload.status ?? "unavailable",
      dependencies: payload.dependencies ?? []
    };
  } catch {
    return {
      available: false,
      status: "unavailable",
      dependencies: []
    };
  }
}
