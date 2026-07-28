import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ProtectedAppContext } from "./app-types";
import { safeAppReturnTo } from "./app-path";
import {
  loadProtectedAppContext,
  PlatformApiError
} from "./platform-api";

export async function requireProtectedAppContext(): Promise<ProtectedAppContext> {
  try {
    return await loadProtectedAppContext();
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
    throw error;
  }
}
