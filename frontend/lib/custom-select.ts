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

function normalizeSearchText(value: string): string {
  return normalizeSelectSearchText(value);
}
