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

  async function requestPreview(page = 1, append = false): Promise<void> {
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
        selections
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
    event: UIEvent<HTMLUListElement>
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
      void requestPreview(preview.page + 1, true);
    }
  }

  async function applyPreview(): Promise<void> {
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
          ? `${formatInteger(deleted)} запросов перемещено в корзину. Действие можно отменить в истории.`
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
              <div><dt>Минус-слов</dt><dd>{formatInteger(words.length)}</dd></div>
            </div>
            <div>
              <Icon name="projects" />
              <div>
                <dt>Область</dt>
                <dd>
                  {scopeKind === "SELECTION"
                    ? `${formatInteger(selections.length)} выбранных`
                    : scopeKind === "GROUP"
                      ? selectedGroupIds.size > 0
                        ? `${formatInteger(selectedGroupIds.size)} папок`
                        : "Папки не выбраны"
                      : "Весь проект"}
                </dd>
              </div>
            </div>
            <div>
              <Icon name="search" />
              <div>
                <dt>К удалению</dt>
                <dd>
                  {preview
                    ? formatInteger(selectedMatchCount)
                    : "Не рассчитано"}
                </dd>
              </div>
            </div>
          </dl>
          <div className="semantic-modal-actions semantic-negative-actions">
            {applying && (
              <span aria-live="polite">
                Перемещено: {formatInteger(deletedProgress)}
              </span>
            )}
            <button
              className="secondary-button"
              disabled={applying}
              onClick={requestClose}
              type="button"
            >
              Отмена
            </button>
            <button
              className="danger-button"
              disabled={
                !preview ||
                selectedMatchCount === 0 ||
                applying ||
                previewing ||
                loadingMore
              }
              onClick={() => void applyPreview()}
              type="button"
            >
              {applying
                ? "Перемещаем…"
                : `В корзину${preview ? ` (${formatInteger(selectedMatchCount)})` : ""}`}
            </button>
          </div>
        </div>
      )}
      onClose={requestClose}
      presenceKey="semantic-modal:negative-keywords"
      size="large"
      title="Минус-слова"
    >
      <div className="semantic-negative-dialog semantic-workflow-dialog">
        <div className="semantic-workflow-grid semantic-negative-workflow-grid">
          <section className="semantic-workflow-panel semantic-negative-editor">
            <header>
              <h3>Набор и правила</h3>
              <p>
                Добавьте до {formatInteger(semanticNegativeKeywordWordLimit)} слов или фраз — по одной на строку.
              </p>
            </header>
            <label>
              <span>Готовый набор или мой пресет</span>
              <CustomSelect
                disabled={loadingPresets || applying}
                onChange={(event) => selectPreset(event.target.value)}
                searchable
                searchPlaceholder="Найти набор"
                value={selectedPresetId}
              >
                <option value="">Новый набор</option>
                <option disabled value="builtin-heading">Готовые наборы · сначала проверьте</option>
                {builtInNegativeKeywordPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {`${preset.name} · ${formatInteger(preset.rules.words.length)}`}
                  </option>
                ))}
                {presets.length > 0 && <option disabled value="project-heading">Мои пресеты проекта</option>}
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </CustomSelect>
              {selectedBuiltInPreset ? (
                <small className="semantic-negative-preset-hint">
                  {selectedBuiltInPreset.description} Это шаблон: проверьте совпадения перед применением.
                </small>
              ) : (
                <small className="semantic-negative-preset-hint">
                  Готовые наборы не применяются автоматически — их можно изменить и сохранить в проект.
                </small>
              )}
            </label>
            <label>
              <span>Минус-слова</span>
              <textarea
                autoFocus
                disabled={applying}
                onChange={(event) => { setWordsText(event.target.value); invalidatePreview(); }}
                placeholder={"купить\nмосква\nбесплатно"}
                rows={7}
                value={wordsText}
              />
              <small>
                {formatInteger(words.length)} из {formatInteger(semanticNegativeKeywordWordLimit)}
              </small>
            </label>
            <div className="semantic-negative-options">
              <label>
                <span>Тип поиска</span>
                <CustomSelect disabled={applying} onChange={(event) => { setMatchMode(event.target.value as SemanticNegativeKeywordMatchMode); invalidatePreview(); }} value={matchMode}>
                  <option value="WORD_FORM_FAST">Независимый от словоформы · быстрый</option>
                  <option value="WORD_FORM_PRECISE">Независимый от словоформы · улучшенный</option>
                  <option value="WHOLE_WORD">Зависимый от словоформы · полное слово</option>
                  <option value="CONTAINS">Зависимый от словоформы · частичное вхождение</option>
                  <option value="EXACT_PHRASE">Зависимый от словоформы · вся фраза целиком</option>
                </CustomSelect>
                <small className="semantic-negative-match-hint">{matchModeHint(matchMode)}</small>
              </label>
            </div>
            <form className="semantic-negative-preset-form" onSubmit={(event) => void savePreset(event)}>
              <label>
                <span>Название пресета</span>
                <input disabled={applying} maxLength={160} onChange={(event) => setPresetName(event.target.value)} placeholder="Например, Города" value={presetName} />
              </label>
              <div className="semantic-negative-preset-actions">
                <button className="secondary-button" disabled={savingPreset || words.length === 0} type="submit">
                  {savingPreset
                    ? "Сохраняем…"
                    : selectedPreset
                      ? "Обновить пресет"
                      : selectedBuiltInPreset
                        ? "Сохранить в проект"
                        : "Сохранить пресет"}
                </button>
                {selectedPreset && <button className="text-button danger-text" disabled={savingPreset} onClick={() => void deletePreset()} type="button"><Icon name="trash" />Удалить</button>}
              </div>
            </form>
          </section>

          <section className="semantic-workflow-panel semantic-negative-scope">
            <header>
              <h3>Область поиска</h3>
              <p>Совпадения считаются только среди активных запросов.</p>
            </header>
            <div className="semantic-negative-scope-cards">
              <ScopeCard checked={scopeKind === "PROJECT"} label="Все запросы проекта" onSelect={() => { setScopeKind("PROJECT"); invalidatePreview(); }} />
              {selections.length > 0 && (
                <ScopeCard checked={scopeKind === "SELECTION"} count={selections.length} label="Выбранные запросы" onSelect={() => { setScopeKind("SELECTION"); invalidatePreview(); }} />
              )}
              {availableGroups.length > 0 && (
                <ScopeCard checked={scopeKind === "GROUP"} count={selectedGroupIds.size} label="Конкретные папки" onSelect={() => { setScopeKind("GROUP"); invalidatePreview(); }} />
              )}
            </div>
            {scopeKind === "GROUP" && (
              <div className="semantic-duplicate-folder-scope semantic-negative-folder-scope">
                <div className="semantic-duplicate-folder-toolbar">
                  <span>Выбрано папок: {formatInteger(selectedGroupIds.size)}</span>
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
                        Только текущая
                      </button>
                    )}
                    <button
                      disabled={applying || selectedGroupIds.size === 0}
                      onClick={() => {
                        setSelectedGroupIds(new Set());
                        invalidatePreview();
                      }}
                      type="button"
                    >
                      Очистить
                    </button>
                  </div>
                </div>
                <div
                  aria-label="Папки для поиска минус-слов"
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
                          aria-label={expandedGroupIds.has(group.id) ? "Свернуть папку" : "Развернуть папку"}
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
                        <b>{formatInteger(group.keywordCount)}</b>
                      </label>
                    </div>
                  ))}
                </div>
                <small>
                  Родительская папка включает все вложенные. Запросы из нескольких выбранных папок проверяются один раз.
                </small>
              </div>
            )}
            <div className="semantic-negative-checkbox-options">
              <h4>Настройки поиска</h4>
              <label className="semantic-toggle-line">
                <input checked={caseSensitive} disabled={applying} onChange={(event) => { setCaseSensitive(event.target.checked); invalidatePreview(); }} type="checkbox" />
                <span><strong>Учитывать регистр</strong><small>«Москва» и «москва» будут разными.</small></span>
              </label>
              <fieldset className="semantic-negative-phrase-options">
                <legend>Стоп-фразы из двух и более слов</legend>
                <label className="semantic-toggle-line">
                  <input checked={ignoreWordOrder} disabled={applying} onChange={(event) => { setIgnoreWordOrder(event.target.checked); invalidatePreview(); }} type="checkbox" />
                  <span><strong>Игнорировать порядок слов</strong><small>«купить ёлку» найдёт и «ёлку купить».</small></span>
                </label>
                <label className="semantic-toggle-line">
                  <input checked={ignorePunctuation} disabled={applying} onChange={(event) => { setIgnorePunctuation(event.target.checked); invalidatePreview(); }} type="checkbox" />
                  <span><strong>Игнорировать знаки и спецсимволы</strong><small>Дефисы, запятые и другие символы считаются разделителями.</small></span>
                </label>
              </fieldset>
            </div>
            <div className="semantic-negative-scope-note">
              <Icon name="warning" />
              <span><strong>Сначала предпросмотр</strong><small>Ни один запрос не попадёт в корзину без отдельного подтверждения.</small></span>
            </div>
          </section>

          <section className="semantic-workflow-panel semantic-negative-preview-panel">
            <header>
              <h3>Предпросмотр</h3>
              <p>Все совпадения отмечены для удаления. Снимите галочку, чтобы оставить запрос.</p>
            </header>
            <div className="semantic-negative-preview">
              <button className="secondary-button semantic-negative-preview-button" disabled={previewing || loadingMore || applying} onClick={() => void requestPreview()} type="button">
                <Icon name="search" />
                {previewing ? "Проверяем…" : preview ? "Пересчитать совпадения" : "Найти совпадения"}
              </button>
              {!preview && !previewing && <div className="semantic-negative-empty"><Icon name="search" /><span>Добавьте слова и запустите проверку.</span></div>}
              {preview && (
                <>
                  <dl>
                    <div><dt>Проверено</dt><dd>{formatInteger(preview.scannedCount)}</dd></div>
                    <div><dt>Найдено</dt><dd>{formatInteger(preview.matchedCount)}</dd></div>
                    <div><dt>К удалению</dt><dd>{formatInteger(selectedMatchCount)}</dd></div>
                  </dl>
                  {previewMatches.length === 0 ? (
                    <div className="inline-alert success">Совпадений нет — перемещать нечего.</div>
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
                                aria-label={`Переместить запрос «${match.text}» в корзину`}
                                checked={selected}
                                disabled={applying}
                                onChange={(event) => toggleDeletion(match.keywordId, event.target.checked)}
                                type="checkbox"
                              />
                              <span className="semantic-negative-match-content">
                                <HighlightedNegativeKeyword match={match} />
                                <small>{selected ? "В корзину" : "Оставить"}</small>
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
                        Показано {formatInteger(previewMatches.length)} из{" "}
                        {formatInteger(preview.matchedCount)}
                      </span>
                      {preview.page < preview.pageCount && (
                        <span>
                          {loadingMore && <span className="spinner" />}
                          {loadingMore
                            ? "Загружаем ещё…"
                            : "Прокрутите список вниз — следующие 100 загрузятся автоматически"}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        {error && <div className="semantic-workflow-feedback"><div className="inline-alert danger" role="alert">{error}</div></div>}
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
  return (
    <label className={checked ? "selected" : undefined}>
      <input checked={checked} onChange={onSelect} type="radio" />
      <span><strong>{label}</strong>{count !== undefined && <small>{formatInteger(count)} шт.</small>}</span>
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
  selections: readonly SemanticKeywordBulkSelection[]
): string {
  if (words.length === 0) return "Добавьте хотя бы одно минус-слово.";
  if (words.length > semanticNegativeKeywordWordLimit) {
    return `В одном наборе может быть не больше ${formatInteger(semanticNegativeKeywordWordLimit)} минус-слов.`;
  }
  if (words.some((word) => word.length > 160)) return "Одно минус-слово не может быть длиннее 160 символов.";
  if (ignorePunctuation && words.some((word) => !/[\p{L}\p{N}]/u.test(word))) {
    return "При игнорировании знаков каждая строка должна содержать хотя бы одну букву или цифру.";
  }
  if (scopeKind === "GROUP" && groupIds.length === 0) return "Выберите хотя бы одну папку для проверки.";
  if (scopeKind === "GROUP" && groupIds.length > semanticNegativeKeywordGroupScopeLimit) {
    return `За один раз можно выбрать не больше ${formatInteger(semanticNegativeKeywordGroupScopeLimit)} папок.`;
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

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}
