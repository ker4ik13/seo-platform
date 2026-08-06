import { cookies } from "next/headers";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { ProtectedAppContext } from "./app-types";
import { safeAppReturnTo } from "./app-path";
import {
  loadProtectedAppContext,
  loadProtectedProjectAppContext,
  PlatformApiError
} from "./platform-api";

const requiredAppContext = cache(() =>
  requireContext(() => loadProtectedAppContext())
);

const requiredProjectAppContext = cache((projectId: string) =>
  requireContext(() => loadProtectedProjectAppContext(projectId), true)
);

export async function requireProtectedAppContext(): Promise<ProtectedAppContext> {
  return requiredAppContext();
}

export async function requireProtectedProjectAppContext(
  projectId: string
): Promise<ProtectedAppContext> {
  return requiredProjectAppContext(projectId);
}

async function requireContext(
  load: () => Promise<ProtectedAppContext>,
  projectScoped = false
): Promise<ProtectedAppContext> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof PlatformApiError && error.status === 401) {
      const cookieStore = await cookies();
      const requestHeaders = await headers();
      const returnTo = safeAppReturnTo(
        requestHeaders.get("x-app-path")
      );
      const sessionCookieName =
        process.env.AUTH_SESSION_COOKIE_NAME ?? "seo_session";
      if (cookieStore.has(sessionCookieName)) {
        redirect(
          `/app/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`
        );
      }
      redirect(`/app/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
    if (
      projectScoped &&
      error instanceof PlatformApiError &&
      error.status === 404
    ) {
      notFound();
    }
    throw error;
  }
}
