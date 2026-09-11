const BROWSER_REFRESH_LOCK = "seonorita:session-refresh:v1";
const MAX_IN_FLIGHT_SERVER_REFRESHES = 256;

export interface BrowserSessionRefreshLockManager {
  request(
    name: string,
    options: Readonly<{ mode: "exclusive" }>,
    callback: () => Promise<boolean>
  ): Promise<boolean>;
}

const serverRefreshes = new Map<string, Promise<Response>>();

export async function coordinatedBrowserSessionRefresh(
  observedCsrf: string,
  readCurrentCsrf: () => string | undefined,
  refresh: (csrf: string) => Promise<boolean>,
  locks?: BrowserSessionRefreshLockManager
): Promise<boolean> {
  const rotateOrReusePeerResult = async (): Promise<boolean> => {
    const currentCsrf = readCurrentCsrf();
    if (!currentCsrf) return false;
    // The CSRF token rotates with the HttpOnly access/refresh pair. A changed
    // value means another same-origin tab completed rotation while this tab
    // waited for the lock, so the original API request can use those cookies.
    if (currentCsrf !== observedCsrf) return true;
    return refresh(currentCsrf);
  };
  return locks
    ? locks.request(
        BROWSER_REFRESH_LOCK,
        { mode: "exclusive" },
        rotateOrReusePeerResult
      )
    : rotateOrReusePeerResult();
}

export async function coalescedServerSessionRefresh(
  key: string | undefined,
  refresh: () => Promise<Response>
): Promise<Response> {
  if (!key) return refresh();
  const existing = serverRefreshes.get(key);
  if (existing) return (await existing).clone();
  if (serverRefreshes.size >= MAX_IN_FLIGHT_SERVER_REFRESHES) {
    return refresh();
  }

  const pending = Promise.resolve().then(refresh);
  serverRefreshes.set(key, pending);
  void pending.finally(() => {
    if (serverRefreshes.get(key) === pending) serverRefreshes.delete(key);
  }).catch(() => undefined);
  return (await pending).clone();
}
