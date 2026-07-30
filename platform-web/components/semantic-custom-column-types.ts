export type SemanticCustomColumnType =
  | "TEXT"
  | "LONG_TEXT"
  | "INTEGER"
  | "DECIMAL"
  | "BOOLEAN"
  | "DATE"
  | "DATETIME"
  | "SELECT"
  | "MULTI_SELECT"
  | "URL"
  | "USER"
  | "STATUS";

export interface SemanticCustomColumnOption {
  readonly id: string;
  readonly label: string;
  readonly color?: string;
}

export interface SemanticCustomColumn {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly type: SemanticCustomColumnType;
  readonly config: Readonly<{
    required: boolean;
    options?: readonly SemanticCustomColumnOption[];
  }>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function customColumnTypeLabel(type: SemanticCustomColumnType): string {
  const labels: Record<SemanticCustomColumnType, string> = {
    TEXT: "Текст",
    LONG_TEXT: "Длинный текст",
    INTEGER: "Целое число",
    DECIMAL: "Десятичное число",
    BOOLEAN: "Да / нет",
    DATE: "Дата",
    DATETIME: "Дата и время",
    SELECT: "Один вариант",
    MULTI_SELECT: "Несколько вариантов",
    URL: "URL",
    USER: "Пользователь",
    STATUS: "Статус"
  };
  return labels[type];
}

export function customColumnSupportsOptions(
  type: SemanticCustomColumnType
): boolean {
  return ["SELECT", "MULTI_SELECT", "STATUS"].includes(type);
}
