"use client";

import { CustomSelect } from "./custom-select";
import { ChoiceToggle } from "./choice-toggle";
import { KeywordTagPicker } from "./keyword-tag-picker";
import { LanguageSelect } from "./locale-selects";
import { keywordTagChanges, keywordTagKey, uniqueKeywordTags } from "../lib/keyword-tags";
import {
  SemanticGroupPickerField,
  type SemanticGroupPickerSpecialOption
} from "./semantic-group-picker";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";

import {
  type SemanticKeywordCleaningCase,
  type SemanticKeywordCleaningPreview,
  type SemanticKeywordListItem,
  type SemanticKeywordMergeResult,
  type UpdateSemanticKeywordInput
} from "@seo-platform/contracts";
import { useMemo, useState, type FormEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError,
  browserApiCollectionRequest
} from "../lib/browser-api";
import {
  cleanSemanticKeywordsInBatches,
  previewSemanticKeywordCleaningInBatches,
  updateSemanticKeywordsInBatches
} from "../lib/semantic-keyword-bulk";
import { UiText, useUiLocale } from "./ui-locale";


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
  const { t: uiText } = useUiLocale();
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
  const [targetUrl, setTargetUrl] = useState(single?.targetUrl ?? "");
  const [clearTargetUrl, setClearTargetUrl] = useState(false);
  const [tagNames, setTagNames] = useState<readonly string[]>(single?.tags ?? []);
  const [removeTagNames, setRemoveTagNames] = useState<readonly string[]>([]);
  const selectedTagNames = useMemo(
    () => uniqueKeywordTags(selections.flatMap(selection => selection.tags)),
    [selections]
  );
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
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeResults, setMergeResults] = useState<readonly SemanticKeywordListItem[]>([]);
  const [mergeCandidate, setMergeCandidate] = useState<SemanticKeywordListItem>();
  const [mergeKeeper, setMergeKeeper] = useState<"CURRENT" | "CANDIDATE">("CANDIDATE");
  const [mergeBusy, setMergeBusy] = useState<"SEARCH" | "APPLY">();
  const [mergeError, setMergeError] = useState<string>();
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

  async function searchMergeCandidates(): Promise<void> {
    if (!single || !mergeSearch.trim() || mergeBusy) return;
    setMergeBusy("SEARCH");
    setMergeError(undefined);
    try {
      const page = await browserApiCollectionRequest<SemanticKeywordListItem>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords?limit=20&search=${encodeURIComponent(mergeSearch.trim())}`
      );
      setMergeResults(page.data.filter(({ id, trashed }) => id !== single.id && !trashed));
    } catch (requestError) {
      setMergeError(bulkErrorMessage(requestError));
    } finally {
      setMergeBusy(undefined);
    }
  }

  async function mergeKeyword(): Promise<void> {
    if (!single || !mergeCandidate || mergeBusy) return;
    const keeper = mergeKeeper === "CURRENT" ? single : mergeCandidate;
    const merged = mergeKeeper === "CURRENT" ? mergeCandidate : single;
    setMergeBusy("APPLY");
    setMergeError(undefined);
    try {
      await browserApiRequest<SemanticKeywordMergeResult>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/merge`,
        {
          method: "POST",
          body: {
            keeper: { id: keeper.id, version: keeper.version },
            sources: [{ id: merged.id, version: merged.version }]
          }
        }
      );
      onCompleted({
        selected: 2,
        changed: 2,
        skipped: 0,
        failed: 0,
        conflicted: 0
      });
    } catch (requestError) {
      setMergeError(bulkErrorMessage(requestError));
    } finally {
      setMergeBusy(undefined);
    }
  }

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
        await previewSemanticKeywordCleaningInBatches(
          projectId,
          selections,
          cleaningRules
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
        await cleanSemanticKeywordsInBatches(
          projectId,
          selections,
          cleaningRules
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
    const nextTags = uniqueKeywordTags(tagNames);
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
          ...(clearTargetUrl
            ? { targetUrl: null }
            : targetUrl.normalize("NFKC").trim()
              ? { targetUrl: targetUrl.normalize("NFKC").trim() }
              : {}),
          ...(nextTags.length ? { addTagNames: nextTags } : {}),
          ...(removeTagNames.length ? { removeTagNames } : {})
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
        : await updateSemanticKeywordsInBatches(projectId, selections, patch);
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
            {single ? <UiText text="Свойства запроса" /> : <UiText text="Выбрано запросов: {0}" values={[String(selections.length)]} />}
          </strong>
          <span>
            {single
              ? <UiText text="Измените нужные значения в одной форме." />
              : <UiText text="Поля со значением «Не менять» останутся без изменений." />}
          </span>
        </div>
      </div>
      <div className="semantic-bulk-grid">
        {single && (
          <>
            <label className="semantic-bulk-query">
              <span><UiText text="Запрос" /></span>
              <input
                autoFocus
                maxLength={2_000}
                onChange={(event) => setText(event.target.value)}
                required
                value={text}
              />
            </label>
            <label className="semantic-bulk-language">
              <span><UiText text="Язык" /></span>
              <LanguageSelect
                onChange={(event) => setLanguage(event.target.value)}
                required
                value={language}
              />
            </label>
          </>
        )}
        <label className="semantic-bulk-priority">
          <span><UiText text="Приоритет" /></span>
          <input
            max={100}
            min={0}
            onChange={(event) => setPriority(event.target.value)}
            placeholder={uiText("Не менять")}
            required={Boolean(single)}
            type="number"
            value={priority}
          />
        </label>
        <div className="semantic-bulk-choice semantic-bulk-favorite">
          <span><UiText text="Избранное" /></span>
          <ChoiceToggle
            ariaLabel={uiText("Избранное")}
            onChange={setFavorite}
            options={single
              ? [
                  { value: "YES", label: uiText("Да") },
                  { value: "NO", label: uiText("Нет") }
                ]
              : [
                  { value: "KEEP", label: uiText("Не менять") },
                  { value: "YES", label: uiText("Добавить") },
                  { value: "NO", label: uiText("Убрать") }
                ]}
            value={favorite}
          />
        </div>
        <div className="semantic-bulk-choice semantic-bulk-tracked">
          <span><UiText text="Отслеживается" /></span>
          <ChoiceToggle
            ariaLabel={uiText("Отслеживается")}
            onChange={setTracked}
            options={single
              ? [
                  { value: "YES", label: uiText("Да") },
                  { value: "NO", label: uiText("Нет") }
                ]
              : [
                  { value: "KEEP", label: uiText("Не менять") },
                  { value: "YES", label: uiText("Да") },
                  { value: "NO", label: uiText("Нет") }
                ]}
            value={tracked}
          />
        </div>
        <label className="semantic-bulk-intent">
          <span><UiText text="Интент" /></span>
          <CustomSelect
            onChange={(event) =>
              setIntent(event.target.value as typeof intent)
            }
            value={intent}
          >
            {!single && <option value="KEEP"><UiText text="Не менять" /></option>}
            <option value="CLEAR">{single ? <UiText text="Не задан" /> : <UiText text="Очистить" />}</option>
            <option value="INFORMATIONAL"><UiText text="Информационный" /></option>
            <option value="NAVIGATIONAL"><UiText text="Навигационный" /></option>
            <option value="COMMERCIAL"><UiText text="Коммерческий" /></option>
            <option value="TRANSACTIONAL"><UiText text="Транзакционный" /></option>
            <option value="LOCAL"><UiText text="Локальный" /></option>
            <option value="MIXED"><UiText text="Смешанный" /></option>
          </CustomSelect>
        </label>
        <label className="semantic-bulk-group">
          <span><UiText text="Группа" /></span>
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
          <span><UiText text="Кластер" /></span>
          <CustomSelect onChange={(event) => setClusterId(event.target.value)} value={clusterId}>
            {!single && <option value="KEEP"><UiText text="Не менять" /></option>}
            <option value="CLEAR"><UiText text="Без кластера" /></option>
            {clusters.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>{cluster.name}</option>
            ))}
          </CustomSelect>
        </label>
        <div className="semantic-bulk-url semantic-bulk-url-field">
          <label htmlFor="semantic-bulk-target-url"><UiText text="Целевой URL" /></label>
          <input
            id="semantic-bulk-target-url"
            disabled={!single && clearTargetUrl}
            maxLength={2_048}
            onChange={(event) => {
              setTargetUrl(event.target.value);
              if (event.target.value) setClearTargetUrl(false);
            }}
            placeholder={single ? "https://example.com/page" : uiText("Оставьте пустым, чтобы не менять")}
            type="url"
            value={targetUrl}
          />
          {!single && (
            <label className="semantic-bulk-clear-url">
              <input
                checked={clearTargetUrl}
                onChange={(event) => {
                  setClearTargetUrl(event.target.checked);
                  if (event.target.checked) setTargetUrl("");
                }}
                type="checkbox"
              />
              <span><UiText text="Очистить у выбранных" /></span>
            </label>
          )}
        </div>
      </div>
      <div className={`semantic-bulk-tags${single ? "" : " has-removal"}`}>
        <KeywordTagPicker
          projectId={projectId}
          value={tagNames}
          onChange={tags => {
            setTagNames(tags);
            const additions = new Set(tags.map(keywordTagKey));
            setRemoveTagNames(current => current.filter(tag => !additions.has(keywordTagKey(tag))));
          }}
          disabled={saving}
          mode={single ? "edit" : "add"}
        />
        {!single && <KeywordTagPicker
          projectId={projectId}
          value={removeTagNames}
          onChange={tags => {
            setRemoveTagNames(tags);
            const removals = new Set(tags.map(keywordTagKey));
            setTagNames(current => current.filter(tag => !removals.has(keywordTagKey(tag))));
          }}
          disabled={saving}
          mode="remove"
          availableTags={selectedTagNames}
        />}
      </div>
      {single && (
        <details className="semantic-bulk-merge">
          <summary>
            <span><UiText text="Объединить с другим запросом" /></span>
            <small><UiText text="История, папки, теги и значения сохранятся у выбранного запроса" /></small>
          </summary>
          <div className="semantic-bulk-merge-body">
            <div className="semantic-bulk-merge-search">
              <input
                disabled={Boolean(mergeBusy)}
                onChange={(event) => {
                  setMergeSearch(event.target.value);
                  setMergeCandidate(undefined);
                }}
                placeholder="Найдите второй запрос по названию"
                type="search"
                value={mergeSearch}
              />
              <button className="secondary-button" disabled={!mergeSearch.trim() || Boolean(mergeBusy)} onClick={() => void searchMergeCandidates()} type="button">
                {mergeBusy === "SEARCH" ? <UiText text="Ищем…" /> : <UiText text="Найти" />}
              </button>
            </div>
            {mergeResults.length > 0 && (
              <div className="semantic-bulk-merge-results">
                {mergeResults.map((candidate) => (
                  <button className={mergeCandidate?.id === candidate.id ? "selected" : undefined} key={candidate.id} onClick={() => setMergeCandidate(candidate)} type="button">
                    <strong>{candidate.textOriginal}</strong>
                    <small>{candidate.groupPath ?? "Без группы"}</small>
                  </button>
                ))}
              </div>
            )}
            {mergeCandidate && (
              <fieldset>
                <legend><UiText text="Какое название сохранить" /></legend>
                <label className={mergeKeeper === "CURRENT" ? "selected" : undefined}>
                  <input checked={mergeKeeper === "CURRENT"} name={`single-merge-${single.id}`} onChange={() => setMergeKeeper("CURRENT")} type="radio" />
                  <span><small><UiText text="Текущий запрос" /></small><strong>{single.text}</strong></span>
                </label>
                <label className={mergeKeeper === "CANDIDATE" ? "selected" : undefined}>
                  <input checked={mergeKeeper === "CANDIDATE"} name={`single-merge-${single.id}`} onChange={() => setMergeKeeper("CANDIDATE")} type="radio" />
                  <span><small><UiText text="Найденный запрос" /></small><strong>{mergeCandidate.textOriginal}</strong></span>
                </label>
              </fieldset>
            )}
            {mergeError && <div className="inline-alert danger" role="alert">{mergeError}</div>}
            <div className="semantic-editor-actions">
              <button className="danger-button" disabled={!mergeCandidate || Boolean(mergeBusy)} onClick={() => void mergeKeyword()} type="button">
                {mergeBusy === "APPLY" ? <UiText text="Объединяем…" /> : <UiText text="Объединить запросы" />}
              </button>
            </div>
          </div>
        </details>
      )}
      {!single && (
        <>
      <details className="semantic-bulk-split">
        <summary>
          <span><UiText text="Выделить в новый кластер" /></span>
          <small>
            {sourceCluster
              ? <UiText text="Из «{0}» · {1} запросов" values={[String(sourceCluster.name), String(selections.length)]} />
              : <UiText text="Выберите запросы одного кластера" />}
          </small>
        </summary>
        <div className="semantic-bulk-split-body">
          <label>
            <span><UiText text="Название нового кластера" /></span>
            <input
              disabled={!sourceCluster || splitSaving}
              maxLength={255}
              onChange={(event) => {
                setSplitName(event.target.value);
                setSplitPreview(undefined);
              }}
              placeholder={uiText("Например, Купить ноутбук")}
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
              <UiText text="Зафиксировать" /></label>
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
              <UiText text="Исключить из автокластеризации" /></label>
          </div>
          {splitPreview && (
            <div
              className={`inline-alert ${splitPreview.readiness === "READY" ? "success" : "danger"}`}
              role="status"
            >
              {splitPreview.readiness === "READY"
                ? <UiText text="Готово к переносу: {0} из {1} запросов исходного кластера." values={[String(splitPreview.movableKeywordCount), String(splitPreview.sourceKeywordCount)]} />
                : splitPreview.sourceWouldBeEmpty
                  ? <UiText text="Нельзя перенести весь кластер: переименуйте его или оставьте хотя бы один запрос." />
                  : splitPreview.duplicateName
                    ? <UiText text="Кластер с таким названием уже существует." />
                    : splitPreview.readiness === "BACKGROUND_REQUIRED"
                      ? <UiText text="Для переноса более {0} запросов нужна фоновая задача." values={[String(splitPreview.synchronousKeywordLimit)]} />
                      : <UiText text="Часть запросов или исходный кластер изменилась. Обновите таблицу и повторите preview." />}
              {splitPreview.sourceLocked && (
                <span> <UiText text="Исходный кластер зафиксирован; ручное действие разрешено." before=" " /></span>
              )}
            </div>
          )}
          {splitError && (
            <div className="inline-alert danger" role="alert">{<UiText text={splitError ?? ""} />}</div>
          )}
          <div className="semantic-editor-actions">
            <button
              className="secondary-button"
              disabled={!sourceCluster || !splitName.trim() || splitSaving}
              onClick={() => void previewClusterSplit()}
              type="button"
            >
              {splitSaving ? <UiText text="Проверяем…" /> : <UiText text="Проверить" />}
            </button>
            <button
              className="primary-button"
              disabled={splitPreview?.readiness !== "READY" || splitSaving}
              onClick={() => void applyClusterSplit()}
              type="button"
            >
              <UiText text="Выделить кластер" /></button>
          </div>
        </div>
      </details>
      <details className="semantic-bulk-split">
        <summary>
          <span><UiText text="Очистить запросы" /></span>
          <small><UiText text="Preview, проверка дублей и отмена через историю" /></small>
        </summary>
        <div className="semantic-bulk-split-body">
          <div className="semantic-cleaning-options">
            <label>
              <span><UiText text="Регистр" /></span>
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
                <option value="KEEP"><UiText text="Не менять" /></option>
                <option value="LOWER"><UiText text="строчные" /></option>
                <option value="UPPER"><UiText text="ПРОПИСНЫЕ" /></option>
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
              <UiText text="Пробелы" /></label>
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
              <UiText text="Кавычки" /></label>
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
              <UiText text="Дефисы" /></label>
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
              <UiText text="Ё → Е" /></label>
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
              <UiText text="Удалить операторы" /></label>
          </div>
          {cleaningPreview && (
            <div className="semantic-cleaning-preview" role="status">
              <div className="semantic-cluster-bulk-preview">
                <span>
                  <strong>{cleaningPreview.applicable}</strong> <UiText text="изменятся" before=" " /></span>
                <span>
                  <strong>{cleaningPreview.unchanged}</strong> <UiText text="без изменений" before=" " /></span>
                <span className={cleaningPreview.conflicted > 0 ? "danger" : ""}>
                  <strong>{cleaningPreview.conflicted}</strong> <UiText text="конфликтов" before=" " /></span>
                <span className={cleaningPreview.failed > 0 ? "danger" : ""}>
                  <strong>{cleaningPreview.failed}</strong> <UiText text="ошибок/дублей" before=" " /></span>
              </div>
              <div className="semantic-cleaning-preview-list">
                {cleaningPreview.changes
                  .filter(({ state }) => state !== "UNCHANGED")
                  .slice(0, 8)
                  .map((change) => (
                    <div key={change.keywordId}>
                      <span>{change.beforeText ?? <UiText text="Запрос недоступен" />}</span>
                      <strong aria-hidden="true">→</strong>
                      <span>{change.afterText ?? cleaningStateLabel(change.state)}</span>
                      {change.state !== "APPLICABLE" && (
                        <small>{<UiText text={cleaningStateLabel(change.state) ?? ""} />}</small>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
          {cleaningError && (
            <div className="inline-alert danger" role="alert">
              {<UiText text={cleaningError ?? ""} />}
            </div>
          )}
          <div className="semantic-editor-actions">
            <button
              className="secondary-button"
              disabled={!hasCleaningRule || Boolean(cleaningBusy)}
              onClick={() => void previewCleaning()}
              type="button"
            >
              {cleaningBusy === "PREVIEW" ? <UiText text="Проверяем…" /> : <UiText text="Проверить очистку" />}
            </button>
            <button
              className="primary-button"
              disabled={!cleaningPreview?.applicable || Boolean(cleaningBusy)}
              onClick={() => void applyCleaning()}
              type="button"
            >
              {cleaningBusy === "APPLY"
                ? <UiText text="Применяем…" />
                : <UiText text="Применить {0}" values={[String(cleaningPreview?.applicable ?? 0)]} />}
            </button>
          </div>
        </div>
      </details>
        </>
      )}
      {error && (
        <div className="inline-alert danger" role="alert">
          {<UiText text={error ?? ""} />}
        </div>
      )}
      {result && (
        <div className="inline-alert success" role="status">
          <UiText text="Изменено:" after=" " />{result.changed}<UiText text="; конфликтов:" after=" " />{result.conflicted}<UiText text="; пропущено:" after=" " />{result.skipped}<UiText text="; ошибок:" after=" " />{result.failed}.
        </div>
      )}
      <div className="semantic-editor-actions">
        <button
          className="secondary-button"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          <UiText text="Отмена" /></button>
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? <UiText text="Применяем…" /> : <UiText text="Применить" />}
        </button>
      </div>
    </form>
  );
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
    ...keywordTagChanges(initial.tags, values.tagNames)
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
