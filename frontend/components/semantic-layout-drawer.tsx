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
  SemanticQueryIndicator,
  SemanticSavedView,
  SemanticViewColumn,
  SemanticViewConfig
} from "./semantic-view-types";
import {
  semanticColumnOrderFor,
  semanticQueryIndicatorsFor
} from "./semantic-view-types";
import { Icon } from "./icon";
import { useUiLocale, UiText } from "./ui-locale";


type LayoutTab = "COLUMNS" | "PRESENTATION";

export function SemanticLayoutDrawer({
  activeView,
  config,
  customColumns,
  rankColumns = [],
  rankError,
  onRefreshRanks,
  onApply,
  onApplySavedView,
  onClose,
  onDensityChange,
  onMoveColumn,
  onOpenCustomColumns,
  onReset,
  onToggleColumn,
  onToggleQueryIndicator,
  projectId,
  saving,
  currentUserId,
  canManageShared,
  isActiveViewDirty,
  onActiveViewChange
}: Readonly<{
  activeView: SemanticSavedView | undefined;
  config: SemanticViewConfig;
  customColumns: readonly SemanticCustomColumn[];
  rankColumns?: readonly Readonly<{ key: SemanticViewColumn; label: string }>[];
  rankError?: string | undefined;
  onRefreshRanks?: () => void;
  onApply: () => void;
  onApplySavedView: (view: SemanticSavedView) => void;
  onClose: () => void;
  onDensityChange: (density: SemanticViewConfig["density"]) => void;
  onMoveColumn: (source: SemanticViewColumn, target: SemanticViewColumn) => void;
  onOpenCustomColumns: () => void;
  onReset: () => void;
  onToggleColumn: (column: SemanticViewColumn) => void;
  onToggleQueryIndicator: (indicator: SemanticQueryIndicator) => void;
  projectId: string;
  saving: boolean;
  currentUserId: string;
  canManageShared: boolean;
  isActiveViewDirty: boolean;
  onActiveViewChange: (view?: SemanticSavedView) => void;
}>) {
  const { t: uiText } = useUiLocale();
  const [tab, setTab] = useState<LayoutTab>("COLUMNS");
  const [search, setSearch] = useState("");
  const [dragged, setDragged] = useState<SemanticViewColumn>();
  const columns = useMemo(() => [
    ...systemColumns,
    ...rankColumns,
    ...customColumns.map((column) => ({
      key: `custom:${column.id}` as SemanticViewColumn,
      label: column.name
    }))
  ], [customColumns, rankColumns]);
  const normalizedSearch = search.trim().toLocaleLowerCase("ru-RU");
  const orderedColumns = semanticColumnOrderFor(
    config,
    columns.map(({ key }) => key)
  ).flatMap((key) => {
    const column = columns.find((item) => item.key === key);
    return column ? [column] : [];
  });
  const visible = normalizedSearch
    ? orderedColumns.filter(({ label }) =>
        label.toLocaleLowerCase("ru-RU").includes(normalizedSearch)
      )
    : orderedColumns;
  const pinned = visible.filter(({ key }) => key === "query");
  const tableColumns = visible.filter(({ key }) => key !== "query");
  const queryIndicators = semanticQueryIndicatorsFor(config);

  return (
    <aside
      aria-label={uiText("Колонки и представления")}
      className="semantic-layout-drawer"
      data-presence-cursor-anchor="true"
      data-presence-key="semantic-layout-drawer"
    >
      <header>
        <div><span><UiText text="Таблица" /></span><h2><UiText text="Колонки и представления" /></h2></div>
        <button aria-label={uiText("Закрыть настройки таблицы")} onClick={onClose} type="button">×</button>
      </header>
      <div className="semantic-layout-tabs" role="tablist">
        {(["COLUMNS", "PRESENTATION"] as const).map((value) => (
          <button aria-selected={tab === value} key={value} onClick={() => setTab(value)} role="tab" type="button">
            {<UiText text={layoutTabLabel(value) ?? ""} />}
          </button>
        ))}
      </div>

      {tab === "COLUMNS" && (
        <div className="semantic-layout-body">
          <p className="semantic-layout-rank-help"><UiText text="Для сравнения городов включите их позиции, URL и даты съёма. Названия колонок содержат город и устройство." /></p>
          <p className="semantic-layout-rank-help"><UiText text="Включено колонок: {0} из 128." values={[String(config.columns.length)]} /></p>
          {rankError && <div className="inline-alert warning"><UiText text={rankError} /><button type="button" onClick={onRefreshRanks}><UiText text="Повторить" /></button></div>}
          <label className="semantic-layout-search">
            <Icon name="search" />
            <input onChange={(event) => setSearch(event.target.value)} placeholder={uiText("Найти колонку")} value={search} />
            {search && <button aria-label={uiText("Очистить поиск колонок")} onClick={() => setSearch("")} type="button"><Icon name="close" /></button>}
          </label>
          {pinned.length > 0 && <ColumnGroup title={uiText("Закреплённые")}>
            {pinned.map((column) => (
              <div className="semantic-layout-pinned-column" key={column.key}>
                <ColumnRow
                  checked
                  column={column}
                  onToggle={() => onToggleColumn(column.key)}
                />
                <div className="semantic-layout-query-indicators">
                  {queryIndicatorOptions.map(({ key, label }) => {
                    const checked = queryIndicators.includes(key);
                    return (
                      <label className="semantic-layout-query-indicator" key={key}>
                        <span aria-hidden="true" className="semantic-layout-query-branch" />
                        <input
                          checked={checked}
                          onChange={() => onToggleQueryIndicator(key)}
                          type="checkbox"
                        />
                        <span>{label}</span>
                        <Icon name={checked ? "eye" : "eyeOff"} />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </ColumnGroup>}
          <ColumnGroup title={uiText("В таблице")}>
            {tableColumns.map((column) => (
              <ColumnRow
                checked={config.columns.includes(column.key)}
                column={column}
                disabled={!config.columns.includes(column.key) && config.columns.length >= 128}
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
          {visible.length === 0 && (
            <p className="semantic-layout-empty"><UiText text="Колонки не найдены." /></p>
          )}
          <button className="text-button semantic-custom-columns-link" onClick={onOpenCustomColumns} type="button">
            <Icon name="plus" /> <UiText text="Пользовательские колонки" before=" " /></button>
        </div>
      )}

      {tab === "PRESENTATION" && (
        <div className="semantic-layout-body semantic-layout-presentation">
          <section className="semantic-layout-density-section">
            <header>
              <div>
                <strong><UiText text="Плотность таблицы" /></strong>
                <small><UiText text="Настройте высоту строк под текущую задачу." /></small>
              </div>
            </header>
            <div className="semantic-density-options">
              <button className={config.density === "COMFORTABLE" ? "selected" : undefined} onClick={() => onDensityChange("COMFORTABLE")} type="button">
                <Icon name="list" /><span><strong><UiText text="Обычная" /></strong><small><UiText text="Компактные строки с тегами под запросом." /></small></span>
              </button>
              <button className={config.density === "COMPACT" ? "selected" : undefined} onClick={() => onDensityChange("COMPACT")} type="button">
                <Icon name="semantic" /><span><strong><UiText text="Компактная" /></strong><small><UiText text="Минимальная высота, одна строка без тегов." /></small></span>
              </button>
            </div>
          </section>
          <SemanticSavedViews
            activeView={activeView}
            canManageShared={canManageShared}
            config={config}
            currentUserId={currentUserId}
            embedded
            isActiveViewDirty={isActiveViewDirty}
            onApply={onApplySavedView}
            onActiveViewChange={onActiveViewChange}
            projectId={projectId}
          />
        </div>
      )}

      <footer>
        <button className="secondary-button" disabled={saving} onClick={onReset} type="button"><UiText text="Сбросить" /></button>
        <button className="primary-button" disabled={saving} onClick={onApply} type="button">
          {saving ? <UiText text="Сохраняем…" /> : <UiText text="Применить" />}
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
  disabled = false,
  onToggle,
  ...dragProps
}: Readonly<{
  checked: boolean;
  column: Readonly<{ key: SemanticViewColumn; label: string }>;
  disabled?: boolean;
  onToggle: () => void;
}> & HTMLAttributes<HTMLLabelElement>) {
  return (
    <label className="semantic-layout-column-row" {...dragProps}>
      <span aria-hidden="true" className="semantic-column-grip">⋮⋮</span>
      <input checked={checked} disabled={disabled || column.key === "query"} onChange={onToggle} type="checkbox" />
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
  { key: "yandexRelevantUrl", label: "URL из съёма Яндекс" },
  { key: "googlePosition", label: "Позиция Google" },
  { key: "googleRelevantUrl", label: "URL из съёма Google" },
  { key: "yandexAiPosition", label: "ИИ-позиция Яндекс" },
  { key: "yandexAiRelevantUrl", label: "URL ИИ-выдачи Яндекс" },
  { key: "googleAiPosition", label: "ИИ-позиция Google" },
  { key: "googleAiRelevantUrl", label: "URL ИИ-выдачи Google" },
  { key: "yandexCheckedAt", label: "Дата съёма Яндекс" },
  { key: "googleCheckedAt", label: "Дата съёма Google" },
  { key: "yandexAiCheckedAt", label: "Дата ИИ-съёма Яндекс" },
  { key: "googleAiCheckedAt", label: "Дата ИИ-съёма Google" },
  { key: "visibility", label: "Видимость" },
  { key: "group", label: "Группа" },
  { key: "cluster", label: "Кластер" },
  { key: "intent", label: "Интент" },
  { key: "priority", label: "Приоритет" },
  { key: "targetUrl", label: "Целевой URL" },
  { key: "tags", label: "Теги" },
  { key: "source", label: "Источник" },
  { key: "updatedAt", label: "Обновлено" }
];

const queryIndicatorOptions: readonly Readonly<{
  key: SemanticQueryIndicator;
  label: string;
}>[] = [
  { key: "MULTIPLE_URLS", label: "Несколько URL" },
  { key: "TARGET_URL_MISMATCH", label: "Нецелевой URL" }
];
