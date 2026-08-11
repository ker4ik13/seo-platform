"use client";

import {
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode
} from "react";
import type { SemanticCustomColumn } from "./semantic-custom-column-types";
import { SemanticSavedViews } from "./semantic-saved-views";
import type {
  SemanticSavedView,
  SemanticViewColumn,
  SemanticViewConfig
} from "./semantic-view-types";
import { Icon } from "./icon";

type LayoutTab = "COLUMNS" | "PRESENTATION";

export function SemanticLayoutDrawer({
  config,
  customColumns,
  onApply,
  onApplySavedView,
  onClose,
  onDensityChange,
  onMoveColumn,
  onOpenCustomColumns,
  onReset,
  onToggleColumn,
  projectId,
  saving
}: Readonly<{
  config: SemanticViewConfig;
  customColumns: readonly SemanticCustomColumn[];
  onApply: () => void;
  onApplySavedView: (view: SemanticSavedView) => void;
  onClose: () => void;
  onDensityChange: (density: SemanticViewConfig["density"]) => void;
  onMoveColumn: (source: SemanticViewColumn, target: SemanticViewColumn) => void;
  onOpenCustomColumns: () => void;
  onReset: () => void;
  onToggleColumn: (column: SemanticViewColumn) => void;
  projectId: string;
  saving: boolean;
}>) {
  const [tab, setTab] = useState<LayoutTab>("COLUMNS");
  const [search, setSearch] = useState("");
  const [dragged, setDragged] = useState<SemanticViewColumn>();
  const columns = useMemo(() => [
    ...systemColumns,
    ...customColumns.map((column) => ({
      key: `custom:${column.id}` as SemanticViewColumn,
      label: column.name
    }))
  ], [customColumns]);
  const normalizedSearch = search.trim().toLocaleLowerCase("ru-RU");
  const visible = normalizedSearch
    ? columns.filter(({ label }) => label.toLocaleLowerCase("ru-RU").includes(normalizedSearch))
    : columns;
  const enabled = config.columns.flatMap((key) => {
    const column = visible.find((item) => item.key === key);
    return column ? [column] : [];
  });
  const pinned = enabled.filter(({ key }) => key === "query");
  const inTable = enabled.filter(({ key }) => key !== "query");
  const available = visible.filter(({ key }) => !config.columns.includes(key));

  return (
    <aside aria-label="Колонки и представления" className="semantic-layout-drawer">
      <header>
        <div><span>Таблица</span><h2>Колонки и представления</h2></div>
        <button aria-label="Закрыть настройки таблицы" onClick={onClose} type="button">×</button>
      </header>
      <div className="semantic-layout-tabs" role="tablist">
        {(["COLUMNS", "PRESENTATION"] as const).map((value) => (
          <button aria-selected={tab === value} key={value} onClick={() => setTab(value)} role="tab" type="button">
            {layoutTabLabel(value)}
          </button>
        ))}
      </div>

      {tab === "COLUMNS" && (
        <div className="semantic-layout-body">
          <label className="semantic-layout-search">
            <Icon name="search" />
            <input onChange={(event) => setSearch(event.target.value)} placeholder="Найти колонку" value={search} />
            {search && <button aria-label="Очистить поиск колонок" onClick={() => setSearch("")} type="button"><Icon name="close" /></button>}
          </label>
          {pinned.length > 0 && <ColumnGroup title="Закреплённые">
            {pinned.map((column) => (
              <ColumnRow
                checked
                column={column}
                key={column.key}
                onToggle={() => onToggleColumn(column.key)}
              />
            ))}
          </ColumnGroup>}
          <ColumnGroup title="В таблице">
            {inTable.map((column) => (
              <ColumnRow
                checked
                column={column}
                draggable={column.key !== "query"}
                key={column.key}
                onDragEnd={() => setDragged(undefined)}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => setDragged(column.key)}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged && dragged !== column.key) onMoveColumn(dragged, column.key);
                  setDragged(undefined);
                }}
                onToggle={() => onToggleColumn(column.key)}
              />
            ))}
          </ColumnGroup>
          <ColumnGroup title="Доступные">
            {available.length > 0
              ? available.map((column) => (
                  <ColumnRow checked={false} column={column} key={column.key} onToggle={() => onToggleColumn(column.key)} />
                ))
              : <p className="semantic-layout-empty">Все найденные колонки уже включены.</p>}
          </ColumnGroup>
          <button className="text-button semantic-custom-columns-link" onClick={onOpenCustomColumns} type="button">
            <Icon name="plus" /> Пользовательские колонки
          </button>
        </div>
      )}

      {tab === "PRESENTATION" && (
        <div className="semantic-layout-body semantic-layout-presentation">
          <section className="semantic-layout-density-section">
            <header>
              <div>
                <strong>Плотность таблицы</strong>
                <small>Настройте высоту строк под текущую задачу.</small>
              </div>
            </header>
            <div className="semantic-density-options">
              <button className={config.density === "COMFORTABLE" ? "selected" : undefined} onClick={() => onDensityChange("COMFORTABLE")} type="button">
                <Icon name="list" /><span><strong>Обычная</strong><small>Компактные строки с тегами под запросом.</small></span>
              </button>
              <button className={config.density === "COMPACT" ? "selected" : undefined} onClick={() => onDensityChange("COMPACT")} type="button">
                <Icon name="semantic" /><span><strong>Компактная</strong><small>Минимальная высота, одна строка без тегов.</small></span>
              </button>
            </div>
          </section>
          <SemanticSavedViews
            config={config}
            embedded
            onApply={onApplySavedView}
            projectId={projectId}
          />
        </div>
      )}

      <footer>
        <button className="secondary-button" disabled={saving} onClick={onReset} type="button">Сбросить</button>
        <button className="primary-button" disabled={saving} onClick={onApply} type="button">
          {saving ? "Сохраняем…" : "Применить"}
        </button>
      </footer>
    </aside>
  );
}

