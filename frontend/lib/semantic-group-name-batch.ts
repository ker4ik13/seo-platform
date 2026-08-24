import { semanticKeywordGroupBulkCreateMaxItems } from "@seo-platform/contracts";

export function normalizeSemanticGroupName(value: string): string {
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name) throw new Error("Введите название папки.");
  if (name.length > 255) {
    throw new Error("Название папки не должно быть длиннее 255 символов.");
  }
  if (name.includes("/")) {
    throw new Error("Название папки не может содержать символ «/».");
  }
  return name;
}

export function prepareSemanticGroupNames(
  values: readonly string[],
  unavailableNames: readonly string[] = []
): readonly string[] {
  if (values.length < 1) throw new Error("Добавьте хотя бы одну папку.");
  if (values.length > semanticKeywordGroupBulkCreateMaxItems) {
    throw new Error(
      `За один раз можно создать до ${semanticKeywordGroupBulkCreateMaxItems} папок.`
    );
  }

  const names = values.map(normalizeSemanticGroupName);
  const unavailable = new Set(unavailableNames.map(canonicalName));
  const seen = new Set<string>();
  for (const name of names) {
    const canonical = canonicalName(name);
    if (seen.has(canonical)) {
      throw new Error(`Папка «${name}» уже добавлена в список.`);
    }
    if (unavailable.has(canonical)) {
      throw new Error(`Папка «${name}» уже существует на выбранном уровне.`);
    }
    seen.add(canonical);
  }
  return names;
}

export function semanticGroupNamesFromText(
  value: string,
  unavailableNames: readonly string[] = []
): readonly string[] {
  return prepareSemanticGroupNames(
    value.split(/\r\n?|\n/u).filter((line) => line.trim().length > 0),
    unavailableNames
  );
}

export function semanticGroupNameLineCount(value: string): number {
  return value.split(/\r\n?|\n/u).filter((line) => line.trim().length > 0)
    .length;
}

function canonicalName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru");
}
