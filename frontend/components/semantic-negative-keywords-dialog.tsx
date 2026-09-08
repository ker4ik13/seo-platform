"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type UIEvent
} from "react";
import type {
  SemanticKeywordBulkSelection,
  SemanticNegativeKeywordApplyResult,
  SemanticNegativeKeywordCommandInput,
  SemanticNegativeKeywordMatch,
  SemanticNegativeKeywordMatchMode,
  SemanticNegativeKeywordPreset,
  SemanticNegativeKeywordPreview,
  SemanticNegativeKeywordRules,
  SemanticNegativeKeywordScope
} from "@seo-platform/contracts";
import {
  semanticNegativeKeywordGroupScopeLimit,
  semanticNegativeKeywordWordLimit
} from "@seo-platform/contracts";
import {
  expandedAncestorIds,
  treeIdsWithDescendants,
  visibleFolderRows
} from "../lib/semantic-operation-tree";
import { builtInNegativeKeywordPresets } from "../lib/semantic-negative-keyword-presets";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { SemanticModal } from "./semantic-modal";
import { UnsavedChangesConfirmation } from "./unsaved-changes-confirmation";
import type { SemanticOperationGroup } from "./semantic-operation-scope";
import { UiText, useUiLocale } from "./ui-locale";


type ScopeKind = SemanticNegativeKeywordScope["kind"];
const NEGATIVE_PREVIEW_PAGE_SIZE = 100;

