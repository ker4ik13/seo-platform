const LAST_RANK_CREDENTIAL_PREFIX = "seo:last-rank-credential";

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readLastRankCredentialId(
  storage: PreferenceStorage,
  projectId: string,
  allowedCredentialIds: readonly string[]
): string | undefined {
  const key = preferenceKey(projectId);
  try {
    const stored = storage.getItem(key);
    if (!stored || !allowedCredentialIds.includes(stored)) {
      if (stored) storage.removeItem(key);
      return undefined;
    }
    return stored;
  } catch {
    return undefined;
  }
}

export function writeLastRankCredentialId(
  storage: PreferenceStorage,
  projectId: string,
  credentialId: string
): void {
  try {
    storage.setItem(preferenceKey(projectId), credentialId);
  } catch {
    // A blocked or full browser storage must never block a paid operation.
  }
}

function preferenceKey(projectId: string): string {
  return `${LAST_RANK_CREDENTIAL_PREFIX}:${projectId}`;
}
