"use client";

import {
  semanticKeywordMultiSearchMaxTerms,
  type SemanticKeywordMultiSearch,
  type SemanticKeywordMultiSearchMode
} from "@seo-platform/contracts";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Icon } from "./icon";
import { SemanticModal } from "./semantic-modal";

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
      description="Вставьте список — одна фраза на строку"
      footer={(
        <div className="semantic-multi-search-footer">
          <span>
            <strong>{parsed.terms.length.toLocaleString("ru-RU")}</strong>
            запросов · дублей удалено: {parsed.duplicateCount.toLocaleString("ru-RU")}
          </span>
          <div>
            <button className="secondary-button" onClick={onClose} type="button">Отмена</button>
            <button
              className="primary-button"
              disabled={parsed.terms.length === 0 || parsed.tooMany}
              form={formId}
              type="submit"
            >
              {action === "MOVE"
                ? "Найти и перенести"
                : action === "SELECT"
                  ? "Найти и выделить"
                  : "Показать в таблице"}
            </button>
          </div>
        </div>
      )}
      onClose={onClose}
      presenceKey="semantic-modal:multi-search"
      size="medium"
      title="Поиск по списку запросов"
    >
      <form className="semantic-multi-search" id={formId} onSubmit={submit}>
        <label className="semantic-multi-search-input">
          <span>Запросы</span>
          <textarea
            autoFocus
            onChange={(event) => setText(event.target.value)}
            placeholder={"купить холодильник\nхолодильник цена\nремонт холодильника"}
            rows={10}
            value={text}
          />
          <small>
            До {semanticKeywordMultiSearchMaxTerms.toLocaleString("ru-RU")} уникальных строк
          </small>
        </label>

        <fieldset className="semantic-multi-search-modes">
          <legend>Как искать</legend>
          <SearchMode
            checked={mode === "EXACT"}
            description="Полное совпадение нормализованной фразы"
            label="Точно"
            onSelect={() => setMode("EXACT")}
          />
          <SearchMode
            checked={mode === "CONTAINS"}
            description="Фраза встречается внутри запроса"
            label="Вхождение"
            onSelect={() => setMode("CONTAINS")}
          />
          <SearchMode
            checked={mode === "ALL_WORDS"}
            description="Все слова есть, порядок не важен"
            label="Все слова"
            onSelect={() => setMode("ALL_WORDS")}
          />
        </fieldset>

        <fieldset className="semantic-multi-search-actions">
          <legend>Что сделать с найденными</legend>
          <ActionCard
            checked={action === "SHOW"}
            icon="search"
            label="Показать"
            onSelect={() => setAction("SHOW")}
          />
          <ActionCard
            checked={action === "SELECT"}
            icon="checkDouble"
            label="Показать и выделить"
            onSelect={() => setAction("SELECT")}
          />
          <ActionCard
            checked={action === "MOVE"}
            icon="move"
            label="Сразу перенести"
            onSelect={() => setAction("MOVE")}
          />
        </fieldset>

        {parsed.tooMany && (
          <div className="inline-alert danger" role="alert">
            Список больше лимита. Оставьте не более {semanticKeywordMultiSearchMaxTerms.toLocaleString("ru-RU")} уникальных строк.
          </div>
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
