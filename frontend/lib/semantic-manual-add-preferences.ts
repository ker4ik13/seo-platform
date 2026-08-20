export interface SemanticManualAddPreferences {
  readonly addDuplicatesToGroup: boolean;
  readonly skipDuplicates: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storagePrefix = "seonorita:semantic-manual-add:v1:";
const defaults: SemanticManualAddPreferences = {
  addDuplicatesToGroup: false,
  skipDuplicates: true
};

export function readSemanticManualAddPreferences(
  projectId: string,
  storage: StorageLike
): SemanticManualAddPreferences {
  try {
    const raw = storage.getItem(`${storagePrefix}${projectId}`);
    if (!raw) return defaults;
    const value = JSON.parse(raw) as Readonly<{
      addDuplicatesToGroup?: unknown;
      skipDuplicates?: unknown;
    }>;
    const skipDuplicates =
      typeof value.skipDuplicates === "boolean"
        ? value.skipDuplicates
        : defaults.skipDuplicates;
    return {
      addDuplicatesToGroup:
        typeof value.addDuplicatesToGroup === "boolean"
          ? value.addDuplicatesToGroup
          : !skipDuplicates,
      skipDuplicates
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
      JSON.stringify({
        addDuplicatesToGroup: preferences.addDuplicatesToGroup,
        skipDuplicates: preferences.skipDuplicates
      })
    );
  } catch {
    // The command still carries an explicit policy when storage is unavailable.
  }
}