function ColumnGroup({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return <section className="semantic-layout-column-group"><h3>{title}</h3>{children}</section>;
}

function ColumnRow({
  checked,
  column,
  onToggle,
  ...dragProps
}: Readonly<{
  checked: boolean;
  column: Readonly<{ key: SemanticViewColumn; label: string }>;
  onToggle: () => void;
}> & HTMLAttributes<HTMLLabelElement>) {
  return (
    <label className="semantic-layout-column-row" {...dragProps}>
      <span aria-hidden="true" className="semantic-column-grip">⋮⋮</span>
      <input checked={checked} disabled={column.key === "query"} onChange={onToggle} type="checkbox" />
      <span>{column.label}</span>
      <Icon name={checked ? "eye" : "eyeOff"} />
    </label>
  );
}

function layoutTabLabel(tab: LayoutTab): string {
  return { COLUMNS: "Колонки", PRESENTATION: "Представление и плотность" }[tab];
}

const systemColumns: readonly Readonly<{ key: SemanticViewColumn; label: string }>[] = [
  { key: "query", label: "Запрос" },
  { key: "frequency", label: "Частотность: базовая" },
  { key: "frequencyExact", label: "Частотность: фразовая" },
  { key: "frequencyFixed", label: "Частотность: точная" },
  { key: "wordCount", label: "Количество слов" },
  { key: "yandexPosition", label: "Позиция Яндекс" },
  { key: "googlePosition", label: "Позиция Google" },
  { key: "yandexRelevantUrl", label: "URL Яндекс" },
  { key: "googleRelevantUrl", label: "URL Google" },
  { key: "yandexCheckedAt", label: "Дата съёма Яндекс" },
  { key: "googleCheckedAt", label: "Дата съёма Google" },
  { key: "visibility", label: "Видимость" },
  { key: "group", label: "Группа" },
  { key: "cluster", label: "Кластер" },
  { key: "intent", label: "Интент" },
  { key: "priority", label: "Приоритет" },
  { key: "targetUrl", label: "Целевая страница" },
  { key: "tags", label: "Теги" },
  { key: "source", label: "Источник" },
  { key: "updatedAt", label: "Обновлено" }
];
