import { semanticGroupPaletteColors } from "@seo-platform/contracts";

const labels: Readonly<Record<(typeof semanticGroupPaletteColors)[number], string>> = {
  "#ff0000": "Красный",
  "#ff8a00": "Оранжевый",
  "#f2c94c": "Жёлтый",
  "#84cc16": "Лаймовый",
  "#22c55e": "Зелёный",
  "#10b981": "Изумрудный",
  "#06b6d4": "Бирюзовый",
  "#2563eb": "Синий",
  "#4f46e5": "Индиго",
  "#6758ef": "Фиолетовый",
  "#ec4899": "Розовый",
  "#a8a5b8": "Серый",
  "#8b4513": "Коричневый",
  "#9f1239": "Бордовый",
  "#0f766e": "Петрольный",
  "#334155": "Графитовый"
};

export const semanticGroupColors = semanticGroupPaletteColors.map((value) => ({
  value,
  label: labels[value]
}));

export const semanticGroupDefaultColor = "#6758ef" as const;
