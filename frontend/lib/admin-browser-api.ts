export type AdminApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code?: string;
      readonly message: string;
    };

export async function adminApi<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<AdminApiResult<T>> {
  try {
    const response = await fetch(`/admin${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers
      },
      cache: "no-store"
    });
    const payload = (await response.json().catch(() => ({}))) as {
      readonly data?: T;
      readonly error?: { readonly code?: string; readonly message?: string };
    };
    if (response.ok && payload.data !== undefined) {
      return { ok: true, data: payload.data };
    }
    return {
      ok: false,
      status: response.status,
      ...(payload.error?.code ? { code: payload.error.code } : {}),
      message: payload.error?.message ?? `Ошибка HTTP ${response.status}`
    };
  } catch {
    return {
      ok: false,
      status: 503,
      message: "Operations API недоступен"
    };
  }
}

export function adminApiCollection<T>(
  path: string
): Promise<AdminApiResult<readonly T[]>> {
  return adminApi<readonly T[]>(path);
}
