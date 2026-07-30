import { validationError } from "../common/domain-error.js";

export function semanticVersionUndoInput(value: unknown): Record<string, never> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    throw validationError(
      "$",
      "EMPTY_OBJECT_REQUIRED",
      "Semantic version undo accepts only an empty object"
    );
  }
  return {};
}
