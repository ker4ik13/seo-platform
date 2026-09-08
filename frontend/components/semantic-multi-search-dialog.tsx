"use client";

import {
  semanticKeywordMultiSearchMaxTerms,
  type SemanticKeywordMultiSearch,
  type SemanticKeywordMultiSearchMode
} from "@seo-platform/contracts";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Icon } from "./icon";
import { SemanticModal } from "./semantic-modal";
import { useUiLocale, UiText } from "./ui-locale";


export type SemanticMultiSearchAction = "SHOW" | "SELECT" | "MOVE";

export function SemanticMultiSearchDialog({
  initialSearch,
  onApply,
  onClose
}: Readonly<{
  initialSearch?: SemanticKeywordMultiSearch;
  onApply: (
    search: SemanticKeywordMultiSearch,
    action: SemanticMultiSearchAction
  ) => void;
  onClose: () => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const formId = useId();
  const [text, setText] = useState(initialSearch?.terms.join("\n") ?? "");
  const [mode, setMode] = useState<SemanticKeywordMultiSearchMode>(
    initialSearch?.mode ?? "EXACT"
  );
  const [action, setAction] = useState<SemanticMultiSearchAction>("SHOW");
  const parsed = useMemo(() => parseMultiSearchTerms(text), [text]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (parsed.terms.length === 0 || parsed.tooMany) return;
    onApply({ terms: parsed.terms, mode }, action);
  }

  return (
    <SemanticModal
      className="semantic-multi-search-modal"
      description={uiText("Вставьте список — одна фраза на строку")}
      footer={(
        <div className="semantic-multi-search-footer">
          <span>
            <strong>{parsed.terms.length.toLocaleString(uiLocale)}</strong>
            <UiText text="запросов · дублей удалено:" after=" " />{parsed.duplicateCount.toLocaleString(uiLocale)}
          </span>
          <div>
            <button className="secondary-button" onClick={onClose} type="button"><UiText text="Отмена" /></button>
            <button
              className="primary-button"
              disabled={parsed.terms.length === 0 || parsed.tooMany}
              form={formId}
              type="submit"
            >
              {action === "MOVE"
                ? <UiText text="Найти и перенести" />
                : action === "SELECT"
                  ? <UiText text="Найти и выделить" />
                  : <UiText text="Показать в таблице" />}
            </button>
          </div>
        </div>
      )}
      onClose={onClose}
      presenceKey="semantic-modal:multi-search"
      size="medium"
      title={uiText("Поиск по списку запросов")}
    >
      <form className="semantic-multi-search" id={formId} onSubmit={submit}>
        <label className="semantic-multi-search-input">
          <span><UiText text="Запросы" /></span>
          <textarea
            autoFocus
            onChange={(event) => setText(event.target.value)}
            placeholder={uiText("купить холодильник холодильник цена ремонт холодильника")}
            rows={10}
            value={text}
          />
          <small>
            <UiText text="До" after=" " />{semanticKeywordMultiSearchMaxTerms.toLocaleString(uiLocale)} <UiText text="уникальных строк" before=" " /></small>
        </label>

        <fieldset className="semantic-multi-search-modes">
          <legend><UiText text="Как искать" /></legend>
          <SearchMode
            checked={mode === "EXACT"}
            description={uiText("Полное совпадение нормализованной фразы")}
            label={uiText("Точно")}
            onSelect={() => setMode("EXACT")}
          />
          <SearchMode
            checked={mode === "CONTAINS"}
            description={uiText("Фраза встречается внутри запроса")}
            label={uiText("Вхождение")}
            onSelect={() => setMode("CONTAINS")}
          />
          <SearchMode
            checked={mode === "ALL_WORDS"}
            description={uiText("Все слова есть, порядок не важен")}
            label={uiText("Все слова")}
            onSelect={() => setMode("ALL_WORDS")}
          />
        </fieldset>

        <fieldset className="semantic-multi-search-actions">
          <legend><UiText text="Что сделать с найденными" /></legend>
          <ActionCard
            checked={action === "SHOW"}
            icon="search"
            label={uiText("Показать")}
            onSelect={() => setAction("SHOW")}
          />
          <ActionCard
            checked={action === "SELECT"}
            icon="checkDouble"
            label={uiText("Показать и выделить")}
            onSelect={() => setAction("SELECT")}
          />
          <ActionCard
            checked={action === "MOVE"}
            icon="move"
            label={uiText("Сразу перенести")}
            onSelect={() => setAction("MOVE")}
          />
        </fieldset>

        {parsed.tooMany && (
          <div className="inline-alert danger" role="alert">
            <UiText text="Список больше лимита. Оставьте не более" after=" " />{semanticKeywordMultiSearchMaxTerms.toLocaleString(uiLocale)} <UiText text="уникальных строк." before=" " /></div>
        )}
      </form>
    </SemanticModal>
  );
}

function SearchMode({
  checked,
  description,
  label,
  onSelect
}: Readonly<{
  checked: boolean;
  description: string;
  label: string;
  onSelect: () => void;
}>) {
  return (
    <label className={checked ? "selected" : undefined}>
      <input checked={checked} onChange={onSelect} type="radio" />
      <span><strong>{label}</strong><small>{description}</small></span>
    </label>
  );
}

function ActionCard({
  checked,
  icon,
  label,
  onSelect
}: Readonly<{
  checked: boolean;
  icon: "search" | "checkDouble" | "move";
  label: string;
  onSelect: () => void;
}>) {
  return (
    <label className={checked ? "selected" : undefined}>
      <input checked={checked} onChange={onSelect} type="radio" />
      <Icon name={icon} />
      <span>{label}</span>
    </label>
  );
}

function parseMultiSearchTerms(value: string): Readonly<{
  terms: readonly string[];
  duplicateCount: number;
  tooMany: boolean;
}> {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.normalize("NFKC").trim().replace(/\s+/gu, " "))
    .filter(Boolean);
  const unique = new Map<string, string>();
  for (const line of lines) {
    const bounded = line.slice(0, 400);
    const key = bounded.toLocaleLowerCase("ru");
    if (!unique.has(key)) unique.set(key, bounded);
  }
  return {
    terms: [...unique.values()],
    duplicateCount: lines.length - unique.size,
    tooMany: unique.size > semanticKeywordMultiSearchMaxTerms
  };
}