export function SemanticNegativeKeywordsDialog({
  activeGroup,
  groups,
  onClose,
  onCompleted,
  projectId,
  selections
}: Readonly<{
  activeGroup?: Readonly<{ id: string; name: string }>;
  groups: readonly SemanticOperationGroup[];
  onClose: () => void;
  onCompleted: (message: string) => void;
  projectId: string;
  selections: readonly Readonly<SemanticKeywordBulkSelection & { label: string }>[];
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const initialScopeKind: ScopeKind = selections.length > 0
    ? "SELECTION"
    : activeGroup
      ? "GROUP"
      : "PROJECT";
  const [presets, setPresets] = useState<readonly SemanticNegativeKeywordPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [wordsText, setWordsText] = useState("");
  const [matchMode, setMatchMode] = useState<SemanticNegativeKeywordMatchMode>("WORD_FORM_PRECISE");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [ignoreWordOrder, setIgnoreWordOrder] = useState(false);
  const [ignorePunctuation, setIgnorePunctuation] = useState(false);
  const [scopeKind, setScopeKind] = useState<ScopeKind>(initialScopeKind);
  const [selectedGroupIds, setSelectedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(activeGroup ? [activeGroup.id] : [])
  );
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<string>>(
    () => expandedAncestorIds(groups, activeGroup ? [activeGroup.id] : [])
  );
  const [preview, setPreview] = useState<SemanticNegativeKeywordPreview>();
  const [previewMatches, setPreviewMatches] = useState<
    readonly SemanticNegativeKeywordMatch[]
  >([]);
  const [excludedKeywordIds, setExcludedKeywordIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [savingPreset, setSavingPreset] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [applying, setApplying] = useState(false);
  const [deletedProgress, setDeletedProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [confirmClose, setConfirmClose] = useState(false);
  const previewRequestInFlight = useRef(false);
  const words = useMemo(() => parseWords(wordsText, caseSensitive), [caseSensitive, wordsText]);
  const endpoint = `/app/api/projects/${encodeURIComponent(projectId)}`;
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => systemKind !== "TRASH"),
    [groups]
  );
  const resolvedGroupIds = useMemo(
    () => treeIdsWithDescendants(availableGroups, selectedGroupIds),
    [availableGroups, selectedGroupIds]
  );
  const visibleGroups = useMemo(
    () => visibleFolderRows(availableGroups, expandedGroupIds),
    [availableGroups, expandedGroupIds]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoadingPresets(true);
    void browserApiRequest<readonly SemanticNegativeKeywordPreset[]>(
      `${endpoint}/negative-keyword-presets`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setPresets(result);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(negativeKeywordError(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPresets(false);
      });
    return () => controller.abort();
  }, [endpoint]);

  function invalidatePreview(): void {
    setPreview(undefined);
    setPreviewMatches([]);
    setExcludedKeywordIds(new Set());
    setDeletedProgress(0);
    setError(undefined);
  }

  function toggleGroup(groupId: string): void {
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
    invalidatePreview();
  }

  function toggleExpanded(groupId: string): void {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function selectPreset(presetId: string): void {
    setSelectedPresetId(presetId);
    const preset = presets.find(({ id }) => id === presetId) ??
      builtInNegativeKeywordPresets.find(({ id }) => id === presetId);
    if (preset) {
      setPresetName(preset.name);
      setWordsText(preset.rules.words.join("\n"));
      setMatchMode(preset.rules.matchMode);
      setCaseSensitive(preset.rules.caseSensitive);
      setIgnoreWordOrder(preset.rules.ignoreWordOrder);
      setIgnorePunctuation(preset.rules.ignorePunctuation);
    } else {
      setPresetName("");
    }
    invalidatePreview();
  }

  async function savePreset(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (savingPreset || applying) return;
    const rules = validRules(
      words,
      matchMode,
      caseSensitive,
      ignoreWordOrder,
      ignorePunctuation
    );
    if (!rules || !presetName.trim()) {
      setError("Укажите название пресета и хотя бы одно минус-слово.");
      return;
    }
    setSavingPreset(true);
    setError(undefined);
    try {
      const current = presets.find(({ id }) => id === selectedPresetId);
      const saved = await browserApiRequest<SemanticNegativeKeywordPreset>(
        current
          ? `${endpoint}/negative-keyword-presets/${encodeURIComponent(current.id)}`
          : `${endpoint}/negative-keyword-presets`,
        {
          method: current ? "PATCH" : "POST",
          body: { name: presetName.trim(), rules },
          ...(current ? { ifMatch: current.version } : {})
        }
      );
      setPresets((items) => [...items.filter(({ id }) => id !== saved.id), saved]
        .sort((left, right) => left.name.localeCompare(right.name, "ru")));
      setSelectedPresetId(saved.id);
      setPresetName(saved.name);
    } catch (requestError) {
      setError(negativeKeywordError(requestError));
    } finally {
      setSavingPreset(false);
    }
  }

  async function deletePreset(): Promise<void> {
    const current = presets.find(({ id }) => id === selectedPresetId);
    if (!current || savingPreset || applying) return;
    if (!window.confirm(`Удалить пресет «${current.name}»? Запросы проекта не изменятся.`)) return;
    setSavingPreset(true);
    setError(undefined);
    try {
      await browserApiRequest<void>(
        `${endpoint}/negative-keyword-presets/${encodeURIComponent(current.id)}`,
        { method: "DELETE", ifMatch: current.version }
      );
      setPresets((items) => items.filter(({ id }) => id !== current.id));
      setSelectedPresetId("");
      setPresetName("");
    } catch (requestError) {
      setError(negativeKeywordError(requestError));
    } finally {
      setSavingPreset(false);
    }
  }

  async function requestPreview(page = 1, append = false, uiLocale: string = "ru-RU"): Promise<void> {
    if (previewRequestInFlight.current || applying) return;
    const command = commandInput(
      words,
      matchMode,
      caseSensitive,
      ignoreWordOrder,
      ignorePunctuation,
      scopeKind,
      resolvedGroupIds,
      selections
    );
    if (!command) {
      setError(commandValidationMessage(
        words,
        ignorePunctuation,
        scopeKind,
        resolvedGroupIds,
        selections, uiLocale
      ));
      return;
    }
    previewRequestInFlight.current = true;
    if (append) setLoadingMore(true);
    else setPreviewing(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<SemanticNegativeKeywordPreview>(
        `${endpoint}/negative-keywords/preview`,
        {
          method: "POST",
          body: { ...command, page, pageSize: NEGATIVE_PREVIEW_PAGE_SIZE }
        }
      );
      if (append && preview && result.previewHash !== preview.previewHash) {
        setPreview(undefined);
        setPreviewMatches([]);
        setExcludedKeywordIds(new Set());
        setError(
          "Запросы изменились во время просмотра. Пересчитайте совпадения."
        );
        return;
      }
      setPreview(result);
      if (!append) setExcludedKeywordIds(new Set());
      setPreviewMatches((current) =>
        append
          ? appendUniqueNegativeMatches(current, result.matches)
          : result.matches
      );
    } catch (requestError) {
      setError(negativeKeywordError(requestError));
    } finally {
      previewRequestInFlight.current = false;
      if (append) setLoadingMore(false);
      else setPreviewing(false);
    }
  }

  function loadNextPreviewPage(
    event: UIEvent<HTMLUListElement>, uiLocale: string = "ru-RU"
  ): void {
    if (
      !preview ||
      preview.page >= preview.pageCount ||
      previewing ||
      loadingMore ||
      applying
    ) {
      return;
    }
    const list = event.currentTarget;
    const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (remaining <= 160) {
      void requestPreview(preview.page + 1, true, uiLocale);
    }
  }

  async function applyPreview(uiLocale: string = "ru-RU"): Promise<void> {
    const initialCommand = commandInput(
      words,
      matchMode,
      caseSensitive,
      ignoreWordOrder,
      ignorePunctuation,
      scopeKind,
      resolvedGroupIds,
      selections
    );
    if (!initialCommand || !preview || applying || loadingMore) return;
    setApplying(true);
    setDeletedProgress(0);
    setError(undefined);
    try {
      let command = initialCommand;
      let currentPreview = preview;
      let deleted = 0;
      const exclusions = [...excludedKeywordIds].sort();
      for (let batch = 0; batch < 100 && currentPreview.batchCount > 0; batch += 1) {
        const result = await browserApiRequest<SemanticNegativeKeywordApplyResult>(
          `${endpoint}/negative-keywords/apply`,
          {
            method: "POST",
            body: {
              ...command,
              previewHash: currentPreview.previewHash,
              ...(exclusions.length > 0
                ? { excludedKeywordIds: exclusions }
                : {})
            }
          }
        );
        deleted += result.deletedCount;
        setDeletedProgress(deleted);
        if (!result.hasMore) break;
        command = commandWithoutDeletedSelection(
          command,
          result.deletedKeywordIds
        );
        currentPreview = await browserApiRequest<SemanticNegativeKeywordPreview>(
          `${endpoint}/negative-keywords/preview`,
          {
            method: "POST",
            body: {
              ...command,
              page: 1,
              pageSize: NEGATIVE_PREVIEW_PAGE_SIZE
            }
          }
        );
      }
      onCompleted(
        deleted > 0
          ? `${formatInteger(deleted, uiLocale)} запросов перемещено в корзину. Действие можно отменить в истории.`
          : "Совпадений для удаления больше нет."
      );
    } catch (requestError) {
      setError(negativeKeywordError(requestError));
      setPreview(undefined);
      setPreviewMatches([]);
      setExcludedKeywordIds(new Set());
    } finally {
      setApplying(false);
    }
  }

  function toggleDeletion(keywordId: string, selected: boolean): void {
    setExcludedKeywordIds((current) => {
      const next = new Set(current);
      if (selected) next.delete(keywordId);
      else next.add(keywordId);
      return next;
    });
  }

  const selectedPreset = presets.find(({ id }) => id === selectedPresetId);
  const selectedBuiltInPreset = builtInNegativeKeywordPresets.find(
    ({ id }) => id === selectedPresetId
  );
  const selectedMatchCount = preview
    ? Math.max(0, preview.matchedCount - excludedKeywordIds.size)
    : 0;
  const rulesDirty = selectedPreset
    ? presetName.trim() !== selectedPreset.name ||
      words.join("\n") !== selectedPreset.rules.words.join("\n") ||
      matchMode !== selectedPreset.rules.matchMode ||
      caseSensitive !== selectedPreset.rules.caseSensitive ||
      ignoreWordOrder !== selectedPreset.rules.ignoreWordOrder ||
      ignorePunctuation !== selectedPreset.rules.ignorePunctuation
    : presetName.trim().length > 0 ||
      words.length > 0 ||
      matchMode !== "WORD_FORM_PRECISE" ||
      caseSensitive ||
      ignoreWordOrder ||
      ignorePunctuation;
  const dirty =
    rulesDirty ||
    scopeKind !== initialScopeKind ||
    !sameStringSet(
      selectedGroupIds,
      new Set(activeGroup ? [activeGroup.id] : [])
    ) ||
    Boolean(preview) ||
    excludedKeywordIds.size > 0;

  function requestClose(): void {
    if (applying) return;
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  return (
    <>
    <SemanticModal
      footer={(
        <div className="semantic-workflow-footer">
          <dl className="semantic-dialog-estimate semantic-workflow-footer-estimate semantic-negative-estimate">
            <div>
              <Icon name="semantic" />
              <div><dt><UiText text="Минус-слов" /></dt><dd>{formatInteger(words.length, uiLocale)}</dd></div>
            </div>
            <div>
              <Icon name="projects" />
              <div>
                <dt><UiText text="Область" /></dt>
                <dd>
                  {scopeKind === "SELECTION"
                    ? <UiText text="{0} выбранных" values={[String(formatInteger(selections.length, uiLocale))]} />
                    : scopeKind === "GROUP"
                      ? selectedGroupIds.size > 0
                        ? <UiText text="{0} папок" values={[String(formatInteger(selectedGroupIds.size, uiLocale))]} />
                        : <UiText text="Папки не выбраны" />
                      : <UiText text="Весь проект" />}
                </dd>
              </div>
            </div>
            <div>
              <Icon name="search" />
              <div>
                <dt><UiText text="К удалению" /></dt>
                <dd>
                  {preview
                    ? formatInteger(selectedMatchCount, uiLocale)
                    : <UiText text="Не рассчитано" />}
                </dd>
              </div>
            </div>
          </dl>
          <div className="semantic-modal-actions semantic-negative-actions">
            {applying && (
              <span aria-live="polite">
                <UiText text="Перемещено:" after=" " />{formatInteger(deletedProgress, uiLocale)}
              </span>
            )}
            <button
              className="secondary-button"
              disabled={applying}
              onClick={requestClose}
              type="button"
            >
              <UiText text="Отмена" /></button>
            <button
              className="danger-button"
              disabled={
                !preview ||
                selectedMatchCount === 0 ||
                applying ||
                previewing ||
                loadingMore
              }
              onClick={() => void applyPreview(uiLocale)}
              type="button"
            >
              {applying
                ? <UiText text="Перемещаем…" />
                : <UiText text="В корзину{0}" values={[String(preview ? ` (${formatInteger(selectedMatchCount, uiLocale)})` : "")]} />}
            </button>
          </div>
        </div>
      )}
      onClose={requestClose}
      presenceKey="semantic-modal:negative-keywords"
      size="large"
      title={uiText("Минус-слова")}
    >
      <div className="semantic-negative-dialog semantic-workflow-dialog">
        <div className="semantic-workflow-grid semantic-negative-workflow-grid">
          <section className="semantic-workflow-panel semantic-negative-editor">
            <header>
              <h3><UiText text="Набор и правила" /></h3>
              <p>
                <UiText text="Добавьте до" after=" " />{formatInteger(semanticNegativeKeywordWordLimit, uiLocale)} <UiText text="слов или фраз — по одной на строку." before=" " /></p>
            </header>
            <label>
              <span><UiText text="Готовый набор или мой пресет" /></span>
              <CustomSelect
                disabled={loadingPresets || applying}
                onChange={(event) => selectPreset(event.target.value)}
                searchable
                searchPlaceholder={uiText("Найти набор")}
                value={selectedPresetId}
              >
                <option value=""><UiText text="Новый набор" /></option>
                <option disabled value="builtin-heading"><UiText text="Готовые наборы · сначала проверьте" /></option>
                {builtInNegativeKeywordPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {`${preset.name} · ${formatInteger(preset.rules.words.length, uiLocale)}`}
                  </option>
                ))}
                {presets.length > 0 && <option disabled value="project-heading"><UiText text="Мои пресеты проекта" /></option>}
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </CustomSelect>
              {selectedBuiltInPreset ? (
                <small className="semantic-negative-preset-hint">
                  {selectedBuiltInPreset.description} <UiText text="Это шаблон: проверьте совпадения перед применением." before=" " /></small>
              ) : (
                <small className="semantic-negative-preset-hint">
                  <UiText text="Готовые наборы не применяются автоматически — их можно изменить и сохранить в проект." /></small>
              )}
            </label>
            <label>
              <span><UiText text="Минус-слова" /></span>
              <textarea
                autoFocus
                disabled={applying}
                onChange={(event) => { setWordsText(event.target.value); invalidatePreview(); }}
                placeholder={uiText("купить москва бесплатно")}
                rows={7}
                value={wordsText}
              />
              <small>
                {formatInteger(words.length, uiLocale)} <UiText text="из" before=" " after=" " />{formatInteger(semanticNegativeKeywordWordLimit, uiLocale)}
              </small>
            </label>
            <div className="semantic-negative-options">
              <label>
                <span><UiText text="Тип поиска" /></span>
                <CustomSelect disabled={applying} onChange={(event) => { setMatchMode(event.target.value as SemanticNegativeKeywordMatchMode); invalidatePreview(); }} value={matchMode}>
                  <option value="WORD_FORM_FAST"><UiText text="Независимый от словоформы · быстрый" /></option>
                  <option value="WORD_FORM_PRECISE"><UiText text="Независимый от словоформы · улучшенный" /></option>
                  <option value="WHOLE_WORD"><UiText text="Зависимый от словоформы · полное слово" /></option>
                  <option value="CONTAINS"><UiText text="Зависимый от словоформы · частичное вхождение" /></option>
                  <option value="EXACT_PHRASE"><UiText text="Зависимый от словоформы · вся фраза целиком" /></option>
                </CustomSelect>
                <small className="semantic-negative-match-hint">{matchModeHint(matchMode)}</small>
              </label>
            </div>
            <form className="semantic-negative-preset-form" onSubmit={(event) => void savePreset(event)}>
              <label>
                <span><UiText text="Название пресета" /></span>
                <input disabled={applying} maxLength={160} onChange={(event) => setPresetName(event.target.value)} placeholder={uiText("Например, Города")} value={presetName} />
              </label>
              <div className="semantic-negative-preset-actions">
                <button className="secondary-button" disabled={savingPreset || words.length === 0} type="submit">
                  {savingPreset
                    ? <UiText text="Сохраняем…" />
                    : selectedPreset
                      ? <UiText text="Обновить пресет" />
                      : selectedBuiltInPreset
                        ? <UiText text="Сохранить в проект" />
                        : <UiText text="Сохранить пресет" />}
                </button>
                {selectedPreset && <button className="text-button danger-text" disabled={savingPreset} onClick={() => void deletePreset()} type="button"><Icon name="trash" /><UiText text="Удалить" /></button>}
              </div>
            </form>
          </section>

          <section className="semantic-workflow-panel semantic-negative-scope">
            <header>
              <h3><UiText text="Область поиска" /></h3>
              <p><UiText text="Совпадения считаются только среди активных запросов." /></p>
            </header>
            <div className="semantic-negative-scope-cards">
              <ScopeCard checked={scopeKind === "PROJECT"} label={uiText("Все запросы проекта")} onSelect={() => { setScopeKind("PROJECT"); invalidatePreview(); }} />
              {selections.length > 0 && (
                <ScopeCard checked={scopeKind === "SELECTION"} count={selections.length} label={uiText("Выбранные запросы")} onSelect={() => { setScopeKind("SELECTION"); invalidatePreview(); }} />
              )}
              {availableGroups.length > 0 && (
                <ScopeCard checked={scopeKind === "GROUP"} count={selectedGroupIds.size} label={uiText("Конкретные папки")} onSelect={() => { setScopeKind("GROUP"); invalidatePreview(); }} />
              )}
            </div>
            {scopeKind === "GROUP" && (
              <div className="semantic-duplicate-folder-scope semantic-negative-folder-scope">
                <div className="semantic-duplicate-folder-toolbar">
                  <span><UiText text="Выбрано папок:" after=" " />{formatInteger(selectedGroupIds.size, uiLocale)}</span>
                  <div>
                    {activeGroup && (
                      <button
                        disabled={applying}
                        onClick={() => {
                          setSelectedGroupIds(new Set([activeGroup.id]));
                          setExpandedGroupIds(expandedAncestorIds(groups, [activeGroup.id]));
                          invalidatePreview();
                        }}
                        type="button"
                      >
                        <UiText text="Только текущая" /></button>
                    )}
                    <button
                      disabled={applying || selectedGroupIds.size === 0}
                      onClick={() => {
                        setSelectedGroupIds(new Set());
                        invalidatePreview();
                      }}
                      type="button"
                    >
                      <UiText text="Очистить" /></button>
                  </div>
                </div>
                <div
                  aria-label={uiText("Папки для поиска минус-слов")}
                  className="semantic-operation-folder-list semantic-duplicate-folder-list"
                >
                  {visibleGroups.map(({ group, depth, hasChildren }) => (
                    <div
                      className="semantic-operation-folder-row"
                      key={group.id}
                      style={{ "--folder-depth": depth } as CSSProperties}
                      title={group.path}
                    >
                      {hasChildren ? (
                        <button
                          aria-expanded={expandedGroupIds.has(group.id)}
                          aria-label={expandedGroupIds.has(group.id) ? uiText("Свернуть папку") : uiText("Развернуть папку")}
                          className="semantic-operation-folder-toggle"
                          disabled={applying}
                          onClick={() => toggleExpanded(group.id)}
                          type="button"
                        >
                          <Icon name="chevronRight" />
                        </button>
                      ) : (
                        <span className="semantic-operation-folder-toggle-spacer" />
                      )}
                      <label>
                        <input
                          checked={selectedGroupIds.has(group.id)}
                          disabled={applying}
                          onChange={() => toggleGroup(group.id)}
                          type="checkbox"
                        />
                        <i
                          aria-hidden="true"
                          className="semantic-operation-folder-color"
                          style={{ background: group.color ?? "#a8a5b8" }}
                        />
                        <span>{group.name}</span>
                        <b>{formatInteger(group.keywordCount, uiLocale)}</b>
                      </label>
                    </div>
                  ))}
                </div>
                <small>
                  <UiText text="Родительская папка включает все вложенные. Запросы из нескольких выбранных папок проверяются один раз." /></small>
              </div>
            )}
            <div className="semantic-negative-checkbox-options">
              <h4><UiText text="Настройки поиска" /></h4>
              <label className="semantic-toggle-line">
                <input checked={caseSensitive} disabled={applying} onChange={(event) => { setCaseSensitive(event.target.checked); invalidatePreview(); }} type="checkbox" />
                <span><strong><UiText text="Учитывать регистр" /></strong><small><UiText text="«Москва» и «москва» будут разными." /></small></span>
              </label>
              <fieldset className="semantic-negative-phrase-options">
                <legend><UiText text="Стоп-фразы из двух и более слов" /></legend>
                <label className="semantic-toggle-line">
                  <input checked={ignoreWordOrder} disabled={applying} onChange={(event) => { setIgnoreWordOrder(event.target.checked); invalidatePreview(); }} type="checkbox" />
                  <span><strong><UiText text="Игнорировать порядок слов" /></strong><small><UiText text="«купить ёлку» найдёт и «ёлку купить»." /></small></span>
                </label>
                <label className="semantic-toggle-line">
                  <input checked={ignorePunctuation} disabled={applying} onChange={(event) => { setIgnorePunctuation(event.target.checked); invalidatePreview(); }} type="checkbox" />
                  <span><strong><UiText text="Игнорировать знаки и спецсимволы" /></strong><small><UiText text="Дефисы, запятые и другие символы считаются разделителями." /></small></span>
                </label>
              </fieldset>
            </div>
            <div className="semantic-negative-scope-note">
              <Icon name="warning" />
              <span><strong><UiText text="Сначала предпросмотр" /></strong><small><UiText text="Ни один запрос не попадёт в корзину без отдельного подтверждения." /></small></span>
            </div>
          </section>

          <section className="semantic-workflow-panel semantic-negative-preview-panel">
            <header>
              <h3><UiText text="Предпросмотр" /></h3>
              <p><UiText text="Все совпадения отмечены для удаления. Снимите галочку, чтобы оставить запрос." /></p>
            </header>
            <div className="semantic-negative-preview">
              <button className="secondary-button semantic-negative-preview-button" disabled={previewing || loadingMore || applying} onClick={() => void requestPreview(undefined, undefined, uiLocale)} type="button">
                <Icon name="search" />
                {previewing ? <UiText text="Проверяем…" /> : preview ? <UiText text="Пересчитать совпадения" /> : <UiText text="Найти совпадения" />}
              </button>
              {!preview && !previewing && <div className="semantic-negative-empty"><Icon name="search" /><span><UiText text="Добавьте слова и запустите проверку." /></span></div>}
              {preview && (
                <>
                  <dl>
                    <div><dt><UiText text="Проверено" /></dt><dd>{formatInteger(preview.scannedCount, uiLocale)}</dd></div>
                    <div><dt><UiText text="Найдено" /></dt><dd>{formatInteger(preview.matchedCount, uiLocale)}</dd></div>
                    <div><dt><UiText text="К удалению" /></dt><dd>{formatInteger(selectedMatchCount, uiLocale)}</dd></div>
                  </dl>
                  {previewMatches.length === 0 ? (
                    <div className="inline-alert success"><UiText text="Совпадений нет — перемещать нечего." /></div>
                  ) : (
                    <ul
                      aria-busy={loadingMore}
                      onScroll={loadNextPreviewPage}
                    >
                      {previewMatches.map((match) => {
                        const selected = !excludedKeywordIds.has(match.keywordId);
                        return (
                          <li className={selected ? "selected" : "kept"} key={match.keywordId}>
                            <label className="semantic-negative-match-row">
                              <input
                                aria-label={uiText("Переместить запрос «{0}» в корзину", [String(match.text)])}
                                checked={selected}
                                disabled={applying}
                                onChange={(event) => toggleDeletion(match.keywordId, event.target.checked)}
                                type="checkbox"
                              />
                              <span className="semantic-negative-match-content">
                                <HighlightedNegativeKeyword match={match} />
                                <small>{selected ? <UiText text="В корзину" /> : <UiText text="Оставить" />}</small>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {preview.matchedCount > 0 && (
                    <div
                      aria-live="polite"
                      className="semantic-negative-scroll-status"
                    >
                      <span>
                        <UiText text="Показано" after=" " />{formatInteger(previewMatches.length, uiLocale)} <UiText text="из" before=" " />{" "}
                        {formatInteger(preview.matchedCount, uiLocale)}
                      </span>
                      {preview.page < preview.pageCount && (
                        <span>
                          {loadingMore && <span className="spinner" />}
                          {loadingMore
                            ? <UiText text="Загружаем ещё…" />
                            : <UiText text="Прокрутите список вниз — следующие 100 загрузятся автоматически" />}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        {error && <div className="semantic-workflow-feedback"><div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div></div>}
      </div>
    </SemanticModal>
    {confirmClose && (
      <UnsavedChangesConfirmation
        onCancel={() => setConfirmClose(false)}
        onConfirm={onClose}
      />
    )}
    </>
  );
}

function ScopeCard({
  checked,
  count,
  label,
  onSelect
}: Readonly<{ checked: boolean; count?: number; label: string; onSelect: () => void }>) {
  const uiLocale = useUiLocale().locale;
  return (
    <label className={checked ? "selected" : undefined}>
      <input checked={checked} onChange={onSelect} type="radio" />
      <span><strong>{label}</strong>{count !== undefined && <small>{formatInteger(count, uiLocale)} <UiText text="шт." before=" " /></small>}</span>
    </label>
  );
}

function commandInput(
  words: readonly string[],
  matchMode: SemanticNegativeKeywordMatchMode,
  caseSensitive: boolean,
  ignoreWordOrder: boolean,
  ignorePunctuation: boolean,
  scopeKind: ScopeKind,
  groupIds: readonly string[],
  selections: readonly Readonly<SemanticKeywordBulkSelection & { label: string }>[]
): SemanticNegativeKeywordCommandInput | undefined {
  const rules = validRules(
    words,
    matchMode,
    caseSensitive,
    ignoreWordOrder,
    ignorePunctuation
  );
  if (!rules) return undefined;
  const scope = commandScope(scopeKind, groupIds, selections);
  return scope ? { rules, scope } : undefined;
}

function validRules(
  words: readonly string[],
  matchMode: SemanticNegativeKeywordMatchMode,
  caseSensitive: boolean,
  ignoreWordOrder: boolean,
  ignorePunctuation: boolean
): SemanticNegativeKeywordRules | undefined {
  return words.length > 0 &&
    words.length <= semanticNegativeKeywordWordLimit &&
    words.every((word) => word.length <= 160) &&
    (!ignorePunctuation || words.every((word) => /[\p{L}\p{N}]/u.test(word)))
    ? { words, matchMode, caseSensitive, ignoreWordOrder, ignorePunctuation }
    : undefined;
}

function matchModeHint(mode: SemanticNegativeKeywordMatchMode): string {
  if (mode === "WORD_FORM_FAST") {
    return "Быстро сопоставляет основные русские окончания — подходит для больших ядер.";
  }
  if (mode === "WORD_FORM_PRECISE") {
    return "Использует расширенное морфологическое сопоставление русских слов.";
  }
  if (mode === "CONTAINS") return "Ищет совпадение даже внутри другого слова.";
  if (mode === "EXACT_PHRASE") return "Запрос должен полностью совпасть со стоп-фразой.";
  return "Ищет целое слово или последовательность слов без изменения словоформы.";
}

function commandScope(
  kind: ScopeKind,
  groupIds: readonly string[],
  selections: readonly SemanticKeywordBulkSelection[]
): SemanticNegativeKeywordScope | undefined {
  if (kind === "PROJECT") return { kind };
  if (kind === "GROUP") {
    return groupIds.length > 0 &&
      groupIds.length <= semanticNegativeKeywordGroupScopeLimit
      ? { kind, groupIds }
      : undefined;
  }
  return selections.length > 0
    ? { kind, items: selections.map(({ id, version }) => ({ id, version })) }
    : undefined;
}

function HighlightedNegativeKeyword({
  match
}: Readonly<{ match: SemanticNegativeKeywordMatch }>) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const [index, range] of match.highlightRanges.entries()) {
    if (range.start > offset) {
      parts.push(match.text.slice(offset, range.start));
    }
    parts.push(
      <mark key={`${range.start}:${range.end}:${index}`}>
        {match.text.slice(range.start, range.end)}
      </mark>
    );
    offset = range.end;
  }
  if (offset < match.text.length) parts.push(match.text.slice(offset));
  return <span className="semantic-negative-keyword-text">{parts}</span>;
}

function appendUniqueNegativeMatches(
  current: readonly SemanticNegativeKeywordMatch[],
  next: readonly SemanticNegativeKeywordMatch[]
): readonly SemanticNegativeKeywordMatch[] {
  const knownIds = new Set(current.map(({ keywordId }) => keywordId));
  return [
    ...current,
    ...next.filter(({ keywordId }) => !knownIds.has(keywordId))
  ];
}

function commandWithoutDeletedSelection(
  command: SemanticNegativeKeywordCommandInput,
  deletedKeywordIds: readonly string[]
): SemanticNegativeKeywordCommandInput {
  if (command.scope.kind !== "SELECTION") return command;
  const deletedIds = new Set(deletedKeywordIds);
  return {
    ...command,
    scope: {
      kind: "SELECTION",
      items: (command.scope.items ?? []).filter(({ id }) => !deletedIds.has(id))
    }
  };
}

function parseWords(value: string, caseSensitive: boolean): readonly string[] {
  const unique = new Map<string, string>();
  for (const raw of value.split(/\r?\n/u)) {
    const normalized = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!normalized) continue;
    const canonical = caseSensitive ? normalized : normalized.toLocaleLowerCase("ru-RU");
    if (!unique.has(canonical)) unique.set(canonical, normalized);
  }
  return [...unique.values()];
}

function commandValidationMessage(
  words: readonly string[],
  ignorePunctuation: boolean,
  scopeKind: ScopeKind,
  groupIds: readonly string[],
  selections: readonly SemanticKeywordBulkSelection[], uiLocale: string = "ru-RU"
): string {
  if (words.length === 0) return "Добавьте хотя бы одно минус-слово.";
  if (words.length > semanticNegativeKeywordWordLimit) {
    return `В одном наборе может быть не больше ${formatInteger(semanticNegativeKeywordWordLimit, uiLocale)} минус-слов.`;
  }
  if (words.some((word) => word.length > 160)) return "Одно минус-слово не может быть длиннее 160 символов.";
  if (ignorePunctuation && words.some((word) => !/[\p{L}\p{N}]/u.test(word))) {
    return "При игнорировании знаков каждая строка должна содержать хотя бы одну букву или цифру.";
  }
  if (scopeKind === "GROUP" && groupIds.length === 0) return "Выберите хотя бы одну папку для проверки.";
  if (scopeKind === "GROUP" && groupIds.length > semanticNegativeKeywordGroupScopeLimit) {
    return `За один раз можно выбрать не больше ${formatInteger(semanticNegativeKeywordGroupScopeLimit, uiLocale)} папок.`;
  }
  if (scopeKind === "SELECTION" && selections.length === 0) return "Выберите хотя бы один запрос.";
  return "Проверьте параметры минус-слов.";
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function negativeKeywordError(error: unknown): string {
  if (!(error instanceof BrowserApiError)) return "Не удалось выполнить операцию с минус-словами.";
  if (error.code === "RESOURCE_STATE_CONFLICT" || error.code === "VERSION_CONFLICT") {
    return "Запросы или пресет изменились после предпросмотра. Пересчитайте совпадения.";
  }
  if (error.code === "DUPLICATE") return "Пресет с таким названием уже существует.";
  if (error.code === "SCOPE_TOO_LARGE") return "В выбранной области больше 50 000 запросов. Выберите отдельную папку.";
  if (error.code === "FORBIDDEN") return "Недостаточно прав для изменения семантики.";
  if (error.code === "VALIDATION_FAILED") return error.fieldErrors[0]?.message ?? "Проверьте параметры.";
  return error.message;
}

function formatInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}
