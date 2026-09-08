"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { browserApiRequest } from "../lib/browser-api";
import { keywordTagKey, normalizeKeywordTag, uniqueKeywordTags } from "../lib/keyword-tags";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";

export function KeywordTagPicker({ projectId, value, onChange, disabled = false, mode = "edit", availableTags }: {
  projectId: string;
  value: readonly string[];
  onChange: (tags: readonly string[]) => void;
  disabled?: boolean;
  mode?: "edit" | "add" | "remove";
  availableTags?: readonly string[];
}) {
  const id = useId(), hintId = `${id}-hint`, statusId = `${id}-status`;
  const { t } = useUiLocale();
  const [query, setQuery] = useState(""), [options, setOptions] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [revision, setRevision] = useState(0);
  const tags = useMemo(() => uniqueKeywordTags(value), [value]);
  const selected = useMemo(() => new Set(tags.map(keywordTagKey)), [tags]);
  const removing = mode === "remove";
  const label = removing ? "Снять теги" : mode === "add" ? "Добавить теги" : "Теги";
  const placeholder = removing ? "Выбрать теги для снятия" : "Выбрать или добавить тег";
  const normalizedQuery = normalizeKeywordTag(query), tooLong = normalizedQuery.length > 160;
  useEffect(() => {
    if (availableTags) {
      setOptions(uniqueKeywordTags(availableTags).filter(tag => keywordTagKey(tag).includes(keywordTagKey(normalizedQuery))).slice(0, 100));
      setLoading(false); setFailed(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true); setFailed(false); setOptions([]);
    const timer = setTimeout(() => {
      if (tooLong) { setLoading(false); return; }
      const parameters = new URLSearchParams();
      if (normalizedQuery) parameters.set("search", normalizedQuery);
      void browserApiRequest<readonly string[]>(`/app/api/projects/${encodeURIComponent(projectId)}/keywords/tag-options${parameters.size ? `?${parameters}` : ""}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) { if (!Array.isArray(result) || result.some(tag => typeof tag !== "string")) throw new Error("Invalid tags"); setOptions(uniqueKeywordTags(result)); } })
        .catch(() => { if (!controller.signal.aborted) setFailed(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [availableTags, normalizedQuery, projectId, revision, tooLong]);

  const createOption = useCallback((search: string) => {
    const name = normalizeKeywordTag(search), key = keywordTagKey(name);
    if (removing || !name || name.length > 160 || selected.has(key) || options.some(option => keywordTagKey(option) === key) || tags.length >= 50) return undefined;
    return { value: name, label: <UiText text="Добавить «{0}»" values={[name]} /> };
  }, [options, removing, selected, tags.length]);
  function add(value: string) {
    const normalized = normalizeKeywordTag(value);
    if (!normalized || normalized.length > 160 || selected.has(keywordTagKey(normalized)) || tags.length >= 50) return;
    if (removing && !options.some(tag => keywordTagKey(tag) === keywordTagKey(normalized))) return;
    onChange([...tags, normalized]);
  }
  return <div className={`keyword-tag-picker${removing ? " is-removal" : ""}`}>
    <div className="keyword-tag-picker-heading"><label htmlFor={id}><UiText text={label} /></label><span>{tags.length} / 50</span></div>
    <CustomSelect id={id} aria-label={t(placeholder)} aria-describedby={`${hintId} ${statusId}`} value="" disabled={disabled || tags.length >= 50} searchable showSelectedCheck={false} searchPlaceholder={t(removing ? "Найти тег для снятия" : "Найти или создать тег")} placeholder={placeholder} onSearchChange={setQuery} createOption={createOption} onChange={event => add(event.target.value)} emptyMessage={tooLong ? "Название тега — не больше 160 символов" : loading ? "Загружаем теги…" : removing ? "Нет подходящих тегов у выбранных запросов" : "Введите название нового тега"}>
      {options.filter(tag => !selected.has(keywordTagKey(tag))).map(tag => <option key={keywordTagKey(tag)} value={tag}>{tag}</option>)}
    </CustomSelect>
    {tags.length > 0 && <ul className="keyword-tag-chips" aria-label={t(removing ? "Теги к снятию" : mode === "add" ? "Теги к добавлению" : "Выбранные теги")}>
      {tags.map(tag => <li className="keyword-tag-chip" key={keywordTagKey(tag)}><span title={tag}>{tag}</span><button type="button" disabled={disabled} title={t(removing ? "Отменить снятие тега" : "Убрать тег")} aria-label={t(removing ? "Отменить снятие «{0}»" : mode === "add" ? "Убрать из добавления «{0}»" : "Снять тег «{0}»", [tag])} onClick={() => onChange(tags.filter(value => keywordTagKey(value) !== keywordTagKey(tag)))}><Icon name="close" /></button></li>)}
    </ul>}
    <p className="keyword-tag-picker-hint" id={hintId}><UiText text={removing ? "С выбранных запросов снимутся только эти теги. Остальные сохранятся." : mode === "add" ? "Добавятся ко всем выбранным запросам. Существующие теги сохранятся." : "Выберите тег из списка или введите новый. Крестик убирает выбранный тег."} /></p>
    <div className="keyword-tag-picker-status" id={statusId} aria-live="polite">
      {tooLong ? <UiText text="Название тега — не больше 160 символов" /> : tags.length >= 50 ? <UiText text="Выбрано 50 тегов" /> : failed ? <><UiText text="Не удалось загрузить теги. Новый тег можно ввести вручную." /><button type="button" disabled={disabled} onClick={() => setRevision(value => value + 1)}><UiText text="Повторить" /></button></> : null}
    </div>
  </div>;
}
