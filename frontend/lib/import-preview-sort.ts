export interface ImportPreviewSort {
  readonly columnIndex: number;
  readonly direction: "ASC" | "DESC";
}

export function sortImportPreviewRows(
  rows: readonly (readonly string[])[],
  sort: ImportPreviewSort | undefined
): readonly (readonly string[])[] {
  if (!sort) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = left.row[sort.columnIndex]?.trim() ?? "";
      const rightValue = right.row[sort.columnIndex]?.trim() ?? "";
      if (!leftValue && !rightValue) return left.index - right.index;
      if (!leftValue) return 1;
      if (!rightValue) return -1;
      const compared = compareImportPreviewValues(leftValue, rightValue);
      return (sort.direction === "ASC" ? compared : -compared) ||
        left.index - right.index;
    })
    .map(({ row }) => row);
}

function compareImportPreviewValues(left: string, right: string): number {
  const numberPattern = /^-?\d+(?:[.,]\d+)?$/u;
  if (numberPattern.test(left) && numberPattern.test(right)) {
    return Number(left.replace(",", ".")) - Number(right.replace(",", "."));
  }
  const datePattern = /^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/u;
  if (datePattern.test(left) && datePattern.test(right)) {
    const difference = Date.parse(left.replace(" ", "T")) -
      Date.parse(right.replace(" ", "T"));
    if (Number.isFinite(difference)) return difference;
  }
  return left.localeCompare(right, "ru", {
    numeric: true,
    sensitivity: "base"
  });
}
