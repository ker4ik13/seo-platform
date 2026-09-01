export interface SelectSearchOption {
  readonly disabled: boolean;
  readonly searchText: string;
}

export function filterSelectOptions<T extends SelectSearchOption>(
  options: readonly T[],
  query: string
): readonly T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return options;
  return options.filter((option) => option.searchText.includes(normalizedQuery));
}

export function nextSelectIndex(
  options: readonly Pick<SelectSearchOption, "disabled">[],
  currentIndex: number,
  direction: 1 | -1
): number {
  if (options.every((option) => option.disabled)) return -1;
  let index = currentIndex;
  for (let step = 0; step < options.length; step += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

export function normalizeSelectSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

export function moveSelectValue(
  values: readonly string[],
  movedValue: string,
  targetValue: string,
  edge: "before" | "after"
): readonly string[] {
  if (movedValue === targetValue) return values;
  const sourceIndex = values.indexOf(movedValue);
  if (sourceIndex < 0 || !values.includes(targetValue)) return values;
  const result = values.filter((value) => value !== movedValue);
  const targetIndex = result.indexOf(targetValue);
  result.splice(targetIndex + (edge === "after" ? 1 : 0), 0, movedValue);
  return result.every((value, index) => value === values[index])
    ? values
    : result;
}

function normalizeSearchText(value: string): string {
  return normalizeSelectSearchText(value);
}
