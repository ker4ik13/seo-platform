interface ApiState {
  readonly available: boolean;
  readonly version?: string;
}

export async function getPlatformApiState(): Promise<ApiState> {
  const baseUrl =
    process.env.PLATFORM_API_INTERNAL_URL ?? "http://localhost:4000";

  try {
    const response = await fetch(`${baseUrl}/internal/v1/system`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500)
    });
    if (!response.ok) return { available: false };

    const payload = (await response.json()) as {
      data?: { version?: string };
    };
    return {
      available: true,
      ...(payload.data?.version ? { version: payload.data.version } : {})
    };
  } catch {
    return { available: false };
  }
}

