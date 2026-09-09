"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent
} from "react";
import {
  semanticDuplicateGroupScopeLimit,
  type SemanticDuplicateAnalysisMode,
  type SemanticDuplicateApplyResult,
  type SemanticDuplicateCommandInput,
  type SemanticDuplicateGroupDecision,
  type SemanticDuplicateKeeperStrategy,
  type SemanticDuplicatePreview,
  type SemanticDuplicateScope,
  type SemanticKeywordBulkSelection
} from "@seo-platform/contracts";
import {
  expandedAncestorIds,
  treeIdsWithDescendants,
  visibleFolderRows
} from "../lib/semantic-operation-tree";
import type {
  SemanticOperationGroup
} from "./semantic-operation-scope";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticModal } from "./semantic-modal";
import { UnsavedChangesConfirmation } from "./unsaved-changes-confirmation";
import { useUiLocale, UiText } from "./ui-locale";


type ScopeKind = SemanticDuplicateScope["kind"];
const DUPLICATE_PREVIEW_PAGE_SIZE = 100;
const DUPLICATE_APPLY_BATCH_SIZE = 500;
type DuplicateChoices = Readonly<
  Record<string, Readonly<{ enabled: boolean; keeperKeywordId: string }>>
>;

export function SemanticDuplicatesDialog({
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
  selections: readonly Readonly<
    SemanticKeywordBulkSelection & { label: string }
  >[];
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const initialScopeKind: ScopeKind = selections.length > 0
    ? "SELECTION"
    : activeGroup
      ? "GROUP"
      : "PROJECT";
  const [analysisMode, setAnalysisMode] =
    useState<SemanticDuplicateAnalysisMode>("WORD_FORM_PRECISE");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [ignorePunctuation, setIgnorePunctuation] = useState(true);
  const [ignoredWordsText, setIgnoredWordsText] = useState("");
  const [keeperStrategy, setKeeperStrategy] =
    useState<SemanticDuplicateKeeperStrategy>("HIGHEST_FREQUENCY");
  const [scopeKind, setScopeKind] = useState<ScopeKind>(initialScopeKind);
  const [selectedGroupIds, setSelectedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(activeGroup ? [activeGroup.id] : [])
  );
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<string>>(
    () => expandedAncestorIds(groups, activeGroup ? [activeGroup.id] : [])
  );
  const [preview, setPreview] = useState<SemanticDuplicatePreview>();
  const [choices, setChoices] = useState<DuplicateChoices>({});
  const [previewing, setPreviewing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [applying, setApplying] = useState(false);
  const [deletedProgress, setDeletedProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [confirmClose, setConfirmClose] = useState(false);
  const previewRequestInFlight = useRef(false);
  const previewGeneration = useRef(0);
  const ignoredWords = useMemo(
    () => parseIgnoredWords(ignoredWordsText, caseSensitive),
    [caseSensitive, ignoredWordsText]
  );
  const endpoint = `/app/api/projects/${encodeURIComponent(projectId)}/semantic-duplicates`;
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
  const decisionSummary = useMemo(
    () => duplicateDecisionSummary(preview, choices),
    [choices, preview]
  );
  const scopeSummary = duplicateScopeSummary(
    scopeKind,
    selectedGroupIds.size,
    selections.length, uiLocale
  );
  const dirty =
    analysisMode !== "WORD_FORM_PRECISE" ||
    caseSensitive ||
    !ignorePunctuation ||
    ignoredWordsText.trim().length > 0 ||
    keeperStrategy !== "HIGHEST_FREQUENCY" ||
    scopeKind !== initialScopeKind ||
    !sameStringSet(
      selectedGroupIds,
      new Set(activeGroup ? [activeGroup.id] : [])
    ) ||
    Boolean(preview);

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

  function requestClose(): void {
    if (applying) return;
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  function invalidatePreview(): void {
    previewGeneration.current += 1;
    setPreview(undefined);
    setChoices({});
    setDeletedProgress(0);
    setError(undefined);
  }

  async function requestPreview(page = 1, append = false, uiLocale: string = "ru-RU"): Promise<void> {
    if (previewRequestInFlight.current || applying) return;
    const command = duplicateCommand(
      analysisMode,
      caseSensitive,
      ignorePunctuation,
      ignoredWords,
      scopeKind,
      resolvedGroupIds,
      selections,
      keeperStrategy
    );
    if (!command) {
      setError(duplicateValidationMessage(
        ignoredWords,
        scopeKind,
        resolvedGroupIds,
        selections, uiLocale
      ));
      return;
    }
    const generation = previewGeneration.current;
    previewRequestInFlight.current = true;
    if (append) setLoadingMore(true);
    else setPreviewing(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<SemanticDuplicatePreview>(
        `${endpoint}/preview`,
        {
          method: "POST",
          body: {
            ...command,
            page,
            pageSize: DUPLICATE_PREVIEW_PAGE_SIZE
          }
        }
      );
      if (generation !== previewGeneration.current) return;
      if (append && preview && result.previewHash !== preview.previewHash) {
        setPreview(undefined);
        setChoices({});
        setError(
          "Запросы изменились во время просмотра. Пересчитайте дубли."
        );
        return;
      }
      setPreview((current) =>
        append && current
          ? appendDuplicatePreviewGroups(current, result)
          : result
      );
      setChoices((current) =>
        append
          ? appendDuplicateChoices(current, result.groups)
          : defaultDuplicateChoices(result)
      );
    } catch (requestError) {
      setError(duplicateError(requestError));
    } finally {
      previewRequestInFlight.current = false;
      if (append) setLoadingMore(false);
      else setPreviewing(false);
    }
  }

  function loadNextPreviewPage(
    event: UIEvent<HTMLDivElement>, uiLocale: string = "ru-RU"
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
    if (remaining <= 180) {
      void requestPreview(preview.page + 1, true, uiLocale);
    }
  }

  async function applyPreview(uiLocale: string = "ru-RU"): Promise<void> {
    const initialCommand = duplicateCommand(
      analysisMode,
      caseSensitive,
      ignorePunctuation,
      ignoredWords,
      scopeKind,
      resolvedGroupIds,
      selections,
      keeperStrategy
    );
    if (
      !initialCommand ||
      !preview ||
      decisionSummary.decisions.length === 0 ||
      applying ||
      loadingMore
    ) {
      return;
    }
    const batches = duplicateDecisionBatches(decisionSummary.decisions);
    setApplying(true);
    setDeletedProgress(0);
    setError(undefined);
    let deleted = 0;
    try {
      let command = initialCommand;
      let previewHash = preview.previewHash;
      let hasMore = false;
      for (const [batchIndex, decisions] of batches.entries()) {
        const result = await browserApiRequest<SemanticDuplicateApplyResult>(
          `${endpoint}/apply`,
          {
            method: "POST",
            body: {
              ...command,
              previewHash,
              decisions
            }
          }
        );
        deleted += result.deletedCount;
        hasMore = result.hasMore;
        setDeletedProgress(deleted);
        if (batchIndex === batches.length - 1) break;
        command = commandWithoutDeletedSelection(
          command,
          result.deletedKeywordIds
        );
        const refreshed = await browserApiRequest<SemanticDuplicatePreview>(
          `${endpoint}/preview`,
          {
            method: "POST",
            body: {
              ...command,
              page: 1,
              pageSize: DUPLICATE_PREVIEW_PAGE_SIZE
            }
          }
        );
        previewHash = refreshed.previewHash;
      }
      onCompleted(
        deleted > 0
          ? `${formatInteger(deleted, uiLocale)} неявных дублей перемещено в корзину. Действие можно отменить в истории.${hasMore ? " В проекте остались непросмотренные или пропущенные группы." : ""}`
          : "Неявных дублей для удаления больше нет."
      );
    } catch (requestError) {
      setError(
        deleted > 0
          ? `${formatInteger(deleted, uiLocale)} дублей уже перемещено. Остальной пакет не обработан: ${duplicateError(requestError)}`
          : duplicateError(requestError)
      );
      setPreview(undefined);
      setChoices({});
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
    <SemanticModal
      description={uiText("Сравнение фраз без учёта порядка слов")}
      footer={(
        <div className="semantic-workflow-footer">
          <dl className="semantic-dialog-estimate semantic-workflow-footer-estimate semantic-duplicate-estimate">
            <div>
              <Icon name="projects" />
              <div><dt><UiText text="Область" /></dt><dd>{scopeSummary}</dd></div>
            </div>
            <div>
              <Icon name="checkDouble" />
              <div>
                <dt><UiText text="Групп к обработке" /></dt>
                <dd>
                  {preview
                    ? formatInteger(decisionSummary.groupCount, uiLocale)
                    : <UiText text="Не рассчитано" />}
                </dd>
              </div>
            </div>
            <div>
              <Icon name="trash" />
              <div>
                <dt><UiText text="В корзину" /></dt>
                <dd>
                  {preview
                    ? formatInteger(decisionSummary.deletionCount, uiLocale)
                    : <UiText text="Не рассчитано" />}
                </dd>
              </div>
            </div>
          </dl>
          <div className="semantic-modal-actions semantic-duplicate-actions">
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
                decisionSummary.deletionCount === 0 ||
                applying ||
                previewing ||
                loadingMore
              }
              onClick={() => void applyPreview(uiLocale)}
              type="button"
            >
              {applying
                ? <UiText text="Перемещаем…" />
                : <UiText text="В корзину{0}" values={[String(preview ? ` (${formatInteger(decisionSummary.deletionCount, uiLocale)})` : "")]} />}
            </button>
          </div>
        </div>
      )}
      onClose={requestClose}
      presenceKey="semantic-modal:duplicates"
      size="large"
      title={uiText("Неявные дубли")}
    >
      <div className="semantic-duplicate-dialog semantic-workflow-dialog">
        <div className="semantic-workflow-grid semantic-duplicate-workflow-grid">
          <section className="semantic-workflow-panel semantic-duplicate-settings">
            <header>
              <h3><UiText text="Правила сравнения" /></h3>
              <p>
                <UiText text="Фразы считаются дублями, когда состоят из одинакового набора слов, даже если слова стоят в другом порядке." /></p>
            </header>

            <label className="semantic-workflow-field">
              <span><UiText text="Режим анализа" /></span>
              <CustomSelect
                disabled={applying}
                onChange={(event) => {
                  setAnalysisMode(
                    event.target.value as SemanticDuplicateAnalysisMode
                  );
                  invalidatePreview();
                }}
                value={analysisMode}
              >
                <option value="WORD_FORM_PRECISE">
                  <UiText text="Углублённый · без учёта словоформ" /></option>
                <option value="EXACT"><UiText text="Точный · словоформы различаются" /></option>
              </CustomSelect>
              <small>
                {analysisMode === "WORD_FORM_PRECISE"
                  ? <UiText text="«машина» и «машины» сравниваются по русской словоформе." />
                  : <UiText text="Совпадут только одинаковые формы слов." />}
              </small>
            </label>

            <fieldset className="semantic-duplicate-options">
              <legend><UiText text="Нормализация" /></legend>
              <label className="semantic-toggle-line">
                <input
                  checked={caseSensitive}
                  disabled={applying}
                  onChange={(event) => {
                    setCaseSensitive(event.target.checked);
                    invalidatePreview();
                  }}
                  type="checkbox"
                />
                <span>
                  <strong><UiText text="Учитывать регистр" /></strong>
                  <small><UiText text="«SEO» и «seo» будут разными." /></small>
                </span>
              </label>
              <label className="semantic-toggle-line">
                <input
                  checked={ignorePunctuation}
                  disabled={applying}
                  onChange={(event) => {
                    setIgnorePunctuation(event.target.checked);
                    invalidatePreview();
                  }}
                  type="checkbox"
                />
                <span>
                  <strong><UiText text="Игнорировать знаки и спецсимволы" /></strong>
                  <small><UiText text="Дефисы, кавычки и запятые не влияют на группу." /></small>
                </span>
              </label>
            </fieldset>

            <label className="semantic-workflow-field semantic-duplicate-ignored">
              <span><UiText text="Слова-исключения" /></span>
              <textarea
                disabled={applying}
                onChange={(event) => {
                  setIgnoredWordsText(event.target.value);
                  invalidatePreview();
                }}
                placeholder={uiText("в на для")}
                rows={4}
                value={ignoredWordsText}
              />
              <small>
                <UiText text="По одному на строку ·" after=" " />{ignoredWords.length} <UiText text="из 100" before=" " /></small>
            </label>
          </section>

          <section className="semantic-workflow-panel semantic-duplicate-scope">
            <header>
              <h3><UiText text="Область и умная отметка" /></h3>
              <p>
                <UiText text="Для каждой группы будет оставлена одна лучшая фраза, остальные попадут в корзину только после подтверждения." /></p>
            </header>

            <div className="semantic-negative-scope-cards semantic-duplicate-scope-cards">
              <ScopeCard
                checked={scopeKind === "PROJECT"}
                disabled={applying}
                label={uiText("Все запросы проекта")}
                onSelect={() => {
                  setScopeKind("PROJECT");
                  invalidatePreview();
                }}
              />
              {selections.length > 0 && (
                <ScopeCard
                  checked={scopeKind === "SELECTION"}
                  count={selections.length}
                  disabled={applying}
                  label={uiText("Выбранные запросы")}
                  onSelect={() => {
                    setScopeKind("SELECTION");
                    invalidatePreview();
                  }}
                />
              )}
              {availableGroups.length > 0 && (
                <ScopeCard
                  checked={scopeKind === "GROUP"}
                  count={selectedGroupIds.size}
                  disabled={applying}
                  label={uiText("Конкретные папки")}
                  onSelect={() => {
                    setScopeKind("GROUP");
                    invalidatePreview();
                  }}
                />
              )}
            </div>

            {scopeKind === "GROUP" && (
              <div className="semantic-duplicate-folder-scope">
                <div className="semantic-duplicate-folder-toolbar">
                  <span>
                    <UiText text="Выбрано папок:" after=" " />{formatInteger(selectedGroupIds.size, uiLocale)}
                  </span>
                  <div>
                    {activeGroup && (
                      <button
                        disabled={applying}
                        onClick={() => {
                          setSelectedGroupIds(new Set([activeGroup.id]));
                          setExpandedGroupIds(
                            expandedAncestorIds(groups, [activeGroup.id])
                          );
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
                  aria-label={uiText("Папки для поиска дублей")}
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
                  <UiText text="Родительская папка включает все вложенные. Запросы, которые находятся сразу в нескольких папках, проверяются один раз." /></small>
              </div>
            )}

            <label className="semantic-workflow-field">
              <span><UiText text="Какую фразу оставить" /></span>
              <CustomSelect
                disabled={applying}
                onChange={(event) => {
                  setKeeperStrategy(
                    event.target.value as SemanticDuplicateKeeperStrategy
                  );
                  invalidatePreview();
                }}
                value={keeperStrategy}
              >
                <option value="HIGHEST_FREQUENCY">
                  <UiText text="С максимальной базовой частотностью" /></option>
                <option value="HIGHEST_PRIORITY">
                  <UiText text="С максимальным приоритетом" /></option>
                <option value="OLDEST"><UiText text="Добавленную раньше остальных" /></option>
              </CustomSelect>
              <small>{keeperStrategyHint(keeperStrategy)}</small>
            </label>

            <div className="semantic-duplicate-safety-note">
              <Icon name="checkDouble" />
              <span>
                <strong><UiText text="Без безвозвратного удаления" /></strong>
                <small>
                  <UiText text="Удаляемые варианты переходят в системную корзину. Операцию можно отменить через историю семантики." /></small>
              </span>
            </div>

            <button
              className="primary-button semantic-duplicate-preview-button"
              disabled={previewing || loadingMore || applying}
              onClick={() => void requestPreview(undefined, undefined, uiLocale)}
              type="button"
            >
              <Icon name="search" />
              {previewing
                ? <UiText text="Анализируем…" />
                : preview
                  ? <UiText text="Пересчитать дубли" />
                  : <UiText text="Найти неявные дубли" />}
            </button>
          </section>
        </div>

        <section className="semantic-duplicate-results">
          <header>
            <div>
              <h3><UiText text="Предпросмотр групп" /></h3>
              <p>
                <UiText text="Выберите группу и укажите запрос, который нужно оставить. Остальные отмеченные строки будут перемещены в корзину." /></p>
            </div>
            {preview && (
              <dl>
                <div>
                  <dt><UiText text="Проверено" /></dt>
                  <dd>{formatInteger(preview.scannedCount, uiLocale)}</dd>
                </div>
                <div>
                  <dt><UiText text="Групп" /></dt>
                  <dd>{formatInteger(preview.duplicateGroupCount, uiLocale)}</dd>
                </div>
                <div>
                  <dt><UiText text="Выбрано групп" /></dt>
                  <dd>{formatInteger(decisionSummary.groupCount, uiLocale)}</dd>
                </div>
                <div>
                  <dt><UiText text="Будет удалено" /></dt>
                  <dd>{formatInteger(decisionSummary.deletionCount, uiLocale)}</dd>
                </div>
              </dl>
            )}
          </header>

          {!preview && !previewing && (
            <div className="semantic-duplicate-empty">
              <Icon name="checkDouble" />
              <strong><UiText text="Результаты появятся после анализа" /></strong>
              <span>
                <UiText text="Настройте правила, область и способ выбора основной фразы." /></span>
            </div>
          )}
          {previewing && (
            <div className="semantic-duplicate-empty" role="status">
              <span className="spinner" />
              <strong><UiText text="Сравниваем состав фраз…" /></strong>
              <span><UiText text="Для большого ядра это может занять несколько секунд." /></span>
            </div>
          )}
          {preview && preview.groups.length === 0 && (
            <div className="semantic-duplicate-empty success">
              <Icon name="checkDouble" />
              <strong><UiText text="Неявных дублей не найдено" /></strong>
              <span><UiText text="Выбранная область уже чистая." /></span>
            </div>
          )}
          {preview && preview.groups.length > 0 && (
            <div className="semantic-duplicate-review">
              <div className="semantic-duplicate-review-toolbar">
                <span>
                  <UiText text="Выбрано" after=" " />{formatInteger(decisionSummary.groupCount, uiLocale)} <UiText text="из" before=" " />{" "}
                  {formatInteger(preview.groups.length, uiLocale)} <UiText text="загруженных групп" before=" " /></span>
                <div>
                  <button
                    disabled={applying}
                    onClick={() => setChoices((current) =>
                      setAllDuplicateGroups(preview, current, true)
                    )}
                    type="button"
                  >
                    <UiText text="Обработать все" /></button>
                  <button
                    disabled={applying}
                    onClick={() => setChoices((current) =>
                      setAllDuplicateGroups(preview, current, false)
                    )}
                    type="button"
                  >
                    <UiText text="Снять выбор" /></button>
                </div>
              </div>
              <div
                aria-busy={loadingMore}
                className="semantic-duplicate-group-list"
                onScroll={loadNextPreviewPage}
              >
                {preview.groups.map((group, groupIndex) => {
                  const choice = choices[group.id] ?? {
                    enabled: true,
                    keeperKeywordId: group.keeperKeywordId
                  };
                  return (
                    <section
                      className={`semantic-duplicate-card ${
                        choice.enabled ? "selected" : "skipped"
                      }`}
                      key={group.id}
                    >
                      <header className="semantic-duplicate-card-header">
                        <label>
                          <input
                            checked={choice.enabled}
                            disabled={applying}
                            onChange={(event) => setChoices((current) => ({
                              ...current,
                              [group.id]: {
                                ...choice,
                                enabled: event.target.checked
                              }
                            }))}
                            type="checkbox"
                          />
                          <strong><UiText text="Группа" after=" " />{groupIndex + 1}</strong>
                        </label>
                        <span>
                          {group.items.length}
                          {group.itemsTruncated ? "+" : ""} <UiText text="фраз" before=" " /></span>
                      </header>
                      <div className="semantic-duplicate-card-body">
                        {group.items.map((item) => {
                          const keep =
                            choice.enabled &&
                            choice.keeperKeywordId === item.keywordId;
                          return (
                            <label
                              className={
                                !choice.enabled
                                  ? "semantic-duplicate-row skipped"
                                  : keep
                                    ? "semantic-duplicate-row keep"
                                    : "semantic-duplicate-row remove"
                              }
                              key={item.keywordId}
                            >
                              <input
                                checked={choice.keeperKeywordId === item.keywordId}
                                disabled={!choice.enabled || applying}
                                name={`duplicate-keeper-${group.id}`}
                                onChange={() => setChoices((current) => ({
                                  ...current,
                                  [group.id]: {
                                    enabled: true,
                                    keeperKeywordId: item.keywordId
                                  }
                                }))}
                                type="radio"
                              />
                              <span className="semantic-duplicate-decision">
                                {!choice.enabled
                                  ? <UiText text="Пропустить" />
                                  : keep
                                    ? <UiText text="Оставить" />
                                    : <UiText text="В корзину" />}
                              </span>
                              <span className="semantic-duplicate-query">
                                <strong>{item.text}</strong>
                                <span className="semantic-duplicate-metrics">
                                  <DuplicateFrequency
                                    label={uiText("База")}
                                    title={uiText("Яндекс · базовая частотность")}
                                    value={item.baseFrequency}
                                  />
                                  <DuplicateFrequency
                                    label={'""'}
                                    title={uiText("Яндекс · фразовая частотность")}
                                    value={item.exactFrequency}
                                  />
                                  <DuplicateFrequency
                                    label={'"!"'}
                                    title={uiText("Яндекс · точная частотность")}
                                    value={item.fixedFrequency}
                                  />
                                  <span className="semantic-duplicate-priority">
                                    <UiText text="Приоритет" after=" " />{item.priority}
                                  </span>
                                </span>
                                <span className="semantic-duplicate-folders">
                                  <b>
                                    {item.groupPaths.length > 1
                                      ? <UiText text="Папки:" />
                                      : <UiText text="Папка:" />}
                                  </b>
                                  {(item.groupPaths.length > 0
                                    ? item.groupPaths
                                    : ["Без группы"]
                                  ).map((path) => (
                                    <em key={path} title={path}>{path}</em>
                                  ))}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {group.itemsTruncated && (
                        <p>
                          <UiText text="Показан безопасный пакет этой группы. Оставшиеся фразы появятся при следующем анализе." /></p>
                      )}
                    </section>
                  );
                })}
              </div>
              {preview.duplicateGroupCount > 0 && (
                <div
                  aria-live="polite"
                  className="semantic-duplicate-scroll-status"
                >
                  <span>
                    <UiText text="Загружено" after=" " />{formatInteger(preview.groups.length, uiLocale)} <UiText text="из" before=" " />{" "}
                    {formatInteger(preview.duplicateGroupCount, uiLocale)} <UiText text="групп" before=" " /></span>
                  {preview.page < preview.pageCount && (
                    <span>
                      {loadingMore && <span className="spinner" />}
                      {loadingMore
                        ? <UiText text="Загружаем ещё…" />
                        : <UiText text="Прокрутите вниз — следующие 100 групп загрузятся автоматически" />}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {error && (
          <div className="semantic-workflow-feedback">
            <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>
          </div>
        )}

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
  disabled,
  label,
  onSelect
}: Readonly<{
  checked: boolean;
  count?: number;
  disabled: boolean;
  label: string;
  onSelect: () => void;
}>) {
  const uiLocale = useUiLocale().locale;
  return (
    <label className={checked ? "selected" : undefined}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        type="radio"
      />
      <span>
        <strong>{label}</strong>
        {count !== undefined && <small>{formatInteger(count, uiLocale)} <UiText text="шт." before=" " /></small>}
      </span>
    </label>
  );
}

export function DuplicateFrequency({
  label,
  title,
  value
}: Readonly<{
  label: string;
  title: string;
  value: string | undefined;
}>) {
  const uiLocale = useUiLocale().locale;
  return (
    <span className="semantic-duplicate-frequency" title={title}>
      <SearchEngineLogo engine="YANDEX" size="compact" />
      <b>{label}</b>
      <strong>{value === undefined ? "—" : formatFrequency(value, uiLocale)}</strong>
    </span>
  );
}

function duplicateCommand(
  analysisMode: SemanticDuplicateAnalysisMode,
  caseSensitive: boolean,
  ignorePunctuation: boolean,
  ignoredWords: readonly string[],
  scopeKind: ScopeKind,
  groupIds: readonly string[],
  selections: readonly SemanticKeywordBulkSelection[],
  keeperStrategy: SemanticDuplicateKeeperStrategy
): SemanticDuplicateCommandInput | undefined {
  const scope = duplicateScope(scopeKind, groupIds, selections);
  if (
    !scope ||
    ignoredWords.length > 100 ||
    ignoredWords.some(
      (word) => word.length > 80 || !/[\p{L}\p{N}]/u.test(word)
    )
  ) {
    return undefined;
  }
  return {
    rules: {
      analysisMode,
      caseSensitive,
      ignorePunctuation,
      ignoredWords
    },
    scope,
    keeperStrategy
  };
}

function duplicateScope(
  kind: ScopeKind,
  groupIds: readonly string[],
  selections: readonly SemanticKeywordBulkSelection[]
): SemanticDuplicateScope | undefined {
  if (kind === "PROJECT") return { kind };
  if (kind === "GROUP") {
    return groupIds.length > 0 &&
      groupIds.length <= semanticDuplicateGroupScopeLimit
      ? { kind, groupIds }
      : undefined;
  }
  return selections.length > 0 && selections.length <= 2_000
    ? { kind, items: selections.map(({ id, version }) => ({ id, version })) }
    : undefined;
}

function defaultDuplicateChoices(
  preview: SemanticDuplicatePreview
): DuplicateChoices {
  return Object.fromEntries(preview.groups.map((group) => [
    group.id,
    { enabled: true, keeperKeywordId: group.keeperKeywordId }
  ]));
}

function appendDuplicateChoices(
  current: DuplicateChoices,
  groups: SemanticDuplicatePreview["groups"]
): DuplicateChoices {
  return {
    ...current,
    ...Object.fromEntries(groups.map((group) => [
      group.id,
      current[group.id] ?? {
        enabled: true,
        keeperKeywordId: group.keeperKeywordId
      }
    ]))
  };
}

function appendDuplicatePreviewGroups(
  current: SemanticDuplicatePreview,
  next: SemanticDuplicatePreview
): SemanticDuplicatePreview {
  const knownIds = new Set(current.groups.map(({ id }) => id));
  return {
    ...next,
    groups: [
      ...current.groups,
      ...next.groups.filter(({ id }) => !knownIds.has(id))
    ]
  };
}

function setAllDuplicateGroups(
  preview: SemanticDuplicatePreview,
  current: DuplicateChoices,
  enabled: boolean
): DuplicateChoices {
  return Object.fromEntries(preview.groups.map((group) => [
    group.id,
    {
      enabled,
      keeperKeywordId:
        current[group.id]?.keeperKeywordId ?? group.keeperKeywordId
    }
  ]));
}

function duplicateDecisionSummary(
  preview: SemanticDuplicatePreview | undefined,
  choices: DuplicateChoices
): Readonly<{
  decisions: readonly SemanticDuplicateGroupDecision[];
  deletionCount: number;
  groupCount: number;
}> {
  if (!preview) return { decisions: [], deletionCount: 0, groupCount: 0 };
  const decisions = preview.groups.flatMap((group) => {
    const choice = choices[group.id];
    if (!choice?.enabled) return [];
    const keeper = group.items.find(
      ({ keywordId }) => keywordId === choice.keeperKeywordId
    );
    if (!keeper) return [];
    const deletions = group.items
      .filter(({ keywordId }) => keywordId !== keeper.keywordId)
      .map(({ keywordId: id, version }) => ({ id, version }));
    return deletions.length === 0
      ? []
      : [{
          groupId: group.id,
          keeper: { id: keeper.keywordId, version: keeper.version },
          deletions
        } satisfies SemanticDuplicateGroupDecision];
  });
  return {
    decisions,
    deletionCount: decisions.reduce(
      (total, decision) => total + decision.deletions.length,
      0
    ),
    groupCount: decisions.length
  };
}

function duplicateDecisionBatches(
  decisions: readonly SemanticDuplicateGroupDecision[]
): readonly (readonly SemanticDuplicateGroupDecision[])[] {
  const batches: SemanticDuplicateGroupDecision[][] = [];
  let batch: SemanticDuplicateGroupDecision[] = [];
  let deletionCount = 0;
  for (const decision of decisions) {
    if (
      batch.length >= DUPLICATE_APPLY_BATCH_SIZE ||
      deletionCount + decision.deletions.length > DUPLICATE_APPLY_BATCH_SIZE
    ) {
      batches.push(batch);
      batch = [];
      deletionCount = 0;
    }
    batch.push(decision);
    deletionCount += decision.deletions.length;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function commandWithoutDeletedSelection(
  command: SemanticDuplicateCommandInput,
  deletedKeywordIds: readonly string[]
): SemanticDuplicateCommandInput {
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

function parseIgnoredWords(
  value: string,
  caseSensitive: boolean
): readonly string[] {
  const unique = new Map<string, string>();
  for (const raw of value.split(/\r?\n/u)) {
    const normalized = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!normalized) continue;
    const key = caseSensitive
      ? normalized
      : normalized.toLocaleLowerCase("ru-RU");
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}

function duplicateValidationMessage(
  ignoredWords: readonly string[],
  scopeKind: ScopeKind,
  groupIds: readonly string[],
  selections: readonly SemanticKeywordBulkSelection[], uiLocale: string = "ru-RU"
): string {
  if (ignoredWords.length > 100) {
    return "Можно указать не больше 100 слов-исключений.";
  }
  if (ignoredWords.some((word) => word.length > 80)) {
    return "Слово-исключение не может быть длиннее 80 символов.";
  }
  if (ignoredWords.some((word) => !/[\p{L}\p{N}]/u.test(word))) {
    return "Каждое слово-исключение должно содержать букву или цифру.";
  }
  if (scopeKind === "GROUP" && groupIds.length === 0) {
    return "Выберите хотя бы одну папку для анализа.";
  }
  if (
    scopeKind === "GROUP" &&
    groupIds.length > semanticDuplicateGroupScopeLimit
  ) {
    return `За один раз можно выбрать не больше ${formatInteger(semanticDuplicateGroupScopeLimit, uiLocale)} папок.`;
  }
  if (scopeKind === "SELECTION" && selections.length === 0) {
    return "Выберите хотя бы два запроса.";
  }
  if (selections.length > 2_000) {
    return "За один раз можно проверить не больше 2 000 выбранных запросов.";
  }
  return "Проверьте параметры поиска неявных дублей.";
}

function duplicateScopeSummary(
  kind: ScopeKind,
  selectedGroupCount: number,
  selectedKeywordCount: number, uiLocale: string = "ru-RU"
): string {
  if (kind === "PROJECT") return "Все запросы проекта";
  if (kind === "SELECTION") {
    return `${formatInteger(selectedKeywordCount, uiLocale)} выбранных`;
  }
  return selectedGroupCount > 0
    ? `${formatInteger(selectedGroupCount, uiLocale)} папок`
    : "Папки не выбраны";
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function keeperStrategyHint(strategy: SemanticDuplicateKeeperStrategy): string {
  if (strategy === "HIGHEST_FREQUENCY") {
    return "Если частотность одинакова или не собрана, учитываются приоритет и дата добавления.";
  }
  if (strategy === "HIGHEST_PRIORITY") {
    return "При равном приоритете учитываются частотность и дата добавления.";
  }
  return "При одинаковой дате учитываются частотность и приоритет.";
}

function duplicateError(error: unknown): string {
  if (!(error instanceof BrowserApiError)) {
    return "Не удалось выполнить анализ неявных дублей.";
  }
  if (
    error.code === "RESOURCE_STATE_CONFLICT" ||
    error.code === "VERSION_CONFLICT"
  ) {
    return "Запросы изменились после предпросмотра. Пересчитайте дубли.";
  }
  if (error.code === "SCOPE_TOO_LARGE") {
    return "В выбранной области больше 50 000 запросов. Выберите отдельную папку.";
  }
  if (error.code === "FORBIDDEN") {
    return "Недостаточно прав для удаления запросов.";
  }
  if (error.code === "VALIDATION_FAILED") {
    return error.fieldErrors[0]?.message ?? "Проверьте параметры.";
  }
  return error.message;
}

function formatFrequency(value: string, uiLocale: string = "ru-RU"): string {
  try {
    return new Intl.NumberFormat(uiLocale).format(BigInt(value));
  } catch {
    return value;
  }
}

function formatInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}
