"use client";

import { CustomSelect } from "./custom-select";
import {
  SemanticGroupPickerField,
  type SemanticGroupPickerSpecialOption
} from "./semantic-group-picker";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";

import {
  semanticKeywordBulkCommandMaxItems,
  type SemanticKeywordCleaningCase,
  type SemanticKeywordCleaningPreview,
  type SemanticKeywordCleaningResult,
  type UpdateSemanticKeywordInput
} from "@seo-platform/contracts";
import { useState, type FormEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { semanticBulkSelectionBatches } from "../lib/semantic-row-selection";

interface BulkSelection {
  readonly id: string;
  readonly version: number;
  readonly text: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly isTracked: boolean;
  readonly intent?: BulkIntent;
  readonly groupId?: string;
  readonly clusterId?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
}

interface BulkCluster {
  readonly id: string;
  readonly name: string;
  readonly keywordCount: number;
  readonly version: number;
}

interface BulkResult {
  readonly selected: number;
  readonly changed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly conflicted: number;
}

interface SplitPreview {
  readonly readiness: "READY" | "CONFLICTED" | "BACKGROUND_REQUIRED";
  readonly sourceClusterState: "READY" | "CONFLICTED" | "UNAVAILABLE";
  readonly selectedKeywordCount: number;
  readonly movableKeywordCount: number;
  readonly sourceKeywordCount: number;
  readonly sourceWouldBeEmpty: boolean;
  readonly duplicateName: boolean;
  readonly sourceLocked: boolean;
  readonly conflictedKeywordIds: readonly string[];
  readonly unavailableKeywordIds: readonly string[];
  readonly synchronousKeywordLimit: number;
}

interface SplitResult {
  readonly createdCluster: Readonly<{ id: string; name: string }>;
  readonly movedKeywordCount: number;
}

const BULK_GROUP_SPECIAL_OPTIONS = [
  { icon: "list", label: "Не менять", value: "KEEP" }
] satisfies readonly SemanticGroupPickerSpecialOption[];

type BulkIntent =
  | "INFORMATIONAL"
  | "NAVIGATIONAL"
  | "COMMERCIAL"
  | "TRANSACTIONAL"
  | "LOCAL"
  | "MIXED";

export function SemanticBulkEditor({
  projectId,
  selections,
  groups,
  clusters,
  onCancel,
  onCompleted,
  onSplitCompleted
}: Readonly<{
  projectId: string;
  selections: readonly BulkSelection[];
  groups: readonly SemanticGroupTreeItem[];
  clusters: readonly BulkCluster[];
  onCancel: () => void;
  onCompleted: (result: BulkResult) => void;
  onSplitCompleted: (result: SplitResult) => void;
}>) {
  const single = selections.length === 1 ? selections[0] : undefined;
  const [text, setText] = useState(single?.text ?? "");
  const [language, setLanguage] = useState(single?.language ?? "ru");
  const [priority, setPriority] = useState(
    single ? String(single.priority) : ""
  );
  const [favorite, setFavorite] = useState<"KEEP" | "YES" | "NO">(
    single ? (single.isFavorite ? "YES" : "NO") : "KEEP"
  );
  const [tracked, setTracked] = useState<"KEEP" | "YES" | "NO">(
    single ? (single.isTracked ? "YES" : "NO") : "KEEP"
  );
  const [intent, setIntent] = useState<"KEEP" | "CLEAR" | BulkIntent>(
    single?.intent ?? (single ? "CLEAR" : "KEEP")
  );
  const [groupId, setGroupId] = useState<"KEEP" | "CLEAR" | string>(
    single?.groupId ?? (single ? "CLEAR" : "KEEP")
  );
  const [clusterId, setClusterId] = useState<"KEEP" | "CLEAR" | string>(
    single?.clusterId ?? (single ? "CLEAR" : "KEEP")
  );
  const [targetUrlMode, setTargetUrlMode] =
    useState<"KEEP" | "CLEAR" | "SET">(
      single ? (single.targetUrl ? "SET" : "CLEAR") : "KEEP"
    );
  const [targetUrl, setTargetUrl] = useState(single?.targetUrl ?? "");
  const [replaceTags, setReplaceTags] = useState(Boolean(single));
  const [tagNames, setTagNames] = useState(single?.tags.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<BulkResult>();
  const [splitName, setSplitName] = useState("");
  const [splitLocked, setSplitLocked] = useState(false);
  const [splitExcluded, setSplitExcluded] = useState(false);
  const [splitPreview, setSplitPreview] = useState<SplitPreview>();
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitError, setSplitError] = useState<string>();
  const [cleaningCase, setCleaningCase] =
    useState<SemanticKeywordCleaningCase>("KEEP");
  const [collapseWhitespace, setCollapseWhitespace] = useState(true);
  const [normalizeQuotes, setNormalizeQuotes] = useState(false);
  const [normalizeDashes, setNormalizeDashes] = useState(false);
  const [normalizeYo, setNormalizeYo] = useState(false);
  const [removeSearchOperators, setRemoveSearchOperators] = useState(false);
  const [cleaningPreview, setCleaningPreview] =
    useState<SemanticKeywordCleaningPreview>();
  const [cleaningBusy, setCleaningBusy] = useState<"PREVIEW" | "APPLY">();
  const [cleaningError, setCleaningError] = useState<string>();
  const sourceClusterId = selections[0]?.clusterId;
  const sourceCluster = sourceClusterId && selections.every(
    ({ clusterId: itemClusterId }) => itemClusterId === sourceClusterId
  )
    ? clusters.find(({ id }) => id === sourceClusterId)
    : undefined;

  const cleaningRules = {
    collapseWhitespace,
    normalizeQuotes,
    normalizeDashes,
    normalizeYo,
    removeSearchOperators,
    letterCase: cleaningCase
  };
  const hasCleaningRule =
    collapseWhitespace ||
    normalizeQuotes ||
    normalizeDashes ||
    normalizeYo ||
    removeSearchOperators ||
    cleaningCase !== "KEEP";

  function invalidateCleaning(): void {
    setCleaningPreview(undefined);
    setCleaningError(undefined);
  }

  async function previewCleaning(): Promise<void> {
    if (!hasCleaningRule || cleaningBusy) return;
    setCleaningBusy("PREVIEW");
    setCleaningError(undefined);
    try {
      setCleaningPreview(
        await browserApiRequest<SemanticKeywordCleaningPreview>(
          `/app/api/projects/${encodeURIComponent(
            projectId
          )}/bulk-commands/clean-preview`,
          {
            method: "POST",
            body: {
              items: selections.map(({ id, version }) => ({ id, version })),
              rules: cleaningRules
            }
          }
        )
      );
    } catch (requestError) {
      setCleaningPreview(undefined);
      setCleaningError(bulkErrorMessage(requestError));
    } finally {
      setCleaningBusy(undefined);
    }
  }

  async function applyCleaning(): Promise<void> {
    if (!cleaningPreview?.applicable || cleaningBusy) return;
    setCleaningBusy("APPLY");
    setCleaningError(undefined);
    try {
      const cleaningResult =
        await browserApiRequest<SemanticKeywordCleaningResult>(
          `/app/api/projects/${encodeURIComponent(
            projectId
          )}/bulk-commands/clean`,
          {
            method: "POST",
            body: {
              items: selections.map(({ id, version }) => ({ id, version })),
              rules: cleaningRules
            }
          }
        );
      onCompleted({
        selected: cleaningResult.selected,
        changed: cleaningResult.changed,
        skipped: cleaningResult.unchanged,
        failed: cleaningResult.failed,
        conflicted: cleaningResult.conflicted
      });
    } catch (requestError) {
      setCleaningPreview(undefined);
      setCleaningError(bulkErrorMessage(requestError));
    } finally {
      setCleaningBusy(undefined);
    }
  }

  function splitBody() {
    return {
      sourceCluster: sourceCluster
        ? { id: sourceCluster.id, version: sourceCluster.version }
        : undefined,
      keywordItems: selections.map(({ id, version }) => ({ id, version })),
      newClusterName: splitName,
      isLocked: splitLocked,
      excludeFromReclustering: splitExcluded
    };
  }

  async function previewClusterSplit(): Promise<void> {
    if (!sourceCluster || splitSaving) return;
    setSplitSaving(true);
    setSplitError(undefined);
    try {
      setSplitPreview(await browserApiRequest<SplitPreview>(
        `/app/api/projects/${encodeURIComponent(projectId)}/clusters/split-preview`,
        { method: "POST", body: splitBody() }
      ));
    } catch (requestError) {
      setSplitPreview(undefined);
      setSplitError(bulkErrorMessage(requestError));
    } finally {
      setSplitSaving(false);
    }
  }

  async function applyClusterSplit(): Promise<void> {
    if (!sourceCluster || splitPreview?.readiness !== "READY" || splitSaving) return;
    setSplitSaving(true);
    setSplitError(undefined);
    try {
      const splitResult = await browserApiRequest<SplitResult>(
        `/app/api/projects/${encodeURIComponent(projectId)}/clusters/split`,
        { method: "POST", body: splitBody() }
      );
      onSplitCompleted(splitResult);
    } catch (requestError) {
      setSplitPreview(undefined);
      setSplitError(bulkErrorMessage(requestError));
    } finally {
      setSplitSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const nextTags = parseTags(tagNames);
    const patch = single
      ? singleKeywordPatch(single, {
          text,
          language,
          priority,
          favorite,
          tracked,
          intent,
          groupId,
          clusterId,
          targetUrl,
          tagNames: nextTags
        })
      : {
          ...(priority === "" ? {} : { priority: Number(priority) }),
          ...(favorite === "KEEP"
            ? {}
            : { isFavorite: favorite === "YES" }),
          ...(tracked === "KEEP"
            ? {}
            : { isTracked: tracked === "YES" }),
          ...(intent === "KEEP"
            ? {}
            : { intent: intent === "CLEAR" ? null : intent }),
          ...(groupId === "KEEP"
            ? {}
            : { groupId: groupId === "CLEAR" ? null : groupId }),
          ...(clusterId === "KEEP"
            ? {}
            : { clusterId: clusterId === "CLEAR" ? null : clusterId }),
          ...(targetUrlMode === "KEEP"
            ? {}
            : {
                targetUrl: targetUrlMode === "CLEAR" ? null : targetUrl
              }),
          ...(replaceTags ? { tagNames: nextTags } : {})
        };
    if (Object.keys(patch).length === 0) {
      setError(single ? "Нет изменений для сохранения." : "Выберите хотя бы одно изменение.");
      return;
    }
    setSaving(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = single
        ? await updateSingleKeyword(projectId, single, patch)
        : await updateKeywordsInBatches(projectId, selections, patch);
      setResult(response);
      onCompleted(response);
    } catch (requestError) {
      setError(bulkErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={`semantic-bulk-editor${single ? " single" : ""}`} onSubmit={(event) => void submit(event)}>
      <div className="semantic-bulk-heading">
        <div>
          <strong>
            {single ? "Свойства запроса" : `Выбрано запросов: ${selections.length}`}
          </strong>
          <span>
            {single
              ? "Измените нужные значения в одной форме."
              : "Поля со значением «Не менять» останутся без изменений."}
          </span>
        </div>
      </div>
      <div className="semantic-bulk-grid">
        {single && (
          <>
            <label className="semantic-bulk-query">
              <span>Запрос</span>
              <input
                autoFocus
                maxLength={2_000}
                onChange={(event) => setText(event.target.value)}
                required
                value={text}
              />
            </label>
            <label className="semantic-bulk-language">
              <span>Язык</span>
              <input
                maxLength={16}
                onChange={(event) => setLanguage(event.target.value)}
                required
                value={language}
              />
            </label>
          </>
        )}
        <label className="semantic-bulk-priority">
          <span>Приоритет</span>
          <input
            max={100}
            min={0}
            onChange={(event) => setPriority(event.target.value)}
            placeholder="Не менять"
            required={Boolean(single)}
            type="number"
            value={priority}
          />
        </label>
        <label className="semantic-bulk-favorite">
          <span>Избранное</span>
          <CustomSelect
            onChange={(event) =>
              setFavorite(event.target.value as typeof favorite)
            }
            value={favorite}
          >
            {!single && <option value="KEEP">Не менять</option>}
            <option value="YES">{single ? "Да" : "Добавить"}</option>
            <option value="NO">{single ? "Нет" : "Убрать"}</option>
          </CustomSelect>
        </label>
        <label className="semantic-bulk-tracked">
          <span>Отслеживается</span>
          <CustomSelect
            onChange={(event) =>
              setTracked(event.target.value as typeof tracked)
            }
            value={tracked}
          >
            {!single && <option value="KEEP">Не менять</option>}
            <option value="YES">Да</option>
            <option value="NO">Нет</option>
          </CustomSelect>
        </label>
        <label className="semantic-bulk-intent">
          <span>Интент</span>
          <CustomSelect
            onChange={(event) =>
              setIntent(event.target.value as typeof intent)
            }
            value={intent}
          >
            {!single && <option value="KEEP">Не менять</option>}
            <option value="CLEAR">{single ? "Не задан" : "Очистить"}</option>
            <option value="INFORMATIONAL">Информационный</option>
            <option value="NAVIGATIONAL">Навигационный</option>
            <option value="COMMERCIAL">Коммерческий</option>
            <option value="TRANSACTIONAL">Транзакционный</option>
            <option value="LOCAL">Локальный</option>
            <option value="MIXED">Смешанный</option>
          </CustomSelect>
        </label>
        <label className="semantic-bulk-group">
          <span>Группа</span>
          <SemanticGroupPickerField
            dialogTitle="Группа запроса"
            groups={groups}
            onChange={(value) => setGroupId(value === "" ? "CLEAR" : value)}
            rootLabel="Без группы"
            {...(!single
              ? {
                  specialOptions: BULK_GROUP_SPECIAL_OPTIONS
                }
              : {})}
            value={groupId === "CLEAR" ? "" : groupId}
          />
        </label>
        <label className="semantic-bulk-cluster">
          <span>Кластер</span>
          <CustomSelect onChange={(event) => setClusterId(event.target.value)} value={clusterId}>
            {!single && <option value="KEEP">Не менять</option>}
            <option value="CLEAR">Без кластера</option>
            {clusters.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>{cluster.name}</option>
            ))}
          </CustomSelect>
        </label>
        {single ? (
          <label className="semantic-bulk-url">
            <span>Целевая URL</span>
            <input
              maxLength={2_048}
              onChange={(event) => {
                const value = event.target.value;
                setTargetUrl(value);
                setTargetUrlMode(value ? "SET" : "CLEAR");
              }}
              placeholder="https://example.com/page"
              type="url"
              value={targetUrl}
            />
          </label>
        ) : (
          <label>
            <span>Целевая URL</span>
            <CustomSelect
              onChange={(event) =>
                setTargetUrlMode(event.target.value as typeof targetUrlMode)
              }
              value={targetUrlMode}
            >
              <option value="KEEP">Не менять</option>
              <option value="CLEAR">Очистить</option>
              <option value="SET">Задать URL</option>
            </CustomSelect>
          </label>
        )}
        {!single && targetUrlMode === "SET" && (
          <label className="semantic-bulk-url">
            <span>Новая URL</span>
            <input
              onChange={(event) => setTargetUrl(event.target.value)}
              required
              type="url"
              value={targetUrl}
            />
          </label>
        )}
        <label className="semantic-bulk-tags">
          <span>
            {!single && (
              <input
                checked={replaceTags}
                onChange={(event) => setReplaceTags(event.target.checked)}
                type="checkbox"
              />
            )}
            {single ? "Теги через запятую" : "Заменить теги"}
          </span>
          <input
            disabled={!replaceTags}
            onChange={(event) => setTagNames(event.target.value)}
            placeholder="Важно, Услуги (пусто — удалить все)"
            value={tagNames}
          />
        </label>
      </div>
      {!single && (
        <>
      <details className="semantic-bulk-split">
        <summary>
          <span>Выделить в новый кластер</span>
          <small>
            {sourceCluster
              ? `Из «${sourceCluster.name}» · ${selections.length} запросов`
              : "Выберите запросы одного кластера"}
          </small>
        </summary>
        <div className="semantic-bulk-split-body">
          <label>
            <span>Название нового кластера</span>
            <input
              disabled={!sourceCluster || splitSaving}
              maxLength={255}
              onChange={(event) => {
                setSplitName(event.target.value);
                setSplitPreview(undefined);
              }}
              placeholder="Например, Купить ноутбук"
              value={splitName}
            />
          </label>
          <div className="semantic-bulk-split-options">
            <label>
              <input
                checked={splitLocked}
                disabled={!sourceCluster || splitSaving}
                onChange={(event) => {
                  setSplitLocked(event.target.checked);
                  setSplitPreview(undefined);
                }}
                type="checkbox"
              />
              Зафиксировать
            </label>
            <label>
              <input
                checked={splitExcluded}
                disabled={!sourceCluster || splitSaving}
                onChange={(event) => {
                  setSplitExcluded(event.target.checked);
                  setSplitPreview(undefined);
                }}
                type="checkbox"
              />
              Исключить из автокластеризации
            </label>
          </div>
          {splitPreview && (
            <div
              className={`inline-alert ${splitPreview.readiness === "READY" ? "success" : "danger"}`}
              role="status"
            >
              {splitPreview.readiness === "READY"
                ? `Готово к переносу: ${splitPreview.movableKeywordCount} из ${splitPreview.sourceKeywordCount} запросов исходного кластера.`
                : splitPreview.sourceWouldBeEmpty
                  ? "Нельзя перенести весь кластер: переименуйте его или оставьте хотя бы один запрос."
                  : splitPreview.duplicateName
                    ? "Кластер с таким названием уже существует."
                    : splitPreview.readiness === "BACKGROUND_REQUIRED"
                      ? `Для переноса более ${splitPreview.synchronousKeywordLimit} запросов нужна фоновая задача.`
                      : "Часть запросов или исходный кластер изменилась. Обновите таблицу и повторите preview."}
              {splitPreview.sourceLocked && (
                <span> Исходный кластер зафиксирован; ручное действие разрешено.</span>
              )}
            </div>
          )}
          {splitError && (
            <div className="inline-alert danger" role="alert">{splitError}</div>
          )}
          <div className="semantic-editor-actions">
            <button
              className="secondary-button"
              disabled={!sourceCluster || !splitName.trim() || splitSaving}
              onClick={() => void previewClusterSplit()}
              type="button"
            >
              {splitSaving ? "Проверяем…" : "Проверить"}
            </button>
            <button
              className="primary-button"
              disabled={splitPreview?.readiness !== "READY" || splitSaving}
              onClick={() => void applyClusterSplit()}
              type="button"
            >
              Выделить кластер
            </button>
          </div>
        </div>
      </details>
      <details className="semantic-bulk-split">
        <summary>
          <span>Очистить запросы</span>
          <small>Preview, проверка дублей и отмена через историю</small>
        </summary>
        <div className="semantic-bulk-split-body">
          <div className="semantic-cleaning-options">
            <label>
              <span>Регистр</span>
              <CustomSelect
                disabled={Boolean(cleaningBusy)}
                onChange={(event) => {
                  setCleaningCase(
                    event.target.value as SemanticKeywordCleaningCase
                  );
                  invalidateCleaning();
                }}
                value={cleaningCase}
              >
                <option value="KEEP">Не менять</option>
                <option value="LOWER">строчные</option>
                <option value="UPPER">ПРОПИСНЫЕ</option>
              </CustomSelect>
            </label>
            <label>
              <input
                checked={collapseWhitespace}
                disabled={Boolean(cleaningBusy)}
                onChange={(event) => {
                  setCollapseWhitespace(event.target.checked);
                  invalidateCleaning();
                }}
                type="checkbox"
              />
              Пробелы
            </label>
            <label>
              <input
                checked={normalizeQuotes}
                disabled={Boolean(cleaningBusy)}
                onChange={(event) => {
                  setNormalizeQuotes(event.target.checked);
                  invalidateCleaning();
                }}
                type="checkbox"
              />
              Кавычки
            </label>
            <label>
              <input
                checked={normalizeDashes}
                disabled={Boolean(cleaningBusy)}
                onChange={(event) => {
                  setNormalizeDashes(event.target.checked);
                  invalidateCleaning();
                }}
                type="checkbox"
              />
              Дефисы
            </label>
            <label>
              <input
                checked={normalizeYo}
                disabled={Boolean(cleaningBusy)}
                onChange={(event) => {
                  setNormalizeYo(event.target.checked);
                  invalidateCleaning();
                }}
                type="checkbox"
              />
              Ё → Е
            </label>
            <label>
              <input
                checked={removeSearchOperators}
                disabled={Boolean(cleaningBusy)}
                onChange={(event) => {
                  setRemoveSearchOperators(event.target.checked);
                  invalidateCleaning();
                }}
                type="checkbox"
              />
              Удалить операторы
            </label>
          </div>
          {cleaningPreview && (
            <div className="semantic-cleaning-preview" role="status">
              <div className="semantic-cluster-bulk-preview">
                <span>
                  <strong>{cleaningPreview.applicable}</strong> изменятся
                </span>
                <span>
                  <strong>{cleaningPreview.unchanged}</strong> без изменений
                </span>
                <span className={cleaningPreview.conflicted > 0 ? "danger" : ""}>
                  <strong>{cleaningPreview.conflicted}</strong> конфликтов
                </span>
                <span className={cleaningPreview.failed > 0 ? "danger" : ""}>
                  <strong>{cleaningPreview.failed}</strong> ошибок/дублей
                </span>
              </div>
              <div className="semantic-cleaning-preview-list">
                {cleaningPreview.changes
                  .filter(({ state }) => state !== "UNCHANGED")
                  .slice(0, 8)
                  .map((change) => (
                    <div key={change.keywordId}>
                      <span>{change.beforeText ?? "Запрос недоступен"}</span>
                      <strong aria-hidden="true">→</strong>
                      <span>{change.afterText ?? cleaningStateLabel(change.state)}</span>
                      {change.state !== "APPLICABLE" && (
                        <small>{cleaningStateLabel(change.state)}</small>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
          {cleaningError && (
            <div className="inline-alert danger" role="alert">
              {cleaningError}
            </div>
          )}
          <div className="semantic-editor-actions">
            <button
              className="secondary-button"
              disabled={!hasCleaningRule || Boolean(cleaningBusy)}
              onClick={() => void previewCleaning()}
              type="button"
            >
              {cleaningBusy === "PREVIEW" ? "Проверяем…" : "Проверить очистку"}
            </button>
            <button
              className="primary-button"
              disabled={!cleaningPreview?.applicable || Boolean(cleaningBusy)}
              onClick={() => void applyCleaning()}
              type="button"
            >
              {cleaningBusy === "APPLY"
                ? "Применяем…"
                : `Применить ${cleaningPreview?.applicable ?? 0}`}
            </button>
          </div>
        </div>
      </details>
        </>
      )}
      {error && (
        <div className="inline-alert danger" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="inline-alert success" role="status">
          Изменено: {result.changed}; конфликтов: {result.conflicted};
          пропущено: {result.skipped}; ошибок: {result.failed}.
        </div>
      )}
      <div className="semantic-editor-actions">
        <button
          className="secondary-button"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Отмена
        </button>
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? "Применяем…" : "Применить"}
        </button>
      </div>
    </form>
  );
}

function parseTags(value: string): readonly string[] {
  return [
    ...new Map(
      value
        .split(",")
        .map((tag) => tag.normalize("NFKC").trim())
        .filter(Boolean)
        .map((tag) => [tag.toLocaleLowerCase(), tag] as const)
    ).values()
  ].slice(0, 50);
}

function singleKeywordPatch(
  initial: BulkSelection,
  values: Readonly<{
    text: string;
    language: string;
    priority: string;
    favorite: "KEEP" | "YES" | "NO";
    tracked: "KEEP" | "YES" | "NO";
    intent: "KEEP" | "CLEAR" | BulkIntent;
    groupId: string;
    clusterId: string;
    targetUrl: string;
    tagNames: readonly string[];
  }>
): UpdateSemanticKeywordInput {
  const text = values.text.normalize("NFKC").trim();
  const language = values.language.normalize("NFKC").trim();
  const priority = Number(values.priority);
  const intent = values.intent === "CLEAR"
    ? null
    : values.intent === "KEEP"
      ? (initial.intent ?? null)
      : values.intent;
  const groupId = values.groupId === "CLEAR"
    ? null
    : values.groupId === "KEEP"
      ? (initial.groupId ?? null)
      : values.groupId;
  const clusterId = values.clusterId === "CLEAR"
    ? null
    : values.clusterId === "KEEP"
      ? (initial.clusterId ?? null)
      : values.clusterId;
  const targetUrl = values.targetUrl.normalize("NFKC").trim() || null;
  const initialTags = parseTags(initial.tags.join(","));
  return {
    ...(text === initial.text ? {} : { text }),
    ...(language === initial.language ? {} : { language }),
    ...(priority === initial.priority ? {} : { priority }),
    ...(values.favorite === (initial.isFavorite ? "YES" : "NO")
      ? {}
      : { isFavorite: values.favorite === "YES" }),
    ...(values.tracked === (initial.isTracked ? "YES" : "NO")
      ? {}
      : { isTracked: values.tracked === "YES" }),
    ...(intent === (initial.intent ?? null) ? {} : { intent }),
    ...(groupId === (initial.groupId ?? null) ? {} : { groupId }),
    ...(clusterId === (initial.clusterId ?? null) ? {} : { clusterId }),
    ...(targetUrl === (initial.targetUrl ?? null) ? {} : { targetUrl }),
    ...(sameTags(values.tagNames, initialTags)
      ? {}
      : { tagNames: values.tagNames })
  };
}

async function updateSingleKeyword(
  projectId: string,
  selection: BulkSelection,
  patch: UpdateSemanticKeywordInput
): Promise<BulkResult> {
  await browserApiRequest<unknown>(
    `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(selection.id)}`,
    { method: "PATCH", body: patch, ifMatch: selection.version }
  );
  return {
    selected: 1,
    changed: 1,
    skipped: 0,
    failed: 0,
    conflicted: 0
  };
}

async function updateKeywordsInBatches(
  projectId: string,
  selections: readonly BulkSelection[],
  patch: unknown
): Promise<BulkResult> {
  let result: BulkResult = {
    selected: 0,
    changed: 0,
    skipped: 0,
    failed: 0,
    conflicted: 0
  };
  for (const batch of semanticBulkSelectionBatches(
    selections,
    semanticKeywordBulkCommandMaxItems
  )) {
    const batchResult = await browserApiRequest<BulkResult>(
      `/app/api/projects/${encodeURIComponent(projectId)}/bulk-commands`,
      {
        method: "POST",
        body: {
          items: batch.map(({ id, version }) => ({ id, version })),
          patch
        }
      }
    );
    result = {
      selected: result.selected + batchResult.selected,
      changed: result.changed + batchResult.changed,
      skipped: result.skipped + batchResult.skipped,
      failed: result.failed + batchResult.failed,
      conflicted: result.conflicted + batchResult.conflicted
    };
  }
  return result;
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function cleaningStateLabel(
  state: SemanticKeywordCleaningPreview["changes"][number]["state"]
): string {
  const labels = {
    APPLICABLE: "Готово",
    UNCHANGED: "Без изменений",
    CONFLICTED: "Версия изменилась",
    UNAVAILABLE: "Запрос недоступен",
    DUPLICATE: "Будет создан дубль",
    INVALID: "После очистки запрос пуст или слишком длинный"
  } as const;
  return labels[state];
}

function bulkErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "FORBIDDEN") {
      return "У вас нет права на массовое изменение семантики.";
    }
    if (error.code === "VALIDATION_FAILED") {
      return error.fieldErrors[0]?.message ?? "Проверьте параметры изменения.";
    }
    return error.message;
  }
  return "Не удалось выполнить массовое изменение.";
}
