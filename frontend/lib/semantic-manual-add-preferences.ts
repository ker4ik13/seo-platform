export const semanticManualDuplicateModes = [
  "SKIP_PROJECT",
  "PRESERVE_FOLDERS",
  "CURRENT_GROUP"
] as const;

export type SemanticManualDuplicateMode =
  (typeof semanticManualDuplicateModes)[number];

export interface SemanticManualAddPreferences {
  readonly duplicateMode: SemanticManualDuplicateMode;
}

export function semanticManualDuplicateTargetGroupId(
  mode: SemanticManualDuplicateMode,
  primaryGroupId: string,
  currentGroupId: string
): string {
  if (mode === "PRESERVE_FOLDERS") return primaryGroupId;
  if (mode === "CURRENT_GROUP") return currentGroupId || primaryGroupId;
  return "";
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storagePrefix = "seonorita:semantic-manual-add:v2:";
const legacyStoragePrefix = "seonorita:semantic-manual-add:v1:";
const defaults: SemanticManualAddPreferences = {
  duplicateMode: "SKIP_PROJECT"
};

export function readSemanticManualAddPreferences(
  projectId: string,
  storage: StorageLike
): SemanticManualAddPreferences {
  try {
    const raw = storage.getItem(`${storagePrefix}${projectId}`);
    if (raw) {
      const value = JSON.parse(raw) as Readonly<{
        duplicateMode?: unknown;
      }>;
      return {
        duplicateMode:
          typeof value.duplicateMode === "string" &&
          semanticManualDuplicateModes.includes(
            value.duplicateMode as SemanticManualDuplicateMode
          )
            ? (value.duplicateMode as SemanticManualDuplicateMode)
            : value.duplicateMode === "SPECIFIC_FOLDER"
              ? "CURRENT_GROUP"
              : defaults.duplicateMode
      };
    }
    const legacyRaw = storage.getItem(`${legacyStoragePrefix}${projectId}`);
    if (!legacyRaw) return defaults;
    const legacy = JSON.parse(legacyRaw) as Readonly<{
      addDuplicatesToGroup?: unknown;
      skipDuplicates?: unknown;
    }>;
    return {
      duplicateMode:
        legacy.addDuplicatesToGroup === true || legacy.skipDuplicates === false
          ? "PRESERVE_FOLDERS"
          : "SKIP_PROJECT"
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
      JSON.stringify(preferences)
    );
  } catch {
    // The command still carries an explicit policy when storage is unavailable.
  }
}
