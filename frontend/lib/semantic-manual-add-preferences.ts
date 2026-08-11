export interface SemanticManualAddPreferences {
  readonly skipDuplicates: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storagePrefix = "seonorita:semantic-manual-add:v1:";
const defaults: SemanticManualAddPreferences = { skipDuplicates: true };

export function readSemanticManualAddPreferences(
  projectId: string,
  storage: StorageLike
): SemanticManualAddPreferences {
  try {
    const raw = storage.getItem(`${storagePrefix}${projectId}`);
    if (!raw) return defaults;
    const value = JSON.parse(raw) as Readonly<{ skipDuplicates?: unknown }>;
    return {
      skipDuplicates:
        typeof value.skipDuplicates === "boolean"
          ? value.skipDuplicates
          : defaults.skipDuplicates
    };
  } catch {
    return defaults;
  }
}

export function writeSemanticManualAddPreferences(
  projectId: string,
  preferences: SemanticManualAddPreferences,
  storage: StorageLike
): void {
  try {
    storage.setItem(
      `${storagePrefix}${projectId}`,
      JSON.stringify({ skipDuplicates: preferences.skipDuplicates })
    );
  } catch {
    // The command still carries an explicit policy when storage is unavailable.
  }
}
