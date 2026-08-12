"use client";

import { useMemo, useState } from "react";
import type {
  SemanticDuplicateAnalysisMode,
  SemanticDuplicateApplyResult,
  SemanticDuplicateCommandInput,
  SemanticDuplicateGroupDecision,
  SemanticDuplicateKeeperStrategy,
  SemanticDuplicatePreview,
  SemanticDuplicateScope,
  SemanticKeywordBulkSelection
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { SemanticModal } from "./semantic-modal";

type ScopeKind = SemanticDuplicateScope["kind"];
type DuplicateChoices = Readonly<
  Record<string, Readonly<{ enabled: boolean; keeperKeywordId: string }>>
>;

export function SemanticDuplicatesDialog({
  activeGroup,
  onClose,
  onCompleted,
  projectId,
  selections
}: Readonly<{
  activeGroup?: Readonly<{ id: string; name: string }>;
  onClose: () => void;
  onCompleted: (message: string) => void;
  projectId: string;
  selections: readonly Readonly<
    SemanticKeywordBulkSelection & { label: string }
  >[];
}>) {
  const [analysisMode, setAnalysisMode] =
    useState<SemanticDuplicateAnalysisMode>("WORD_FORM_PRECISE");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [ignorePunctuation, setIgnorePunctuation] = useState(true);
  const [ignoredWordsText, setIgnoredWordsText] = useState("");
  const [keeperStrategy, setKeeperStrategy] =
    useState<SemanticDuplicateKeeperStrategy>("HIGHEST_FREQUENCY");
  const [scopeKind, setScopeKind] = useState<ScopeKind>(
    selections.length > 0 ? "SELECTION" : activeGroup ? "GROUP" : "PROJECT"
  );
  const [preview, setPreview] = useState<SemanticDuplicatePreview>();
  const [choices, setChoices] = useState<DuplicateChoices>({});
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [deletedProgress, setDeletedProgress] = useState(0);
  const [error, setError] = useState<string>();
  const ignoredWords = useMemo(
    () => parseIgnoredWords(ignoredWordsText, caseSensitive),
    [caseSensitive, ignoredWordsText]
  );
  const endpoint = `/app/api/projects/${encodeURIComponent(projectId)}/semantic-duplicates`;
  const decisionSummary = useMemo(
    () => duplicateDecisionSummary(preview, choices),
    [choices, preview]
  );

  function invalidatePreview(): void {
    setPreview(undefined);
    setChoices({});
    setDeletedProgress(0);
    setError(undefined);
  }

  async function requestPreview(): Promise<void> {
    const command = duplicateCommand(
      analysisMode,
      caseSensitive,
      ignorePunctuation,
      ignoredWords,
      scopeKind,
      activeGroup,
      selections,
      keeperStrategy
    );
    if (!command) {
      setError(duplicateValidationMessage(
        ignoredWords,
        scopeKind,
        activeGroup,
        selections
      ));
      return;
    }
    setPreviewing(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<SemanticDuplicatePreview>(
        `${endpoint}/preview`,
        { method: "POST", body: command }
      );
      setPreview(result);
      setChoices(defaultDuplicateChoices(result));
    } catch (requestError) {
      setError(duplicateError(requestError));
    } finally {
      setPreviewing(false);
    }
  }

  async function applyPreview(): Promise<void> {
    const initialCommand = duplicateCommand(
      analysisMode,
      caseSensitive,
      ignorePunctuation,
      ignoredWords,
      scopeKind,
      activeGroup,
      selections,
      keeperStrategy
    );
    if (
      !initialCommand ||
      !preview ||
      decisionSummary.decisions.length === 0 ||
      applying
    ) {
      return;
    }
    setApplying(true);
    setDeletedProgress(0);
    setError(undefined);
    try {
      const result = await browserApiRequest<SemanticDuplicateApplyResult>(
        `${endpoint}/apply`,
        {
          method: "POST",
          body: {
            ...initialCommand,
            previewHash: preview.previewHash,
            decisions: decisionSummary.decisions
          }
        }
      );
      const deleted = result.deletedCount;
      setDeletedProgress(deleted);
      onCompleted(
        deleted > 0
          ? `${formatInteger(deleted)} неявных дублей перемещено в корзину. Действие можно отменить в истории.${result.hasMore ? " В проекте остались непросмотренные или пропущенные группы." : ""}`
          : "Неявных дублей для удаления больше нет."
      );
    } catch (requestError) {
      setError(duplicateError(requestError));
      setPreview(undefined);
      setChoices({});
    } finally {
      setApplying(false);
    }
  }

  return (
    <SemanticModal
      description="Сравнение фраз без учёта порядка слов"
      onClose={applying ? () => undefined : onClose}
      size="large"
      title="Неявные дубли"
    >
      <div className="semantic-duplicate-dialog semantic-workflow-dialog">
        <div className="semantic-workflow-grid semantic-duplicate-workflow-grid">
          <section className="semantic-workflow-panel semantic-duplicate-settings">
            <header>
              <h3>Правила сравнения</h3>
              <p>
                Фразы считаются дублями, когда состоят из одинакового набора
                слов, даже если слова стоят в другом порядке.
              </p>
            </header>

            <label className="semantic-workflow-field">
              <span>Режим анализа</span>
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
                  Углублённый · без учёта словоформ
                </option>
                <option value="EXACT">Точный · словоформы различаются</option>
              </CustomSelect>
              <small>
                {analysisMode === "WORD_FORM_PRECISE"
                  ? "«машина» и «машины» сравниваются по русской словоформе."
                  : "Совпадут только одинаковые формы слов."}
              </small>
            </label>

            <fieldset className="semantic-duplicate-options">
              <legend>Нормализация</legend>
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
                  <strong>Учитывать регистр</strong>
                  <small>«SEO» и «seo» будут разными.</small>
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
                  <strong>Игнорировать знаки и спецсимволы</strong>
                  <small>Дефисы, кавычки и запятые не влияют на группу.</small>
                </span>
              </label>
            </fieldset>

            <label className="semantic-workflow-field semantic-duplicate-ignored">
              <span>Слова-исключения</span>
              <textarea
                disabled={applying}
                onChange={(event) => {
                  setIgnoredWordsText(event.target.value);
                  invalidatePreview();
                }}
                placeholder={"в\nна\nдля"}
                rows={4}
                value={ignoredWordsText}
              />
              <small>
                По одному на строку · {ignoredWords.length} из 100
              </small>
            </label>
          </section>

          <section className="semantic-workflow-panel semantic-duplicate-scope">
            <header>
              <h3>Область и умная отметка</h3>
              <p>
                Для каждой группы будет оставлена одна лучшая фраза, остальные
                попадут в корзину только после подтверждения.
              </p>
            </header>

            <div className="semantic-negative-scope-cards">
              {selections.length > 0 && (
                <ScopeCard
                  checked={scopeKind === "SELECTION"}
                  count={selections.length}
                  label="Выбранные запросы"
                  onSelect={() => {
                    setScopeKind("SELECTION");
                    invalidatePreview();
                  }}
                />
              )}
              {activeGroup && (
                <ScopeCard
                  checked={scopeKind === "GROUP"}
                  label={`Папка «${activeGroup.name}»`}
                  onSelect={() => {
                    setScopeKind("GROUP");
                    invalidatePreview();
                  }}
                />
              )}
              <ScopeCard
                checked={scopeKind === "PROJECT"}
                label="Весь проект"
                onSelect={() => {
                  setScopeKind("PROJECT");
                  invalidatePreview();
                }}
              />
            </div>

            <label className="semantic-workflow-field">
              <span>Какую фразу оставить</span>
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
                  С максимальной базовой частотностью
                </option>
                <option value="HIGHEST_PRIORITY">
                  С максимальным приоритетом
                </option>
                <option value="OLDEST">Добавленную раньше остальных</option>
              </CustomSelect>
              <small>{keeperStrategyHint(keeperStrategy)}</small>
            </label>

            <div className="semantic-duplicate-safety-note">
              <Icon name="checkDouble" />
              <span>
                <strong>Без безвозвратного удаления</strong>
                <small>
                  Удаляемые варианты переходят в системную корзину. Операцию
                  можно отменить через историю семантики.
                </small>
              </span>
            </div>

            <button
              className="primary-button semantic-duplicate-preview-button"
              disabled={previewing || applying}
              onClick={() => void requestPreview()}
              type="button"
            >
              <Icon name="search" />
              {previewing
                ? "Анализируем…"
                : preview
                  ? "Пересчитать дубли"
                  : "Найти неявные дубли"}
            </button>
          </section>
        </div>

        <section className="semantic-duplicate-results">
          <header>
            <div>
              <h3>Предпросмотр групп</h3>
              <p>
                Выберите группу и укажите запрос, который нужно оставить.
                Остальные отмеченные строки будут перемещены в корзину.
              </p>
            </div>
            {preview && (
              <dl>
                <div>
                  <dt>Проверено</dt>
                  <dd>{formatInteger(preview.scannedCount)}</dd>
                </div>
                <div>
                  <dt>Групп</dt>
                  <dd>{formatInteger(preview.duplicateGroupCount)}</dd>
                </div>
                <div>
                  <dt>Выбрано групп</dt>
                  <dd>{formatInteger(decisionSummary.groupCount)}</dd>
                </div>
                <div>
                  <dt>Будет удалено</dt>
                  <dd>{formatInteger(decisionSummary.deletionCount)}</dd>
                </div>
              </dl>
            )}
          </header>

          {!preview && !previewing && (
            <div className="semantic-duplicate-empty">
              <Icon name="checkDouble" />
              <strong>Результаты появятся после анализа</strong>
              <span>
                Настройте правила, область и способ выбора основной фразы.
              </span>
            </div>
          )}
          {previewing && (
            <div className="semantic-duplicate-empty" role="status">
              <span className="spinner" />
              <strong>Сравниваем состав фраз…</strong>
              <span>Для большого ядра это может занять несколько секунд.</span>
            </div>
          )}
          {preview && preview.groups.length === 0 && (
            <div className="semantic-duplicate-empty success">
              <Icon name="checkDouble" />
              <strong>Неявных дублей не найдено</strong>
              <span>Выбранная область уже чистая.</span>
            </div>
          )}
          {preview && preview.groups.length > 0 && (
            <div className="semantic-duplicate-review">
              <div className="semantic-duplicate-review-toolbar">
                <span>
                  Выбрано {formatInteger(decisionSummary.groupCount)} из{" "}
                  {formatInteger(preview.groups.length)} показанных групп
                </span>
                <div>
                  <button
                    disabled={applying}
                    onClick={() => setChoices((current) =>
                      setAllDuplicateGroups(preview, current, true)
                    )}
                    type="button"
                  >
                    Обработать все
                  </button>
                  <button
                    disabled={applying}
                    onClick={() => setChoices((current) =>
                      setAllDuplicateGroups(preview, current, false)
                    )}
                    type="button"
                  >
                    Снять выбор
                  </button>
                </div>
              </div>
              <div className="semantic-duplicate-group-list">
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
                          <strong>Группа {groupIndex + 1}</strong>
                        </label>
                        <span>
                          {group.items.length}
                          {group.itemsTruncated ? "+" : ""} фраз
                        </span>
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
                                  ? "Пропустить"
                                  : keep
                                    ? "Оставить"
                                    : "В корзину"}
                              </span>
                              <span className="semantic-duplicate-query">
                                <strong>{item.text}</strong>
                                <small>
                                  {item.baseFrequency !== undefined
                                    ? `Частотность ${formatFrequency(item.baseFrequency)}`
                                    : "Частотность не собрана"}
                                  {` · Приоритет ${item.priority}`}
                                </small>
                                <span className="semantic-duplicate-folders">
                                  <b>
                                    {item.groupPaths.length > 1
                                      ? "Папки:"
                                      : "Папка:"}
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
                          Показан безопасный пакет этой группы. Оставшиеся
                          фразы появятся при следующем анализе.
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
              {preview.groupsTruncated && (
                <p className="semantic-duplicate-truncated-note">
                  Показаны первые {formatInteger(preview.groups.length)} групп
                  из {formatInteger(preview.duplicateGroupCount)}. Скрытые
                  группы не будут изменены и появятся при следующем анализе.
                </p>
              )}
            </div>
          )}
        </section>

        {error && (
          <div className="semantic-workflow-feedback">
            <div className="inline-alert danger" role="alert">{error}</div>
          </div>
        )}

        <div className="semantic-modal-actions semantic-workflow-footer semantic-duplicate-actions">
          <button
            className="secondary-button"
            disabled={applying}
            onClick={onClose}
            type="button"
          >
            Отмена
          </button>
          <div>
            {applying && (
              <span aria-live="polite">
                Перемещено: {formatInteger(deletedProgress)}
              </span>
            )}
            <button
              className="danger-button"
              disabled={
                !preview ||
                decisionSummary.deletionCount === 0 ||
                applying ||
                previewing
              }
              onClick={() => void applyPreview()}
              type="button"
            >
              {applying
                ? "Перемещаем…"
                : `Переместить выбранные в корзину${preview ? ` (${formatInteger(decisionSummary.deletionCount)})` : ""}`}
            </button>
          </div>
        </div>
      </div>
    </SemanticModal>
  );
}

