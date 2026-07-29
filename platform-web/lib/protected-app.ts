import { cookies } from "next/headers";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ProtectedAppContext } from "./app-types";
import { safeAppReturnTo } from "./app-path";
import {
  loadProtectedAppContext,
  loadProtectedProjectAppContext,
  PlatformApiError
} from "./platform-api";

export async function requireProtectedAppContext(): Promise<ProtectedAppContext> {
  return requireContext(() => loadProtectedAppContext());
}

export async function requireProtectedProjectAppContext(
  projectId: string
): Promise<ProtectedAppContext> {
  return requireContext(
    () => loadProtectedProjectAppContext(projectId),
    true
  );
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
