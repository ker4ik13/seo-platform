"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type {
  SemanticKeywordTagDeleteResult,
  SemanticKeywordTagOption
} from "@seo-platform/contracts";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  keywordTagKey,
  normalizeKeywordTag,
  uniqueKeywordTags
} from "../lib/keyword-tags";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { SemanticModal } from "./semantic-modal";
import { ConfirmationActions } from "./confirmation-actions";
import { UiText, useUiLocale } from "./ui-locale";

interface PickerTagOption {
  readonly id?: string;
  readonly keywordCount: number;
  readonly name: string;
}

export function KeywordTagPicker({
  projectId,
  value,
  onChange,
  onTagDeleted,
  disabled = false,
  mode = "edit",
  availableTags
}: Readonly<{
  projectId: string;
  value: readonly string[];
  onChange: (tags: readonly string[]) => void;
  onTagDeleted?: (result: SemanticKeywordTagDeleteResult) => void;
  disabled?: boolean;
  mode?: "edit" | "add" | "remove";
  availableTags?: readonly string[];
}>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const { locale, t } = useUiLocale();
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<readonly SemanticKeywordTagOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<PickerTagOption>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [deleteNotice, setDeleteNotice] = useState<string>();
  const tags = useMemo(() => uniqueKeywordTags(value), [value]);
  const selected = useMemo(() => new Set(tags.map(keywordTagKey)), [tags]);
  const removing = mode === "remove";
  const label = removing ? "Снять теги" : mode === "add" ? "Добавить теги" : "Теги";
  const placeholder = removing ? "Выбрать теги для снятия" : "Выбрать или добавить тег";
  const normalizedQuery = normalizeKeywordTag(query);
  const tooLong = normalizedQuery.length > 160;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void browserApiRequest<readonly SemanticKeywordTagOption[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords/tags`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          !Array.isArray(result) ||
          result.some((tag) =>
            typeof tag.id !== "string" ||
            typeof tag.name !== "string" ||
            !Number.isSafeInteger(tag.keywordCount) ||
            tag.keywordCount < 0
          )
        ) {
          throw new Error("Invalid tags");
        }
        setCatalog(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, revision]);

  const options = useMemo<readonly PickerTagOption[]>(() => {
    const allowed = availableTags
      ? new Set(uniqueKeywordTags(availableTags).map(keywordTagKey))
      : undefined;
    const byKey = new Map<string, PickerTagOption>();
    for (const tag of catalog) {
      const key = keywordTagKey(tag.name);
      if (!allowed || allowed.has(key)) byKey.set(key, tag);
    }
    for (const name of availableTags ?? []) {
      const normalized = normalizeKeywordTag(name);
      const key = keywordTagKey(normalized);
      if (normalized && !byKey.has(key)) {
        byKey.set(key, { name: normalized, keywordCount: 0 });
      }
    }
    const searchKey = keywordTagKey(normalizedQuery);
    return [...byKey.values()]
      .filter(({ name }) => !searchKey || keywordTagKey(name).includes(searchKey))
      .slice(0, 100);
  }, [availableTags, catalog, normalizedQuery]);
  const optionByKey = useMemo(
    () => new Map(options.map((option) => [keywordTagKey(option.name), option])),
    [options]
  );

  const createOption = useCallback((search: string) => {
    const name = normalizeKeywordTag(search);
    const key = keywordTagKey(name);
    if (
      removing ||
      !name ||
      name.length > 160 ||
      selected.has(key) ||
      options.some((option) => keywordTagKey(option.name) === key) ||
      tags.length >= 50
    ) return undefined;
    return { value: name, label: <UiText text="Добавить «{0}»" values={[name]} /> };
  }, [options, removing, selected, tags.length]);

  function add(value: string): void {
    const normalized = normalizeKeywordTag(value);
    if (
      !normalized ||
      normalized.length > 160 ||
      selected.has(keywordTagKey(normalized)) ||
      tags.length >= 50
    ) return;
    if (
      removing &&
      !options.some((tag) => keywordTagKey(tag.name) === keywordTagKey(normalized))
    ) return;
    onChange([...tags, normalized]);
  }

  async function deleteTag(): Promise<void> {
    const target = deleteTarget;
    if (!target?.id || deleting) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      const result = await browserApiRequest<SemanticKeywordTagDeleteResult>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/tags/${encodeURIComponent(target.id)}`,
        { method: "DELETE" }
      );
      setCatalog((current) => current.filter(({ id }) => id !== result.tagId));
      onChange(tags.filter((tag) => keywordTagKey(tag) !== keywordTagKey(result.name)));
      onTagDeleted?.(result);
      setDeleteNotice(
        t("Тег «{0}» удалён у {1} запросов", [
          result.name,
          new Intl.NumberFormat(locale).format(result.detachedKeywordCount)
        ])
      );
      setDeleteTarget(undefined);
    } catch (error) {
      setDeleteError(
        error instanceof BrowserApiError
          ? error.message
          : t("Не удалось удалить тег.")
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={`keyword-tag-picker${removing ? " is-removal" : ""}`}>
      <div className="keyword-tag-picker-heading"><label htmlFor={id}><UiText text={label} /></label><span>{tags.length} / 50</span></div>
      <CustomSelect
        id={id}
        aria-label={t(placeholder)}
        aria-describedby={`${hintId} ${statusId}`}
        value=""
        disabled={disabled}
        searchable
        showSelectedCheck={false}
        searchPlaceholder={t(removing ? "Найти тег для снятия" : "Найти или создать тег")}
        placeholder={placeholder}
        onSearchChange={setQuery}
        createOption={createOption}
        onChange={(event) => add(event.target.value)}
        getOptionAction={(optionValue) => {
          const option = optionByKey.get(keywordTagKey(optionValue));
          return !disabled && option?.id
            ? {
                ariaLabel: t("Удалить тег «{0}»", [option.name]),
                icon: <Icon name="trash" />,
                onAction: () => {
                  setDeleteError(undefined);
                  setDeleteTarget(option);
                },
                title: t("Удалить тег")
              }
            : undefined;
        }}
        emptyMessage={tooLong
          ? "Название тега — не больше 160 символов"
          : loading
            ? "Загружаем теги…"
            : removing
              ? "Нет подходящих тегов у выбранных запросов"
              : "Введите название нового тега"}
      >
        {options.map((tag) => {
          const isSelected = selected.has(keywordTagKey(tag.name));
          return (
            <option
              disabled={isSelected}
              key={keywordTagKey(tag.name)}
              value={tag.name}
            >
              <span className="keyword-tag-option">
                <span>{tag.name}</span>
                <small>{new Intl.NumberFormat(locale).format(tag.keywordCount)}</small>
                {isSelected && <em><UiText text="Выбран" /></em>}
              </span>
            </option>
          );
        })}
      </CustomSelect>
      {tags.length > 0 && <ul className="keyword-tag-chips" aria-label={t(removing ? "Теги к снятию" : mode === "add" ? "Теги к добавлению" : "Выбранные теги")}>
        {tags.map(tag => <li className="keyword-tag-chip" key={keywordTagKey(tag)}><span title={tag}>{tag}</span><button type="button" disabled={disabled} title={t(removing ? "Отменить снятие тега" : "Убрать тег")} aria-label={t(removing ? "Отменить снятие «{0}»" : mode === "add" ? "Убрать из добавления «{0}»" : "Снять тег «{0}»", [tag])} onClick={() => onChange(tags.filter(value => keywordTagKey(value) !== keywordTagKey(tag)))}><Icon name="close" /></button></li>)}
      </ul>}
      <p className="keyword-tag-picker-hint" id={hintId}><UiText text={removing ? "С выбранных запросов снимутся только эти теги. Остальные сохранятся." : mode === "add" ? "Добавятся ко всем выбранным запросам. Существующие теги сохранятся." : "Выберите тег из списка или введите новый. Крестик убирает выбранный тег."} /></p>
      <div className="keyword-tag-picker-status" id={statusId} aria-live="polite">
        {tooLong ? <UiText text="Название тега — не больше 160 символов" /> : tags.length >= 50 ? <UiText text="Выбрано 50 тегов" /> : failed ? <><UiText text="Не удалось загрузить теги. Новый тег можно ввести вручную." /><button type="button" disabled={disabled} onClick={() => setRevision(value => value + 1)}><UiText text="Повторить" /></button></> : deleteNotice ? deleteNotice : null}
      </div>
      {deleteTarget?.id && (
        <SemanticModal
          closeDisabled={deleting}
          description="Тег будет снят со всех связанных запросов и удалён из проекта."
          footer={(
            <ConfirmationActions>
              <button className="secondary-button" disabled={deleting} onClick={() => setDeleteTarget(undefined)} type="button"><UiText text="Отмена" /></button>
              <button className="danger-button" disabled={deleting} onClick={() => void deleteTag()} type="button">{deleting ? <UiText text="Удаляем…" /> : <UiText text="Удалить тег" />}</button>
            </ConfirmationActions>
          )}
          onClose={() => setDeleteTarget(undefined)}
          presenceKey="semantic-tag-delete"
          size="small"
          title={t("Удалить тег «{0}»?", [deleteTarget.name])}
        >
          <div className="semantic-filter-delete-confirmation">
            <span className="semantic-filter-delete-confirmation-icon"><Icon name="warning" /></span>
            <div>
              <strong>{new Intl.NumberFormat(locale).format(deleteTarget.keywordCount)} <UiText text="связанных запросов" before=" " /></strong>
              <small><UiText text="История позиций и остальные данные запросов сохранятся." /></small>
            </div>
          </div>
          {deleteError && <p className="inline-alert danger" role="alert">{deleteError}</p>}
        </SemanticModal>
      )}
    </div>
  );
}