function ScopeCard({
  checked,
  count,
  label,
  onSelect
}: Readonly<{
  checked: boolean;
  count?: number;
  label: string;
  onSelect: () => void;
}>) {
  return (
    <label className={checked ? "selected" : undefined}>
      <input checked={checked} onChange={onSelect} type="radio" />
      <span>
        <strong>{label}</strong>
        {count !== undefined && <small>{formatInteger(count)} шт.</small>}
      </span>
    </label>
  );
}

function duplicateCommand(
  analysisMode: SemanticDuplicateAnalysisMode,
  caseSensitive: boolean,
  ignorePunctuation: boolean,
  ignoredWords: readonly string[],
  scopeKind: ScopeKind,
  activeGroup: Readonly<{ id: string }> | undefined,
  selections: readonly SemanticKeywordBulkSelection[],
  keeperStrategy: SemanticDuplicateKeeperStrategy
): SemanticDuplicateCommandInput | undefined {
  const scope = duplicateScope(scopeKind, activeGroup, selections);
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
  activeGroup: Readonly<{ id: string }> | undefined,
  selections: readonly SemanticKeywordBulkSelection[]
): SemanticDuplicateScope | undefined {
  if (kind === "PROJECT") return { kind };
  if (kind === "GROUP") {
    return activeGroup ? { kind, groupId: activeGroup.id } : undefined;
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
  activeGroup: Readonly<{ id: string }> | undefined,
  selections: readonly SemanticKeywordBulkSelection[]
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
  if (scopeKind === "GROUP" && !activeGroup) {
    return "Выберите папку для анализа.";
  }
  if (scopeKind === "SELECTION" && selections.length === 0) {
    return "Выберите хотя бы два запроса.";
  }
  if (selections.length > 2_000) {
    return "За один раз можно проверить не больше 2 000 выбранных запросов.";
  }
  return "Проверьте параметры поиска неявных дублей.";
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

function formatFrequency(value: string): string {
  try {
    return new Intl.NumberFormat("ru-RU").format(BigInt(value));
  } catch {
    return value;
  }
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}
