"use client";

import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import type { IconName } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SearchableRegionSelect } from "./searchable-region-select";
import { LanguageSelect } from "./locale-selects";
import {
  semanticImportTargets,
  semanticPositionHistoryHeaderDate,
  type SemanticImportPreviewRow,
  type SemanticImportPreviewRowsPage,
  type SemanticPositionHistoryImportOptions,
  type SemanticImportTarget
} from "@seo-platform/contracts";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type UIEvent
} from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { UiText, useUiLocale } from "./ui-locale";


interface UploadSummary {
  readonly id: string;
  readonly status: string;
  readonly originalName: string;
  readonly sizeBytes: string;
  readonly checksumSha256?: string;
  readonly rejectionCode?: string;
}

interface CreatedMultipartUpload {
  readonly upload: UploadSummary;
  readonly partSizeBytes: number;
  readonly partCount: number;
}

interface UploadPartUrls {
  readonly parts: readonly {
    readonly partNumber: number;
    readonly url: string;
  }[];
}

interface SemanticImportColumnPreview {
  readonly index: number;
  readonly sourceName: string;
  readonly suggestedTarget: string;
  readonly confidence: number;
}

interface SemanticImportPreview {
  readonly columns: readonly SemanticImportColumnPreview[];
  readonly sampleRows: readonly (readonly string[])[];
  readonly totalRows: string;
  readonly validRows: string;
  readonly warningRows: string;
  readonly errorRows: string;
}

interface SemanticImportMappingColumn {
  readonly sourceIndex: number;
  readonly target: string;
  readonly customName?: string;
}

interface SemanticImportValidation {
  readonly totalRows: string;
  readonly validRows: string;
  readonly warningRows: string;
  readonly errorRows: string;
  readonly duplicateRowsInFile: string;
  readonly existingKeywordsInProject: string;
  readonly newKeywordsSkipped: string;
  readonly uniqueKeywordsToProcess: string;
  readonly issueCounts: Readonly<Record<string, string>>;
}

interface SemanticImportResult {
  readonly partial: boolean;
  readonly semanticVersionId: string;
  readonly semanticVersionNumber: number;
  readonly createdKeywords: string;
  readonly updatedKeywords: string;
  readonly skippedKeywords: string;
  readonly createdGroups: string;
  readonly createdPages: string;
  readonly createdTags: string;
  readonly createdMetricSnapshots: string;
  readonly trashedDuplicateCandidates?: readonly Readonly<{
    keywordId: string;
    version: number;
    text: string;
    language: string;
  }>[];
  readonly trashedDuplicateCandidatesTruncated?: boolean;
}

interface SemanticImportSummary {
  readonly id: string;
  readonly uploadId: string;
  readonly status: string;
  readonly stage: string;
  readonly sourceFormat: string;
  readonly progressBytes: string;
  readonly totalBytes: string;
  readonly preview?: SemanticImportPreview;
  readonly mapping?: {
    readonly columns: readonly SemanticImportMappingColumn[];
    readonly defaultLanguage: string;
    readonly groupSeparator: string;
    readonly duplicatePolicy: string;
    readonly createMissingKeywords: boolean;
    readonly positionHistory?: SemanticPositionHistoryImportOptions;
  };
  readonly validation?: SemanticImportValidation;
  readonly result?: SemanticImportResult;
  readonly failureCode?: string;
  readonly version: number;
}

interface StoredUploadSession {
  readonly uploadId: string;
  readonly idempotencyKey: string;
  readonly partSizeBytes: number;
  readonly partCount: number;
  readonly completed: Readonly<Record<string, string>>;
}

type UploadStage =
  | "idle"
  | "preparing"
  | "uploading"
  | "completing"
  | "scanning"
  | "parsing"
  | "validating"
  | "validation-ready"
  | "publishing"
  | "finalizing"
  | "import-pending"
  | "preview"
  | "import-failed"
  | "publish-failed"
  | "uploaded"
  | "ready"
  | "completed"
  | "rejected"
  | "cancelled";

type SemanticImportSource =
  | "KEY_COLLECTOR"
  | "TOPVISOR"
  | "UNIVERSAL"
  | "POSITIONS";

interface SemanticImportSourceOption {
  accept: string;
  badge?: string;
  description: string;
  disabled?: boolean;
  icon?: IconName;
  label: string;
  value: SemanticImportSource;
}

const IMPORT_SOURCES: readonly Readonly<SemanticImportSourceOption>[] = [
  {
    value: "KEY_COLLECTOR",
    label: "Key Collector",
    description: "Нативный проект .kc4: дерево, цвета, заметки, метрики и позиции",
    badge: "KC",
    accept: ".kc4"
  },
  {
    value: "UNIVERSAL",
    label: "Файл",
    description: "Универсальный CSV, TSV или XLSX с сопоставлением колонок",
    icon: "import",
    accept: ".csv,.tsv,.xlsx"
  },
  {
    value: "POSITIONS",
    label: "Позиции",
    description: "Таблица по датам или строки «запрос · дата · позиция»",
    icon: "positions",
    accept: ".csv,.tsv,.xlsx"
  },
  {
    value: "TOPVISOR",
    label: "Топвизор",
    description: "Запросы, группы, теги, URL и позиции из экспорта",
    disabled: true,
    badge: "T",
    accept: ".csv,.tsv,.xlsx"
  }
];

const MAX_CONCURRENCY = 3;
const INSPECTION_TIMEOUT_MS = 30 * 60 * 1_000;
const SEMANTIC_IMPORT_TRACKING_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export function SemanticUpload({
  onBusyChange,
  onExpandedChange,
  projectId,
  onPublished
}: Readonly<{
  onBusyChange?: (busy: boolean) => void;
  onExpandedChange?: (expanded: boolean) => void;
  projectId: string;
  onPublished?: (result: SemanticImportResult) => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [source, setSource] = useState<SemanticImportSource>("KEY_COLLECTOR");
  const [file, setFile] = useState<File>();
  const [stage, setStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [importPreview, setImportPreview] =
    useState<SemanticImportPreview>();
  const [mappingColumns, setMappingColumns] = useState<
    readonly SemanticImportMappingColumn[]
  >([]);
  const [duplicatePolicy, setDuplicatePolicy] =
    useState("MERGE_NON_EMPTY");
  const [createMissingKeywords, setCreateMissingKeywords] = useState(true);
  const [defaultLanguage, setDefaultLanguage] = useState("ru");
  const [groupSeparator, setGroupSeparator] = useState("/");
  const [positionHistory, setPositionHistory] = useState<SemanticPositionHistoryImportOptions>();
  const [validation, setValidation] =
    useState<SemanticImportValidation>();
  const [importResult, setImportResult] =
    useState<SemanticImportResult>();
  const [importVersion, setImportVersion] = useState<number>();
  const [completedUploadId, setCompletedUploadId] = useState<string>();
  const [completedImportId, setCompletedImportId] = useState<string>();
  const [activeImportSourceFormat, setActiveImportSourceFormat] =
    useState<string>();
  const [previewSort, setPreviewSort] = useState<Readonly<{
    columnIndex: number;
    direction: "ASC" | "DESC";
  }>>();
  const [previewRows, setPreviewRows] = useState<
    readonly SemanticImportPreviewRow[]
  >([]);
  const [previewRowsPage, setPreviewRowsPage] = useState<
    SemanticImportPreviewRowsPage["page"]
  >();
  const [previewRowsLoading, setPreviewRowsLoading] = useState(false);
  const [previewRowsLoaded, setPreviewRowsLoaded] = useState(false);
  const [previewRowsError, setPreviewRowsError] = useState<string>();
  const [previewReloadNonce, setPreviewReloadNonce] = useState(0);
  const previewRowsRequest = useRef<AbortController | undefined>(undefined);
  const previewTable = useRef<HTMLDivElement | null>(null);
  const activeRequests = useRef(new Set<XMLHttpRequest>());
  const backgroundRequest = useRef<AbortController | undefined>(undefined);
  const cancelled = useRef(false);
  const notifiedSemanticVersions = useRef(new Set<string>());
  const busy = ![
    "idle",
    "uploaded",
    "import-pending",
    "preview",
    "validation-ready",
    "import-failed",
    "publish-failed",
    "ready",
    "completed",
    "rejected",
    "cancelled"
  ].includes(stage);
  const importInProgress = [
    "preparing",
    "uploading",
    "completing",
    "scanning",
    "parsing",
    "validating",
    "publishing",
    "finalizing",
    "import-pending"
  ].includes(stage);
  const closeProtectionRequired = importInProgress || (
    Boolean(file || completedImportId) &&
    !["completed", "rejected", "cancelled"].includes(stage)
  );
  const mappingWorkspaceActive = Boolean(importPreview) &&
    ["preview", "validating", "validation-ready", "publishing"].includes(stage);
  const automaticKeyCollectorActive =
    activeImportSourceFormat === "KC4" && importInProgress;
  const focusedWorkspaceActive =
    mappingWorkspaceActive || automaticKeyCollectorActive;
  const progressVisible = [
    "preparing",
    "uploading",
    "completing",
    "scanning",
    "parsing",
    "validating",
    "publishing",
    "finalizing",
    "import-pending",
    "uploaded"
  ].includes(stage);
  const expandedWorkspace = mappingWorkspaceActive || (
    activeImportSourceFormat !== "KC4" &&
    Boolean(importPreview || validation || importResult)
  );
  const visiblePreviewRows = previewRowsLoaded
    ? previewRows
    : (importPreview?.sampleRows ?? []).map((values, index) => ({
        rowNumber: String(index + 1),
        values
      }));
  const semanticCancellationStages: readonly UploadStage[] = [
    "parsing",
    "import-pending",
    "preview",
    "validating",
    "validation-ready",
    "publishing"
  ];
  const canCancel =
    ["preparing", "uploading"].includes(stage) ||
    (Boolean(completedImportId) &&
      semanticCancellationStages.includes(stage));
  const statusText = useMemo(
    () => uploadStatus(stage, progress),
    [stage, progress]
  );

  function notifyPublished(result: SemanticImportResult): void {
    if (notifiedSemanticVersions.current.has(result.semanticVersionId)) {
      return;
    }
    notifiedSemanticVersions.current.add(result.semanticVersionId);
    onPublished?.(result);
  }

  useEffect(() => {
    onBusyChange?.(closeProtectionRequired);
    return () => onBusyChange?.(false);
  }, [closeProtectionRequired, onBusyChange]);

  useEffect(() => {
    onExpandedChange?.(expandedWorkspace);
    return () => onExpandedChange?.(false);
  }, [expandedWorkspace, onExpandedChange]);

  useEffect(
    () => () => {
      backgroundRequest.current?.abort();
      previewRowsRequest.current?.abort();
    },
    []
  );

  useEffect(() => {
    previewRowsRequest.current?.abort();
    setPreviewRows([]);
    setPreviewRowsPage(undefined);
    setPreviewRowsError(undefined);
    setPreviewRowsLoaded(false);
    if (
      !["preview", "validating", "validation-ready", "publishing"].includes(stage) ||
      !completedImportId ||
      !importPreview ||
      positionHistory
    ) {
      setPreviewRowsLoading(false);
      return;
    }
    const controller = new AbortController();
    previewRowsRequest.current = controller;
    setPreviewRowsLoading(true);
    void fetchSemanticImportPreviewRows(
      projectId,
      completedImportId,
      previewSort,
      undefined,
      controller.signal
    ).then((page) => {
      if (controller.signal.aborted) return;
      setPreviewRows(page.rows);
      setPreviewRowsPage(page.page);
      setPreviewRowsLoaded(true);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setPreviewRowsError(
        "Не удалось загрузить строки предпросмотра. Повторите прокрутку или сортировку."
      );
    }).finally(() => {
      if (previewRowsRequest.current === controller) {
        previewRowsRequest.current = undefined;
        setPreviewRowsLoading(false);
      }
    });
    return () => controller.abort();
  }, [
    completedImportId,
    importPreview,
    positionHistory,
    previewSort,
    previewReloadNonce,
    projectId,
    stage
  ]);

  useEffect(() => {
    const importId = sessionStorage.getItem(activeImportKey(projectId));
    if (!importId) return;
    setCompletedImportId(importId);
    void trackSemanticImport(importId);
    // Recovery runs only when this project's importer is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function resetSelectedFile(selected?: File): void {
    backgroundRequest.current?.abort();
    sessionStorage.removeItem(activeImportKey(projectId));
    const nativeKeyCollector =
      selected?.name.toLowerCase().endsWith(".kc4") ?? false;
    setFile(selected);
    setStage("idle");
    setProgress(0);
    setProgressDetail(undefined);
    setCompletedUploadId(undefined);
    setCompletedImportId(undefined);
    setActiveImportSourceFormat(nativeKeyCollector ? "KC4" : undefined);
    setImportPreview(undefined);
    setPreviewSort(undefined);
    setMappingColumns([]);
    setDefaultLanguage("ru");
    setGroupSeparator("/");
    setPositionHistory(undefined);
    setDuplicatePolicy(
      nativeKeyCollector ? "OVERWRITE_MAPPED" : "MERGE_NON_EMPTY"
    );
    setCreateMissingKeywords(source !== "POSITIONS");
    setValidation(undefined);
    setImportResult(undefined);
    setImportVersion(undefined);
    setPreviewSort(undefined);
    setMessage(undefined);
    setError(undefined);
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>): void {
    resetSelectedFile(event.target.files?.[0]);
  }

  function chooseSource(nextSource: SemanticImportSource): void {
    const option = IMPORT_SOURCES.find(({ value }) => value === nextSource);
    if (busy || option?.disabled || nextSource === source) return;
    setSource(nextSource);
    backgroundRequest.current?.abort();
    sessionStorage.removeItem(activeImportKey(projectId));
    setFile(undefined);
    setStage("idle");
    setProgress(0);
    setProgressDetail(undefined);
    setCompletedUploadId(undefined);
    setCompletedImportId(undefined);
    setActiveImportSourceFormat(undefined);
    setImportPreview(undefined);
    setMappingColumns([]);
    setPreviewSort(undefined);
    setPositionHistory(undefined);
    setValidation(undefined);
    setImportResult(undefined);
    setImportVersion(undefined);
    setMessage(undefined);
    setError(undefined);
    setCreateMissingKeywords(nextSource !== "POSITIONS");
    setDuplicatePolicy(nextSource === "KEY_COLLECTOR" ? "OVERWRITE_MAPPED" : "MERGE_NON_EMPTY");
  }

  async function trackSemanticImport(
    importId: string,
    activeStage: "parsing" | "validating" | "publishing" = "parsing", uiLocale: string = "ru-RU"
  ): Promise<void> {
    setStage(activeStage);
    const controller = new AbortController();
    backgroundRequest.current = controller;
    try {
      const semanticImport = await waitForSemanticImport(
        projectId,
        importId,
        controller.signal,
        (summary) => {
          setActiveImportSourceFormat(summary.sourceFormat);
          const nextStage = semanticImportActiveStage(
            summary.status,
            summary.stage
          );
          if (nextStage) setStage(nextStage);
          const next = semanticImportProgress(summary, uiLocale);
          setProgress(next.percent);
          setProgressDetail(next.detail);
        }
      );
      if (controller.signal.aborted) return;
      setCompletedImportId(semanticImport.id);
      setImportVersion(semanticImport.version);
      setActiveImportSourceFormat(semanticImport.sourceFormat);
      if (semanticImport.preview && semanticImport.sourceFormat !== "KC4") {
        setImportPreview(semanticImport.preview);
      } else if (semanticImport.sourceFormat === "KC4") {
        setImportPreview(undefined);
      }
      if (
        semanticImport.status === "AWAITING_MAPPING" &&
        semanticImport.preview
      ) {
        const detectedHistory = isPositionHistoryPreview(semanticImport.preview);
        const sourcePreset = sourceMapping(semanticImport.preview, source, detectedHistory);
        const columns = semanticImport.mapping?.columns ??
          sourcePreset;
        const resolvedDuplicatePolicy =
          semanticImport.mapping?.duplicatePolicy ??
          (semanticImport.sourceFormat === "KC4"
            ? "OVERWRITE_MAPPED"
            : "MERGE_NON_EMPTY");
        const resolvedCreateMissingKeywords =
          semanticImport.mapping?.createMissingKeywords ?? source !== "POSITIONS";
        const resolvedLanguage =
          semanticImport.mapping?.defaultLanguage ??
          "ru";
        const resolvedGroupSeparator =
          semanticImport.mapping?.groupSeparator ?? "/";
        setValidation(undefined);
        setImportResult(undefined);
        setMappingColumns(columns);
        setDuplicatePolicy(resolvedDuplicatePolicy);
        setCreateMissingKeywords(resolvedCreateMissingKeywords);
        setDefaultLanguage(resolvedLanguage);
        setGroupSeparator(resolvedGroupSeparator);
        setPositionHistory(semanticImport.mapping?.positionHistory ??
          (source === "POSITIONS"
            ? {
                ...defaultPositionHistoryOptions(file?.name),
                layout: detectedHistory ? "WIDE" : "LONG"
              }
            : undefined));
        setStage("preview");
        setMessage(
          semanticImport.sourceFormat === "KC4"
            ? `Проект Key Collector распознан: ${formatInteger(semanticImport.preview.totalRows, uiLocale)} строк. Выберите нужные поля, ненужным назначьте «Не импортировать».`
            : `Распознано ${formatInteger(semanticImport.preview.totalRows, uiLocale)} строк. Проверьте предложенное сопоставление колонок.`
        );
      } else if (
        semanticImport.status === "AWAITING_CONFIRMATION" &&
        semanticImport.validation
      ) {
        setMappingColumns(semanticImport.mapping?.columns ?? []);
        setDuplicatePolicy(
          semanticImport.mapping?.duplicatePolicy ?? "MERGE_NON_EMPTY"
        );
        setCreateMissingKeywords(
          semanticImport.mapping?.createMissingKeywords ?? false
        );
        setDefaultLanguage(
          semanticImport.mapping?.defaultLanguage ?? "ru"
        );
        setGroupSeparator(
          semanticImport.mapping?.groupSeparator ?? "/"
        );
        setPositionHistory(semanticImport.mapping?.positionHistory);
        setValidation(semanticImport.validation);
        setStage("validation-ready");
        setMessage(
          `Проверка завершена: ${formatInteger(semanticImport.validation.uniqueKeywordsToProcess, uiLocale)} уникальных запросов готовы к обработке.`
        );
      } else if (
        semanticImport.status === "COMPLETED" &&
        semanticImport.result
      ) {
        sessionStorage.removeItem(activeImportKey(projectId));
        setValidation(semanticImport.validation);
        setImportResult(semanticImport.result);
        notifyPublished(semanticImport.result);
        setStage("completed");
        setMessage(
          `Импорт завершён. Создана версия ядра №${semanticImport.result.semanticVersionNumber}.`
        );
      } else if (semanticImport.status === "CANCELLED") {
        sessionStorage.removeItem(activeImportKey(projectId));
        setValidation(semanticImport.validation);
        setImportResult(semanticImport.result);
        if (semanticImport.result?.partial) {
          notifyPublished(semanticImport.result);
        }
        setStage("cancelled");
        setMessage(
          semanticImport.result?.partial
            ? "Импорт остановлен после текущего чанка. Частичный результат сохранён отдельной версией."
            : "Импорт отменён до публикации данных."
        );
      } else {
        sessionStorage.removeItem(activeImportKey(projectId));
        setValidation(semanticImport.validation);
        setImportResult(semanticImport.result);
        if (semanticImport.result?.partial) {
          notifyPublished(semanticImport.result);
        }
        setStage(
          [
            "SEO_DATA_PUBLISH_REJECTED",
            "IMPORT_PUBLISH_RETRY_EXHAUSTED"
          ].includes(semanticImport.failureCode ?? "")
            ? "publish-failed"
            : "import-failed"
        );
        setError(importFailureMessage(
          semanticImport.failureCode,
          Boolean(semanticImport.result?.partial)
        ));
      }
    } catch (importError) {
      if (controller.signal.aborted) return;
      setStage("import-pending");
      setMessage(
        "Файл проверен, импорт обрабатывается в фоне. Обновите статус позже."
      );
      if (
        importError instanceof BrowserApiError &&
        importError.code === "NOT_FOUND"
      ) {
        sessionStorage.removeItem(activeImportKey(projectId));
        setCompletedImportId(undefined);
        setStage("ready");
        setMessage(undefined);
        setError("Задача импорта больше недоступна. Запустите импорт заново.");
      }
    } finally {
      if (backgroundRequest.current === controller) {
        backgroundRequest.current = undefined;
      }
    }
  }

  async function startSemanticImport(
    uploadId: string,
    signal?: AbortSignal, uiLocale: string = "ru-RU"
  ): Promise<void> {
    setStage("parsing");
    setMessage(undefined);
    setError(undefined);
    try {
      const semanticImport =
        await browserApiRequest<SemanticImportSummary>(
          `/app/api/projects/${encodeURIComponent(projectId)}/imports`,
          {
            method: "POST",
            idempotencyKey: `semantic-import:${uploadId}`,
            body: { uploadId },
            ...(signal ? { signal } : {})
          }
        );
      if (signal?.aborted) return;
      setCompletedImportId(semanticImport.id);
      sessionStorage.setItem(activeImportKey(projectId), semanticImport.id);
      await trackSemanticImport(semanticImport.id, undefined, uiLocale);
    } catch (importError) {
      if (signal?.aborted) return;
      setStage("ready");
      setError(importStartErrorMessage(importError));
    }
  }

  function updateMapping(
    sourceIndex: number,
    target: string,
    sourceName: string
  ): void {
    setMappingColumns((current) => {
      const singleton = !["custom", "ignore"].includes(target);
      return current.map((column) => {
        if (
          singleton &&
          column.sourceIndex !== sourceIndex &&
          column.target === target
        ) {
          const fallbackName =
            importPreview?.columns.find(
              ({ index }) => index === column.sourceIndex
            )?.sourceName ?? `Колонка ${column.sourceIndex + 1}`;
          return {
            sourceIndex: column.sourceIndex,
            target: "custom",
            customName: column.customName ?? fallbackName
          };
        }
        return column.sourceIndex === sourceIndex
          ? {
              sourceIndex,
              target,
              ...(target === "custom"
                ? { customName: column.customName ?? sourceName }
                : {})
            }
          : column;
      });
    });
  }

  function updateCustomName(
    sourceIndex: number,
    customName: string
  ): void {
    setMappingColumns((current) =>
      current.map((column) =>
        column.sourceIndex === sourceIndex
          ? { ...column, customName }
          : column
      )
    );
  }

  function togglePreviewSort(columnIndex: number): void {
    if (previewTable.current) previewTable.current.scrollTop = 0;
    setPreviewSort((current) => ({
      columnIndex,
      direction:
        current?.columnIndex === columnIndex && current.direction === "ASC"
          ? "DESC"
          : "ASC"
    }));
  }

  function loadMorePreviewRows(): void {
    const cursor = previewRowsPage?.nextCursor;
    if (
      !completedImportId ||
      !cursor ||
      previewRowsRequest.current ||
      !previewRowsPage.hasNext
    ) {
      return;
    }
    const controller = new AbortController();
    previewRowsRequest.current = controller;
    setPreviewRowsLoading(true);
    setPreviewRowsError(undefined);
    void fetchSemanticImportPreviewRows(
      projectId,
      completedImportId,
      previewSort,
      cursor,
      controller.signal
    ).then((page) => {
      if (controller.signal.aborted) return;
      setPreviewRows((current) => mergePreviewRows(current, page.rows));
      setPreviewRowsPage(page.page);
      setPreviewRowsLoaded(true);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setPreviewRowsError(
        "Не удалось загрузить следующую сотню строк. Прокрутите вниз, чтобы повторить."
      );
    }).finally(() => {
      if (previewRowsRequest.current === controller) {
        previewRowsRequest.current = undefined;
        setPreviewRowsLoading(false);
      }
    });
  }

  function previewTableScrolled(
    event: UIEvent<HTMLDivElement>
  ): void {
    const target = event.currentTarget;
    if (
      target.scrollHeight - target.scrollTop - target.clientHeight <= 180
    ) {
      loadMorePreviewRows();
    }
  }

  function applySourcePreset(): void {
    if (!importPreview) return;
    const nativeProject = file?.name.toLowerCase().endsWith(".kc4") ?? false;
    const detectedHistory = isPositionHistoryPreview(importPreview);
    setMappingColumns(sourceMapping(importPreview, source, detectedHistory));
    setDefaultLanguage("ru");
    setGroupSeparator(source === "KEY_COLLECTOR" && !nativeProject ? "\\" : "/");
    setDuplicatePolicy(source === "KEY_COLLECTOR" && nativeProject ? "OVERWRITE_MAPPED" : "MERGE_NON_EMPTY");
    setPositionHistory(source === "POSITIONS"
      ? {
          ...defaultPositionHistoryOptions(file?.name),
          layout: detectedHistory ? "WIDE" : "LONG"
        }
      : undefined);
    setMessage(
      source === "KEY_COLLECTOR" && nativeProject
        ? "Профиль Key Collector применён: иерархия групп, запросы, URL, частотности и сохранённые позиции Яндекса и Google импортируются из KC4."
        : `Автонастройка «${IMPORT_SOURCES.find((option) => option.value === source)?.label ?? "Файл"}» применена. Проверьте назначения колонок перед импортом.`
    );
  }

  async function validateImport(uiLocale: string = "ru-RU"): Promise<void> {
    if (
      !completedImportId ||
      importVersion === undefined ||
      mappingColumns.length === 0
    ) {
      return;
    }
    setStage("validating");
    setProgress(0);
    setProgressDetail("Готовим проверку строк…");
    setMessage(undefined);
    setError(undefined);
    setValidation(undefined);
    setImportResult(undefined);
    try {
      const semanticImport =
        await browserApiRequest<SemanticImportSummary>(
          `/app/api/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(completedImportId)}/mapping`,
          {
            method: "POST",
            ifMatch: importVersion,
            body: {
              columns: mappingColumns,
              defaultLanguage,
              groupSeparator,
              duplicatePolicy,
              createMissingKeywords,
              ...(positionHistory ? { positionHistory } : {})
            }
          }
        );
      setImportVersion(semanticImport.version);
      await trackSemanticImport(
        semanticImport.id,
        "validating", uiLocale
      );
    } catch (validationError) {
      setStage("preview");
      setError(importCommandErrorMessage(validationError));
    }
  }

  async function publishImport(uiLocale: string = "ru-RU"): Promise<void> {
    if (!completedImportId || importVersion === undefined) return;
    setStage("publishing");
    setProgress(0);
    setProgressDetail("Готовим публикацию…");
    setMessage(undefined);
    setError(undefined);
    try {
      const semanticImport =
        await browserApiRequest<SemanticImportSummary>(
          `/app/api/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(completedImportId)}/publish`,
          {
            method: "POST",
            ifMatch: importVersion
          }
        );
      setImportVersion(semanticImport.version);
      await trackSemanticImport(
        semanticImport.id,
        "publishing", uiLocale
      );
    } catch (publishError) {
      setStage("validation-ready");
      setError(importCommandErrorMessage(publishError));
    }
  }

  async function cancelImport(uiLocale: string = "ru-RU"): Promise<void> {
    if (!completedImportId) return;
    try {
      const semanticImport =
        await browserApiRequest<SemanticImportSummary>(
          `/app/api/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(completedImportId)}/cancel`,
          {
            method: "POST"
          }
        );
      setImportVersion(semanticImport.version);
      if (semanticImport.status === "CANCELLED") {
        sessionStorage.removeItem(activeImportKey(projectId));
        setImportResult(semanticImport.result);
        if (semanticImport.result?.partial) {
          notifyPublished(semanticImport.result);
        }
        setStage("cancelled");
        setMessage("Импорт отменён.");
      } else {
        await trackSemanticImport(
          semanticImport.id,
          "publishing", uiLocale
        );
      }
    } catch (cancelError) {
      setError(importCommandErrorMessage(cancelError));
    }
  }

  async function trackInspection(uploadId: string, uiLocale: string = "ru-RU"): Promise<void> {
    setProgress(100);
    setStage("scanning");
    const controller = new AbortController();
    backgroundRequest.current = controller;
    try {
      const inspected = await waitForInspection(
        projectId,
        uploadId,
        controller.signal
      );
      if (controller.signal.aborted) return;
      setCompletedUploadId(undefined);
      if (inspected.status === "READY") {
        if (
          file &&
          [
            "text/csv",
            "text/tab-separated-values",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.key-collector.project"
          ].includes(mediaType(file))
        ) {
          await startSemanticImport(inspected.id, controller.signal, uiLocale);
        } else {
          setStage("ready");
          setMessage(
            `${inspected.originalName} проверен. Legacy XLS и ZIP требуют отдельного конвертера.`
          );
        }
      } else {
        setStage("rejected");
        setError(inspectionRejectionMessage(inspected.rejectionCode));
      }
    } catch (inspectionError) {
      if (controller.signal.aborted) return;
      setStage("uploaded");
      setMessage(
        "Файл загружен, а проверка продолжается в фоне. Обновите статус позже."
      );
      if (
        inspectionError instanceof BrowserApiError &&
        inspectionError.code === "NOT_FOUND"
      ) {
        setCompletedUploadId(undefined);
        setStage("idle");
        setMessage(undefined);
        setError("Загрузка больше недоступна. Выберите файл заново.");
      }
    } finally {
      if (backgroundRequest.current === controller) {
        backgroundRequest.current = undefined;
      }
    }
  }

  async function upload(uiLocale: string = "ru-RU"): Promise<void> {
    if (!file || busy) return;
    if (stage === "uploaded" && completedUploadId) {
      setError(undefined);
      setMessage(undefined);
      await trackInspection(completedUploadId, uiLocale);
      return;
    }
    if (stage === "import-pending" && completedImportId) {
      setError(undefined);
      setMessage(undefined);
      await trackSemanticImport(completedImportId, undefined, uiLocale);
      return;
    }
    cancelled.current = false;
    setStage("preparing");
    setProgress(0);
    setProgressDetail(undefined);
    setError(undefined);
    setMessage(undefined);
    setCompletedImportId(undefined);
    setImportPreview(undefined);
    setMappingColumns([]);
    setValidation(undefined);
    setImportResult(undefined);
    setImportVersion(undefined);
    const storageKey = sessionKey(projectId, file);
    let session = readSession(storageKey);

    try {
      if (!session) {
        const idempotencyKey = crypto.randomUUID();
        const created = await browserApiRequest<CreatedMultipartUpload>(
          `/app/api/projects/${encodeURIComponent(projectId)}/uploads`,
          {
            method: "POST",
            idempotencyKey,
            body: {
              fileName: file.name,
              mediaType: mediaType(file),
              sizeBytes: String(file.size)
            }
          }
        );
        session = {
          uploadId: created.upload.id,
          idempotencyKey,
          partSizeBytes: created.partSizeBytes,
          partCount: created.partCount,
          completed: {}
        };
        writeSession(storageKey, session);
      }

      setStage("uploading");
      session = await uploadParts(
        projectId,
        file,
        session,
        storageKey,
        activeRequests,
        cancelled,
        setProgress
      );
      if (cancelled.current) return;

      setStage("completing");
      const completed = Object.entries(session.completed)
        .map(([partNumber, etag]) => ({
          partNumber: Number(partNumber),
          etag
        }))
        .sort((left, right) => left.partNumber - right.partNumber);
      const result = await browserApiRequest<UploadSummary>(
        `/app/api/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(session.uploadId)}/complete`,
        {
          method: "POST",
          body: { parts: completed }
        }
      );
      sessionStorage.removeItem(storageKey);
      setCompletedUploadId(result.id);
      await trackInspection(result.id, uiLocale);
    } catch (uploadError) {
      if (cancelled.current) return;
      for (const request of activeRequests.current) request.abort();
      activeRequests.current.clear();
      if (isExpiredUploadError(uploadError)) {
        sessionStorage.removeItem(storageKey);
      }
      setStage("idle");
      setError(uploadErrorMessage(uploadError));
    }
  }

  async function cancel(): Promise<void> {
    cancelled.current = true;
    for (const request of activeRequests.current) request.abort();
    activeRequests.current.clear();
    if (file) {
      const key = sessionKey(projectId, file);
      const session = readSession(key);
      if (session) {
        try {
          await browserApiRequest(
            `/app/api/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(session.uploadId)}`,
            { method: "DELETE" }
          );
        } catch {
          setError(
            "Загрузка остановлена локально, но сервер не подтвердил отмену. Повторите позже."
          );
        }
      }
      sessionStorage.removeItem(key);
    }
    setStage("cancelled");
    setProgress(0);
    setProgressDetail(undefined);
  }

  return (
    <section className="panel semantic-upload" data-source={source} data-stage={stage}>
      <div className={`semantic-import-workspace${focusedWorkspaceActive ? " is-mapping" : ""}${automaticKeyCollectorActive ? " is-automatic" : ""}`}>
        {!focusedWorkspaceActive && <nav aria-label={uiText("Источник импорта")} className="semantic-import-source-nav">
          <header>
            <strong><UiText text="Источник" /></strong>
            <small><UiText text="Выберите формат — поля настроятся автоматически" /></small>
          </header>
          <div className="semantic-import-source-list">
            {IMPORT_SOURCES.filter(({ disabled }) => !disabled).map((option) => (
              <ImportSourceButton
                active={source === option.value}
                disabled={busy}
                key={option.value}
                onSelect={() => chooseSource(option.value)}
                option={option}
              />
            ))}
          </div>
          <div className="semantic-import-source-bottom">
            <section className="semantic-import-unavailable-sources">
              <span><UiText text="Временно недоступно" /></span>
              {IMPORT_SOURCES.filter(({ disabled }) => disabled).map((option) => (
                <ImportSourceButton
                  active={false}
                  disabled
                  key={option.value}
                  onSelect={() => undefined}
                  option={option}
                  unavailable
                />
              ))}
            </section>
            <aside className="semantic-import-nav-info">
              <div>
                <Icon name="info" />
                <span>
                  <strong><UiText text="Перед публикацией" /></strong>
                  <small><UiText text={source === "KEY_COLLECTOR"
                    ? "После проверки KC4 импортируется автоматически."
                    : "Файл проверяется, а изменения показываются заранее."} /></small>
                </span>
              </div>
              <a
                href={uiLocale.startsWith("en") ? "/en/imports" : "/ru/imports"}
                rel="noreferrer"
                target="_blank"
              >
                <UiText text="Документация по импорту" />
                <Icon name="chevronRight" />
              </a>
            </aside>
          </div>
        </nav>}
        <div className="semantic-import-source-pane">
          {!focusedWorkspaceActive && <header className="semantic-import-pane-heading">
            <div>
              <strong>{IMPORT_SOURCES.find((option) => option.value === source)?.label}</strong>
              <small>{sourceHelp(source)}</small>
            </div>
            <div className="semantic-import-examples">
              {sourceExampleLinks(source).map((example) => (
                <a download href={example.href} key={example.href}>{example.label}</a>
              ))}
            </div>
          </header>}
      {message && !focusedWorkspaceActive && (
        <div className="inline-alert success" role="status">
          {<UiText text={message ?? ""} />}
        </div>
      )}
      {error && (
        <div className="inline-alert danger" role="alert">
          {<UiText text={error ?? ""} />}
        </div>
      )}
      {!focusedWorkspaceActive && <label className="upload-dropzone" data-disabled={busy || undefined}>
        <input
          accept={IMPORT_SOURCES.find((option) => option.value === source)?.accept}
          key={source}
          disabled={busy}
          onChange={selectFile}
          type="file"
        />
        <span aria-hidden="true" className="upload-dropzone-icon">
          <Icon name="import" />
        </span>
        <span className="upload-dropzone-copy">
          <strong>{file
            ? file.name
            : source === "KEY_COLLECTOR"
              ? <UiText text="Выберите проект Key Collector" />
              : <UiText text="Выберите файл семантики" />}</strong>
          <small>
            {file
              ? <UiText text="{0} · файл готов к загрузке" values={[String(formatBytes(file.size))]} />
              : source === "KEY_COLLECTOR"
                ? <UiText text="Нативный проект .kc4 · до 1 ГБ" />
                : <UiText text="CSV, TSV или XLSX · до 5 ГБ" />}
          </small>
        </span>
        <span className="upload-dropzone-action">
          {file ? <UiText text="Заменить" /> : <UiText text="Выбрать" />}
        </span>
      </label>}
      {progressVisible && (
        <div className="upload-progress" aria-live="polite">
          <div>
            <span>{statusText}</span>
            <strong>{Math.round(progress)}%</strong>
          </div>
          <span className="upload-progress-track">
            <i style={{ width: `${progress}%` }} />
          </span>
          {progressDetail && <small>{progressDetail}</small>}
        </div>
      )}
      {importPreview && (
        <div className="import-preview" aria-label={uiText("Предпросмотр импорта")}>
          <div className="import-preview-summary">
            <span>
              <strong>{formatInteger(importPreview.totalRows, uiLocale)}</strong>
              <UiText text="строк" /></span>
            <span>
              <strong>{formatInteger(importPreview.warningRows, uiLocale)}</strong>
              <UiText text="предупреждений" /></span>
            <span>
              <strong>{importPreview.columns.length}</strong>
              <UiText text="колонок" /></span>
          </div>
          {stage === "preview" && isPositionHistoryPreview(importPreview) && (
            <label className="import-position-history-toggle">
              <input checked={Boolean(positionHistory)} onChange={(event) => {
                if (event.target.checked) {
                  setPositionHistory(defaultPositionHistoryOptions(file?.name));
                  setMappingColumns(positionHistoryMapping(importPreview));
                } else {
                  setPositionHistory(undefined);
                  setMappingColumns(suggestedMapping(importPreview));
                }
              }} type="checkbox" />
              <span><strong><UiText text="Импортировать историю позиций по датам" /></strong><small><UiText text="Один файл — одна поисковая система. Пустая ячейка означает, что замера не было; -, – и — означают, что позиция не найдена." /></small></span>
            </label>
          )}
          {positionHistory && (
            <section className="import-position-history-settings">
              <header><Icon name="history" /><div><strong><UiText text="Параметры истории позиций" /></strong><small>{positionHistory.layout === "LONG" ? <UiText text="Построчный формат: дата и позиция берутся из каждой строки" /> : <UiText text="Найдено колонок с датами: {0}" values={[String(positionHistoryDateCount(importPreview))]} />}</small></div></header>
              <div>
                <label><span><UiText text="Поисковая система файла" /></span><CustomSelect value={positionHistory.searchEngine} disabled={stage !== "preview"} onChange={(event) => setPositionHistory(current => current ? { ...current, searchEngine: event.target.value as "YANDEX" | "GOOGLE" } : current)}><option value="YANDEX"><UiText text="Яндекс" /></option><option value="GOOGLE">Google</option></CustomSelect></label>
                <label><span><UiText text="Город / регион по умолчанию" /></span><SearchableRegionSelect kind={positionHistory.searchEngine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK"} value={positionHistory.regionCode} valueLabel={positionHistory.regionLabel} onChange={({ code, label }) => setPositionHistory(current => current ? { ...current, regionCode: code, regionLabel: label } : current)} /></label>
                <label><span><UiText text="Устройство по умолчанию" /></span><CustomSelect value={positionHistory.device} disabled={stage !== "preview"} onChange={(event) => setPositionHistory(current => current ? { ...current, device: event.target.value as "DESKTOP" | "MOBILE" } : current)}><option value="DESKTOP"><UiText text="ПК" /></option><option value="MOBILE"><UiText text="Телефон" /></option></CustomSelect></label>
                <label><span><UiText text="Язык выдачи" /></span><LanguageSelect value={positionHistory.language} disabled={stage !== "preview"} onChange={(event) => setPositionHistory(current => current ? { ...current, language: event.target.value } : current)} /></label>
              </div>
              <p><UiText text="Если файл экспортирован из Сеньориты, город, код региона, устройство, страна и язык берутся из каждой строки. Эти значения имеют приоритет над настройками выше." /></p>
            </section>
          )}
          {!positionHistory && <div
            aria-busy={previewRowsLoading}
            className="import-preview-table"
            onScroll={previewTableScrolled}
            ref={previewTable}
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  {importPreview.columns.map((column) => {
                    const selected =
                      mappingColumns.find(
                        ({ sourceIndex }) => sourceIndex === column.index
                      ) ?? {
                        sourceIndex: column.index,
                        target: column.suggestedTarget
                    };
                    return (
                      <th key={column.index}>
                        <div className="import-preview-column-heading">
                          <span title={column.sourceName}>{column.sourceName}</span>
                          <button
                            aria-label={uiText(
                              previewSort?.columnIndex === column.index && previewSort.direction === "ASC"
                                ? "Сортировать колонку {0} по убыванию"
                                : "Сортировать колонку {0} по возрастанию",
                              [column.sourceName]
                            )}
                            aria-pressed={previewSort?.columnIndex === column.index}
                            className={previewSort?.columnIndex === column.index ? "active" : undefined}
                            onClick={() => togglePreviewSort(column.index)}
                            title={uiText(
                              previewSort?.columnIndex === column.index
                                ? previewSort.direction === "ASC"
                                  ? "По возрастанию · нажмите для убывания"
                                  : "По убыванию · нажмите для возрастания"
                                : "Сортировать значения"
                            )}
                            type="button"
                          >
                            <Icon name={previewSort?.columnIndex === column.index && previewSort.direction === "DESC" ? "arrowDown" : "arrowUp"} />
                          </button>
                        </div>
                        {stage === "preview" ? (
                          <>
                            <small className="import-mapping-field-label"><UiText text="Поле назначения" /></small>
                            <CustomSelect
                              aria-label={uiText("Назначение колонки {0}", [String(column.sourceName)])}
                              onChange={(event) =>
                                updateMapping(
                                  column.index,
                                  event.target.value,
                                  column.sourceName
                                )
                              }
                              value={selected.target}
                            >
                              {MAPPING_TARGETS.map((target) => (
                                <option key={target} value={target}>
                                  <span className="import-mapping-target-option">
                                    {mappingTargetIcon(target)}
                                    <span>{<UiText text={mappingTargetLabel(target) ?? ""} />}</span>
                                  </span>
                                </option>
                              ))}
                            </CustomSelect>
                            {selected.target === "custom" && (
                              <label className="import-custom-column-name">
                                <span><UiText text="Название своей колонки" /></span>
                                <input
                                  aria-label={uiText("Имя пользовательской колонки {0}", [String(column.sourceName)])}
                                  maxLength={160}
                                  onChange={(event) =>
                                    updateCustomName(
                                      column.index,
                                      event.target.value
                                    )
                                  }
                                  value={selected.customName ?? column.sourceName}
                                />
                              </label>
                            )}
                          </>
                        ) : (
                          <span className="import-mapping-readonly">
                            {mappingTargetIcon(selected.target as SemanticImportTarget)}
                            <span>{selected.target === "custom"
                              ? selected.customName ?? column.sourceName
                              : <UiText text={mappingTargetLabel(selected.target as SemanticImportTarget)} />}</span>
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visiblePreviewRows.map((row) => (
                  <tr key={row.rowNumber}>
                    {importPreview.columns.map((column) => (
                      <td key={column.index}>
                        {row.values[column.index] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
          {!positionHistory && (
            <div className="import-preview-pagination-status" role="status">
              <span>
                <UiText text="Показано {0} из {1}" values={[
                  String(visiblePreviewRows.length),
                  String(formatInteger(previewRowsPage?.totalRows ?? importPreview.totalRows, uiLocale))
                ]} />
              </span>
              {previewRowsLoading && <span><UiText text="Загружаем 100 строк…" /></span>}
              {previewRowsError && (
                <button onClick={() => setPreviewReloadNonce((value) => value + 1)} type="button">
                  <UiText text="Повторить загрузку" />
                </button>
              )}
              {!previewRowsLoading && previewRowsPage?.hasNext && !previewRowsError && (
                <span><UiText text="Прокрутите ниже — загрузятся следующие 100" /></span>
              )}
            </div>
          )}
          <small className="upload-note import-preview-note">
            <UiText text={positionHistory
              ? "Колонки с датами распознаны автоматически; сопоставлять их вручную не нужно."
              : stage === "preview"
                ? "Для каждой исходной колонки выберите поле назначения, «Своя колонка» или «Не импортировать». Таблица прокручивается по горизонтали и вертикали; её шапка остаётся на месте."
                : source === "KEY_COLLECTOR"
                  ? "Нативный профиль Key Collector применён автоматически; нестандартные данные сохранятся в пользовательских колонках."
                  : "Сопоставление проверено и готово к публикации."} /></small>
          {stage === "preview" && (
            <section className="import-mapping-settings">
              <header>
                <div>
                  <strong><UiText text="Правила публикации" /></strong>
                  <small><UiText text="Настройте язык, дерево групп и поведение при совпадении запросов." /></small>
                </div>
                {!positionHistory && (
                  <button className="secondary-button import-keycollector-preset" onClick={applySourcePreset} type="button">
                    <Icon name="refresh" /><UiText text="Вернуть автонастройку" />
                  </button>
                )}
              </header>
              <div className="import-mapping-settings-grid">
                <label>
                  <span><UiText text="Язык запросов" /></span>
                  <LanguageSelect
                    aria-label={uiText("Язык запросов по умолчанию")}
                    onChange={(event) => setDefaultLanguage(event.target.value)}
                    value={defaultLanguage}
                  />
                  <small><UiText text="Применяется, если язык отсутствует в исходной строке." /></small>
                </label>
                <label>
                  <span><UiText text="Разделитель пути групп" /></span>
                  <input
                    aria-label={uiText("Разделитель пути групп")}
                    maxLength={8}
                    onChange={(event) => setGroupSeparator(event.target.value)}
                    value={groupSeparator}
                  />
                  <small><UiText text="Для нативного KC4 используется «/»; вложенность дерева сохраняется." /></small>
                </label>
                <label>
                  <span><UiText text="Если запрос уже существует" /></span>
                  <CustomSelect
                    onChange={(event) => setDuplicatePolicy(event.target.value)}
                    value={duplicatePolicy}
                  >
                    <option disabled={!createMissingKeywords} value="SKIP_EXISTING"><UiText text="Пропустить существующие" /></option>
                    <option value="MERGE_NON_EMPTY"><UiText text="Заполнить только пустые поля" /></option>
                    <option value="OVERWRITE_MAPPED"><UiText text="Обновить сопоставленные поля" /></option>
                  </CustomSelect>
                  <small><UiText text="Нативный KC4 по умолчанию обновляет только выбранные поля." /></small>
                </label>
              </div>
              <label className="import-create-missing-option">
                <input
                  checked={createMissingKeywords}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setCreateMissingKeywords(checked);
                    if (!checked && duplicatePolicy === "SKIP_EXISTING") {
                      setDuplicatePolicy("MERGE_NON_EMPTY");
                    }
                  }}
                  type="checkbox"
                />
                <span>
                  <strong><UiText text="Добавлять отсутствующие запросы" /></strong>
                  <small><UiText text={createMissingKeywords
                    ? "Новые фразы будут созданы; найденные совпадения обработаются по правилу выше."
                    : "Будут обновлены только уже существующие фразы, новые строки пропустятся."} /></small>
                </span>
              </label>
            </section>
          )}
        </div>
      )}
      {validation && (
        <div className="import-validation" aria-label={uiText("Проверка импорта")}>
          <div className="import-preview-summary">
            <span>
              <strong>
                {formatInteger(validation.uniqueKeywordsToProcess, uiLocale)}
              </strong>
              <UiText text="уникальных" /></span>
            <span>
              <strong>
                {formatInteger(validation.duplicateRowsInFile, uiLocale)}
              </strong>
              <UiText text="дублей в файле" /></span>
            <span>
              <strong>
                {formatInteger(validation.existingKeywordsInProject, uiLocale)}
              </strong>
              <UiText text="уже в проекте" /></span>
            <span>
              <strong>{formatInteger(validation.newKeywordsSkipped, uiLocale)}</strong>
              <UiText text="новых будет пропущено" /></span>
            <span>
              <strong>{formatInteger(validation.errorRows, uiLocale)}</strong>
              <UiText text="ошибок" /></span>
          </div>
          {Object.keys(validation.issueCounts).length > 0 && (
            <p className="upload-note">
              <UiText text="Проверка сохранила проблемные строки отдельно:" />{" "}
              {Object.entries(validation.issueCounts)
                .map(
                  ([code, count]) =>
                    `${importIssueLabel(code)} — ${formatInteger(count, uiLocale)}`
                )
                .join("; ")}
            </p>
          )}
        </div>
      )}
      {importResult && (
        <div className="import-validation" aria-label={uiText("Результат импорта")}>
          <div className="import-preview-summary">
            <span>
              <strong>{formatInteger(importResult.createdKeywords, uiLocale)}</strong>
              <UiText text="создано запросов" /></span>
            <span>
              <strong>{formatInteger(importResult.updatedKeywords, uiLocale)}</strong>
              <UiText text="обновлено" /></span>
            <span>
              <strong>{formatInteger(importResult.createdGroups, uiLocale)}</strong>
              <UiText text="новых групп" /></span>
            <span>
              <strong>
                {formatInteger(importResult.createdMetricSnapshots, uiLocale)}
              </strong>
              <UiText text="метрик" /></span>
          </div>
        </div>
      )}
      <div className="security-actions">
        {stage === "preview" && (
          <button
            className="primary-button"
            disabled={
              !mappingColumns.some(
                ({ target }) => target === "keyword.text"
              ) ||
              !defaultLanguage.trim() ||
              !groupSeparator.trim() ||
              mappingColumns.some(
                ({ target, customName }) =>
                  target === "custom" && !customName?.trim()
              )
            }
            onClick={() => void validateImport(uiLocale)}
            type="button"
          >
            <UiText text="Проверить импорт" /></button>
        )}
        {stage === "validation-ready" && (
          <button
            className="primary-button"
            disabled={
              !validation ||
              validation.uniqueKeywordsToProcess === "0"
            }
            onClick={() => void publishImport(uiLocale)}
            type="button"
          >
            <UiText text="Импортировать" />{" "}
            {validation
              ? formatInteger(validation.uniqueKeywordsToProcess, uiLocale)
              : ""}
          </button>
        )}
        {!["preview", "validation-ready"].includes(stage) && (
          <button
            className="primary-button"
            disabled={!file || busy}
            onClick={() => void upload(uiLocale)}
            type="button"
          >
            {stage === "uploaded"
              ? <UiText text="Обновить статус" />
              : stage === "import-pending"
                ? <UiText text="Обновить импорт" />
                : stage === "validating"
                  ? <UiText text="Проверяем импорт…" />
                  : stage === "publishing"
                    ? <UiText text="Публикуем ядро…" />
                : [
                      "ready",
                      "rejected",
                      "import-failed",
                      "completed"
                    ].includes(stage)
                  ? <UiText text="Загрузить ещё раз" />
                  : <UiText text="Начать загрузку" />}
          </button>
        )}
        {canCancel && (
          <button
            className="secondary-button"
            onClick={() =>
              void (completedImportId &&
              semanticCancellationStages.includes(stage)
                ? cancelImport(uiLocale)
                : cancel())
            }
            type="button"
          >
            <UiText text="Отменить" /></button>
        )}
      </div>
      {!focusedWorkspaceActive && <small className="upload-note">
        <UiText text={source === "KEY_COLLECTOR"
          ? "После проверки безопасности поля KC4 сопоставляются и публикуются автоматически."
          : "После загрузки файл не публикуется сразу: сначала идут антивирусная проверка, распознавание колонок и preview конфликтов."} /></small>
      }
        </div>
      </div>
    </section>
  );
}

async function fetchSemanticImportPreviewRows(
  projectId: string,
  importId: string,
  sort: Readonly<{ columnIndex: number; direction: "ASC" | "DESC" }> | undefined,
  cursor: string | undefined,
  signal: AbortSignal
): Promise<SemanticImportPreviewRowsPage> {
  const query = new URLSearchParams();
  if (sort) {
    query.set("sortColumn", String(sort.columnIndex));
    query.set("sortDirection", sort.direction);
  }
  if (cursor) query.set("cursor", cursor);
  return browserApiRequest<SemanticImportPreviewRowsPage>(
    `/app/api/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(importId)}/preview-rows${query.size > 0 ? `?${query.toString()}` : ""}`,
    { signal }
  );
}

export function mergePreviewRows(
  current: readonly SemanticImportPreviewRow[],
  incoming: readonly SemanticImportPreviewRow[]
): readonly SemanticImportPreviewRow[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map(({ rowNumber }) => rowNumber));
  return [
    ...current,
    ...incoming.filter(({ rowNumber }) => !seen.has(rowNumber))
  ];
}

function ImportSourceButton({
  active,
  disabled,
  onSelect,
  option,
  unavailable = false
}: Readonly<{
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  option: Readonly<SemanticImportSourceOption>;
  unavailable?: boolean;
}>) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`semantic-import-source-option${active ? " active" : ""}${unavailable ? " unavailable" : ""}`}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`semantic-import-source-icon source-${option.value.toLowerCase()}`}
      >
        {option.icon ? <Icon name={option.icon} /> : option.badge}
      </span>
      <span>
        <strong>{option.label}</strong>
        <small>{option.description}</small>
        {unavailable && <em><UiText text="Недоступно" /></em>}
      </span>
    </button>
  );
}

async function uploadParts(
  projectId: string,
  file: File,
  initial: StoredUploadSession,
  storageKey: string,
  activeRequests: { readonly current: Set<XMLHttpRequest> },
  cancelled: { current: boolean },
  onProgress: (value: number) => void
): Promise<StoredUploadSession> {
  let session = initial;
  const pending = Array.from(
    { length: session.partCount },
    (_, index) => index + 1
  ).filter((partNumber) => !session.completed[String(partNumber)]);
  const partProgress = new Map<number, number>();
  function updateProgress(): void {
    const activeBytes = [...partProgress.values()].reduce(
      (sum, value) => sum + value,
      0
    );
    onProgress(
      Math.min(
        99,
        ((completedSize(file.size, session) + activeBytes) / file.size) * 100
      )
    );
  }

  async function worker(): Promise<void> {
    while (!cancelled.current) {
      const partNumber = pending.shift();
      if (!partNumber) return;
      const start = (partNumber - 1) * session.partSizeBytes;
      const body = file.slice(
        start,
        Math.min(file.size, start + session.partSizeBytes)
      );
      const etag = await uploadPartWithRetry(
        async () => {
          const signed = await browserApiRequest<UploadPartUrls>(
            `/app/api/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(session.uploadId)}/parts`,
            {
              method: "POST",
              body: { partNumbers: [partNumber] }
            }
          );
          const url = signed.parts[0]?.url;
          if (!url) throw new Error("Missing signed upload URL");
          return url;
        },
        body,
        activeRequests.current,
        (loaded) => {
          partProgress.set(partNumber, loaded);
          updateProgress();
        }
      );
      partProgress.delete(partNumber);
      session = {
        ...session,
        completed: {
          ...session.completed,
          [String(partNumber)]: etag
        }
      };
      writeSession(storageKey, session);
      onProgress(
        Math.min(99, (completedSize(file.size, session) / file.size) * 100)
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENCY, pending.length) },
      () => worker()
    )
  );
  return session;
}

async function uploadPartWithRetry(
  createUrl: () => Promise<string>,
  body: Blob,
  activeRequests: Set<XMLHttpRequest>,
  onProgress: (loaded: number) => void
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await uploadPart(
        await createUrl(),
        body,
        activeRequests,
        onProgress
      );
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message === "S3 upload aborted") {
        throw error;
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

function uploadPart(
  url: string,
  body: Blob,
  activeRequests: Set<XMLHttpRequest>,
  onProgress: (loaded: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    activeRequests.add(request);
    const relay = storageRelayRequest(url);
    request.open("PUT", relay.url);
    if (relay.signedUrl) {
      request.setRequestHeader("x-seo-storage-url", relay.signedUrl);
    }
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onerror = () => reject(new Error("S3 upload failed"));
    request.onabort = () => reject(new Error("S3 upload aborted"));
    request.onload = () => {
      activeRequests.delete(request);
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`S3 upload failed with ${request.status}`));
        return;
      }
      const etag = request.getResponseHeader("ETag");
      if (!etag) {
        reject(new Error("S3 CORS must expose the ETag response header"));
        return;
      }
      resolve(etag);
    };
    request.onloadend = () => activeRequests.delete(request);
    request.send(body);
  });
}

function storageRelayRequest(url: string): {
  readonly url: string;
  readonly signedUrl?: string;
} {
  if (typeof window === "undefined") return { url };
  try {
    const signed = new URL(url);
    if (
      signed.protocol === "https:" &&
      signed.hostname === window.location.hostname &&
      signed.port === "9443" &&
      signed.origin !== window.location.origin
    ) {
      return {
        url: "/app/api/storage-upload",
        signedUrl: signed.toString()
      };
    }
  } catch {
    return { url };
  }
  return { url };
}

function completedSize(
  fileSize: number,
  session: StoredUploadSession
): number {
  return Object.keys(session.completed).reduce((sum, value) => {
    const partNumber = Number(value);
    const start = (partNumber - 1) * session.partSizeBytes;
    return (
      sum +
      Math.max(
        0,
        Math.min(session.partSizeBytes, fileSize - start)
      )
    );
  }, 0);
}

function sessionKey(projectId: string, file: File): string {
  return [
    "semantic-upload",
    projectId,
    file.name,
    file.size,
    file.lastModified
  ].join(":");
}

function activeImportKey(projectId: string): string {
  return `semantic-import-active:${projectId}`;
}

function readSession(key: string): StoredUploadSession | undefined {
  try {
    const value = sessionStorage.getItem(key);
    if (!value) return undefined;
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("uploadId" in parsed) ||
      typeof parsed.uploadId !== "string" ||
      !("idempotencyKey" in parsed) ||
      typeof parsed.idempotencyKey !== "string" ||
      !("partSizeBytes" in parsed) ||
      typeof parsed.partSizeBytes !== "number" ||
      !Number.isSafeInteger(parsed.partSizeBytes) ||
      parsed.partSizeBytes <= 0 ||
      !("partCount" in parsed) ||
      typeof parsed.partCount !== "number" ||
      !Number.isSafeInteger(parsed.partCount) ||
      parsed.partCount <= 0 ||
      !("completed" in parsed) ||
      typeof parsed.completed !== "object" ||
      parsed.completed === null ||
      Array.isArray(parsed.completed)
    ) {
      return undefined;
    }
    const partCount = parsed.partCount;
    const completed = parsed.completed as Readonly<Record<string, unknown>>;
    if (
      Object.entries(completed).some(
        ([partNumber, etag]) =>
          !/^[1-9]\d*$/u.test(partNumber) ||
          Number(partNumber) > partCount ||
          typeof etag !== "string"
      )
    ) {
      return undefined;
    }
    return parsed as StoredUploadSession;
  } catch {
    return undefined;
  }
}

function writeSession(key: string, session: StoredUploadSession): void {
  sessionStorage.setItem(key, JSON.stringify(session));
}

function mediaType(file: File): string {
  const extension = file.name.toLowerCase().split(".").pop();
  const byExtension: Readonly<Record<string, string>> = {
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kc4: "application/vnd.key-collector.project",
    zip: "application/zip"
  };
  return (extension && byExtension[extension]) || file.type || "";
}

function formatBytes(value: number): string {
  if (value < 1_024 * 1_024) return `${Math.ceil(value / 1_024)} КБ`;
  if (value < 1_024 * 1_024 * 1_024) {
    return `${(value / 1_024 / 1_024).toFixed(1)} МБ`;
  }
  return `${(value / 1_024 / 1_024 / 1_024).toFixed(2)} ГБ`;
}

async function waitForInspection(
  projectId: string,
  uploadId: string,
  signal: AbortSignal
): Promise<UploadSummary> {
  const startedAt = Date.now();
  let delayMs = 1_000;
  while (Date.now() - startedAt < INSPECTION_TIMEOUT_MS) {
    const upload = await browserApiRequest<UploadSummary>(
      `/app/api/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(uploadId)}`,
      { signal }
    );
    if (["READY", "REJECTED"].includes(upload.status)) return upload;
    if (!["UPLOADED", "SCANNING"].includes(upload.status)) {
      throw new Error(`Unexpected inspection state: ${upload.status}`);
    }
    await pause(delayMs, signal);
    delayMs = Math.min(5_000, Math.ceil(delayMs * 1.5));
  }
  throw new Error("Upload inspection is still running");
}

async function waitForSemanticImport(
  projectId: string,
  importId: string,
  signal: AbortSignal,
  onProgress: (summary: SemanticImportSummary) => void
): Promise<SemanticImportSummary> {
  const startedAt = Date.now();
  let delayMs = 1_000;
  while (Date.now() - startedAt < SEMANTIC_IMPORT_TRACKING_TIMEOUT_MS) {
    const semanticImport = await browserApiRequest<SemanticImportSummary>(
      `/app/api/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(importId)}`,
      { signal }
    );
    onProgress(semanticImport);
    if (
      [
        "AWAITING_MAPPING",
        "AWAITING_CONFIRMATION",
        "COMPLETED",
        "FAILED",
        "CANCELLED"
      ].includes(semanticImport.status)
    ) {
      return semanticImport;
    }
    if (
      ![
        "QUEUED",
        "PARSING",
        "VALIDATING",
        "READY_TO_PUBLISH",
        "PUBLISHING",
        "CANCEL_REQUESTED"
      ].includes(semanticImport.status)
    ) {
      throw new Error(
        `Unexpected semantic import state: ${semanticImport.status}`
      );
    }
    await pause(delayMs, signal);
    delayMs = Math.min(5_000, Math.ceil(delayMs * 1.5));
  }
  throw new Error("Semantic import is still running");
}

function semanticImportActiveStage(
  status: string,
  detailStage?: string
): "parsing" | "validating" | "publishing" | "finalizing" | undefined {
  if (["QUEUED", "PARSING"].includes(status)) return "parsing";
  if (status === "VALIDATING") return "validating";
  if (
    ["READY_TO_PUBLISH", "PUBLISHING", "CANCEL_REQUESTED"].includes(status)
  ) {
    if (detailStage?.startsWith("finalizing_import:")) return "finalizing";
    return "publishing";
  }
  return undefined;
}

function semanticImportProgress(
  summary: SemanticImportSummary,
  uiLocale: string
): Readonly<{ percent: number; detail?: string }> {
  const parts = summary.stage.split(":");
  const current = Number(parts[1]);
  const total = Number(parts[2]);
  if (parts[0] === "validating_rows" && !(total > 0)) {
    return { percent: 0, detail: "Готовим проверку строк…" };
  }
  if (parts[0] === "validating_rows" && total > 0) {
    return {
      percent: Math.min(100, (current / total) * 100),
      detail: `Проверено ${formatInteger(String(current), uiLocale)} из ${formatInteger(String(total), uiLocale)} строк`
    };
  }
  if (parts[0] === "publishing_chunks" && total > 0) {
    const chunk = Number(parts[3]);
    const chunks = Number(parts[4]);
    return {
      percent: Math.min(100, (current / total) * 100),
      detail: `Опубликовано ${formatInteger(String(current), uiLocale)} из ${formatInteger(String(total), uiLocale)} запросов${chunks > 0 ? ` · чанк ${formatInteger(String(chunk), uiLocale)} из ${formatInteger(String(chunks), uiLocale)}` : ""}`
    };
  }
  if (parts[0] === "publishing_chunks") {
    return { percent: 0, detail: "Готовим публикацию…" };
  }
  if (parts[0] === "finalizing_import") {
    return {
      percent: 100,
      detail: "Все чанки опубликованы. Завершаем версию семантического ядра…"
    };
  }
  const progressBytes = Number(summary.progressBytes);
  const totalBytes = Number(summary.totalBytes);
  const percent = totalBytes > 0
    ? Math.min(100, (progressBytes / totalBytes) * 100)
    : 0;
  const kc4Stages: Readonly<Record<string, string>> = {
    downloading_kc4: `Скачано ${formatBytes(progressBytes)} из ${formatBytes(totalBytes)}`,
    extracting_kc4: "Распаковываем базу Key Collector…",
    checking_kc4_database: "Проверяем целостность SQLite…",
    reading_kc4_schema: "Читаем дерево, колонки и историю позиций…"
  };
  const kc4Detail = kc4Stages[parts[0]!];
  if (kc4Detail) return { percent, detail: kc4Detail };
  if (parts[0] === "parsing_rows" && current > 0) {
    return {
      percent,
      detail: `Разобрано ${formatInteger(String(current), uiLocale)} строк`
    };
  }
  return { percent };
}

function pause(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    function onAbort(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function uploadStatus(stage: UploadStage, progress: number): string {
  if (stage === "preparing") return "Создаём защищённую загрузку…";
  if (stage === "uploading") {
    return progress > 0 ? "Загружаем части в S3…" : "Получаем ссылки…";
  }
  if (stage === "completing") return "Проверяем целостность объекта…";
  if (stage === "scanning") return "Проверяем checksum, тип и безопасность…";
  if (stage === "parsing") return "Читаем строки и распознаём колонки…";
  if (stage === "validating") return "Проверяем строки, дубли и значения…";
  if (stage === "validation-ready") return "Проверка импорта готова";
  if (stage === "publishing") return "Публикуем семантическое ядро чанками…";
  if (stage === "finalizing") return "Завершаем публикацию семантического ядра…";
  if (stage === "import-pending") return "Импорт обрабатывается в фоне";
  if (stage === "preview") return "Предпросмотр импорта готов";
  if (stage === "import-failed") return "Файл не удалось разобрать";
  if (stage === "publish-failed") return "Публикация не выполнена";
  if (stage === "ready") return "Файл проверен и готов";
  if (stage === "completed") return "Импорт завершён";
  if (stage === "rejected") return "Файл отклонён";
  if (stage === "uploaded") {
    return "Загрузка завершена, проверка продолжается";
  }
  return "";
}

function importStartErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "PAYMENT_REQUIRED") {
      return "Проект доступен только для чтения. Новый импорт временно недоступен.";
    }
    if (error.code === "VALIDATION_FAILED") {
      return "Этот формат пока нельзя разобрать. Поддерживаются CSV, TSV, XLSX и нативные проекты Key Collector .kc4; legacy XLS и произвольные ZIP требуют отдельного конвертера.";
    }
    if (error.code === "DEPENDENCY_UNAVAILABLE") {
      return "Очередь импорта временно недоступна. Проверенный файл сохранён — повторите позже.";
    }
    return error.message;
  }
  return "Не удалось запустить распознавание файла. Повторите позже.";
}

function importCommandErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "Импорт изменился в другой вкладке. Обновите его состояние и повторите.";
    }
    if (error.code === "PAYMENT_REQUIRED") {
      return "Проект доступен только для чтения. Новые операции временно недоступны.";
    }
    if (error.code === "DEPENDENCY_UNAVAILABLE") {
      return "Фоновый сервис временно недоступен. Состояние сохранено — повторите позже.";
    }
    return error.message;
  }
  return "Не удалось выполнить действие с импортом. Повторите позже.";
}

function importFailureMessage(
  code: string | undefined,
  partial = false
): string {
  const messages: Readonly<Record<string, string>> = {
    EMPTY_IMPORT: "В файле не найдено строк для импорта.",
    UNTERMINATED_QUOTE:
      "CSV/TSV повреждён: не закрыто кавычечное поле.",
    INVALID_QUOTE:
      "CSV/TSV повреждён: кавычки внутри строки используются некорректно.",
    INVALID_TEXT_ENCODING:
      "Кодировка файла повреждена или определена неверно. Выберите UTF-8 или Windows-1251 вручную.",
    TOO_MANY_COLUMNS:
      "В строке слишком много колонок. Проверьте разделитель файла.",
    FIELD_TOO_LARGE:
      "Одна из ячеек превышает безопасный лимит размера.",
    ROW_TOO_LARGE:
      "Одна из строк превышает безопасный лимит размера.",
    INVALID_XLSX:
      "XLSX повреждён, зашифрован или содержит неподдерживаемую структуру.",
    XLSX_TOO_LARGE:
      "XLSX превышает безопасный лимит 256 МиБ. Для больших ядер используйте CSV/TSV.",
    XLSX_ARCHIVE_TOO_LARGE:
      "XLSX отклонён: распакованный workbook превышает безопасный лимит.",
    XLSX_SHARED_STRINGS_TOO_LARGE:
      "XLSX содержит слишком большой словарь строк. Экспортируйте ядро в CSV/TSV.",
    INVALID_KC4:
      "Проект .kc4 повреждён, зашифрован или имеет неподдерживаемую структуру Key Collector.",
    KC4_TOO_LARGE:
      "Проект .kc4 превышает безопасный лимит нативного импорта.",
    KC4_ARCHIVE_TOO_LARGE:
      "Проект .kc4 отклонён: распакованная база превышает безопасный лимит.",
    KC4_TOO_MANY_GROUPS:
      "В проекте .kc4 больше 20 000 активных папок. Разделите проект перед импортом.",
    IMPORT_MAPPING_INVALID:
      "Сопоставление колонок устарело или повреждено. Вернитесь к настройке импорта.",
    SEO_DATA_VALIDATION_REJECTED:
      "Сервис семантики отклонил проверку. Проверьте язык и сопоставление колонок.",
    IMPORT_VALIDATION_MISSING:
      "Результат проверки импорта недоступен. Выполните проверку заново.",
    IMPORT_HAS_NO_VALID_ROWS:
      "В файле нет уникальных корректных запросов для публикации.",
    IMPORT_TOO_MANY_CHUNKS:
      "Импорт превышает безопасный лимит одной операции.",
    SEO_DATA_PUBLISH_REJECTED:
      "Сервис семантики отклонил публикацию. Данные проекта не изменены — загрузите файл повторно.",
    SEO_DATA_COMMAND_INVALID:
      "Формат публикации не совпал с версией сервиса. Повторите импорт после завершения обновления приложения.",
    SEO_DATA_PUBLISH_CONFLICT:
      "Проект изменился во время публикации. Повторите импорт, чтобы применить данные к актуальной версии.",
    SEO_DATA_RECEIPT_NOT_FOUND:
      "Черновик публикации потерян после обновления сервиса. Повторите импорт файла.",
    IMPORT_PUBLISH_RETRY_EXHAUSTED:
      "Публикацию не удалось завершить после нескольких попыток. Повтор остановлен автоматически; данные проекта не удалены."
  };
  if (partial && code === "SEO_DATA_PUBLISH_REJECTED") {
    return "Публикация остановлена. Уже применённая часть сохранена отдельной версией; повторно загрузите файл, чтобы дополнить проект.";
  }
  if (partial && code === "IMPORT_PUBLISH_RETRY_EXHAUSTED") {
    return "Публикация остановлена после нескольких попыток. Уже применённая часть сохранена отдельной версией; повторно загрузите файл, чтобы продолжить полным импортом.";
  }
  return (
    (code && messages[code]) ||
    "Файл не удалось разобрать. Проверьте формат, кодировку и разделитель."
  );
}

function mappingTargetLabel(value: SemanticImportTarget): string {
  const labels: Readonly<Record<string, string>> = {
    "keyword.text": "Ключевая фраза",
    "keyword.language": "Язык",
    "keyword.priority": "Приоритет",
    "keyword.favorite": "Избранное",
    "keyword.tracked": "Отслеживается",
    "keyword.note": "Заметка",
    "keyword.intent": "Интент",
    "group.path": "Путь группы",
    "page.target_url": "Целевой URL",
    "frequency.base": "Яндекс · База",
    "frequency.exact": 'Яндекс · ""',
    "frequency.fixed": 'Яндекс · "!"',
    "ranking.position": "Позиция (по колонке поисковика)",
    "ranking.url": "URL из выдачи",
    "ranking.yandex.position": "Яндекс · Позиция",
    "ranking.yandex.change": "Яндекс · Изменение позиции",
    "ranking.yandex.url": "Яндекс · Релевантный URL",
    "ranking.google.position": "Google · Позиция",
    "ranking.google.change": "Google · Изменение позиции",
    "ranking.google.url": "Google · Релевантный URL",
    "context.search_engine": "Поисковая система",
    "context.region": "Регион",
    "metric.observed_at": "Дата проверки",
    "keyword.tags": "Теги",
    "metric.kei": "KEI",
    custom: "Своя колонка",
    ignore: "Не импортировать"
  };
  return labels[value] ?? "Своя колонка";
}

function mappingTargetIcon(value: SemanticImportTarget) {
  if (value.startsWith("ranking.yandex") || value.startsWith("frequency.")) {
    return <SearchEngineLogo engine="YANDEX" size="compact" />;
  }
  if (value.startsWith("ranking.google")) {
    return <SearchEngineLogo engine="GOOGLE" size="compact" />;
  }
  const icon = value === "keyword.text" || value === "keyword.language"
    ? "semantic"
    : value === "group.path"
      ? "projects"
      : value === "page.target_url"
        ? "pages"
        : value === "keyword.tags"
          ? "tag"
          : value === "ranking.position" || value === "ranking.url"
            ? "rankCheck"
            : value === "metric.observed_at"
              ? "history"
              : value === "ignore"
                ? "close"
                : value === "custom"
                  ? "plus"
                  : "trend";
  return <Icon className="import-mapping-target-icon" name={icon} />;
}

function suggestedMapping(
  preview: SemanticImportPreview
): readonly SemanticImportMappingColumn[] {
  const assigned = new Set<string>();
  return preview.columns.map((column) => {
    const suggested = MAPPING_TARGETS.some(
      (target) => target === column.suggestedTarget
    )
      ? column.suggestedTarget
      : "custom";
    const singleton = !["custom", "ignore"].includes(suggested);
    const target =
      singleton && assigned.has(suggested) ? "custom" : suggested;
    if (singleton) assigned.add(suggested);
    return {
      sourceIndex: column.index,
      target,
      ...(target === "custom"
        ? { customName: column.sourceName }
        : {})
    };
  });
}

function sourceMapping(
  preview: SemanticImportPreview,
  source: SemanticImportSource,
  detectedHistory: boolean
): readonly SemanticImportMappingColumn[] {
  if (source === "POSITIONS" && detectedHistory) {
    return positionHistoryMapping(preview);
  }
  if (source === "TOPVISOR") return presetMapping(preview, "TOPVISOR");
  if (source === "POSITIONS") return presetMapping(preview, "POSITIONS");
  return suggestedMapping(preview);
}

function presetMapping(
  preview: SemanticImportPreview,
  preset: "TOPVISOR" | "POSITIONS"
): readonly SemanticImportMappingColumn[] {
  const assigned = new Set<string>();
  return preview.columns.map((column) => {
    const normalized = column.sourceName.normalize("NFKC").trim().toLowerCase();
    const alias = importPresetTarget(normalized, preset);
    const suggested = alias ?? (
      MAPPING_TARGETS.includes(column.suggestedTarget as SemanticImportTarget)
        ? column.suggestedTarget
        : "custom"
    );
    const singleton = !["custom", "ignore"].includes(suggested);
    const target = singleton && assigned.has(suggested) ? "custom" : suggested;
    if (singleton) assigned.add(suggested);
    return {
      sourceIndex: column.index,
      target,
      ...(target === "custom" ? { customName: column.sourceName } : {})
    };
  });
}

function importPresetTarget(
  value: string,
  preset: "TOPVISOR" | "POSITIONS"
): SemanticImportTarget | undefined {
  if (/^(?:запрос|запросы|ключ|ключевая фраза|фраза|keyword|query)$/iu.test(value)) return "keyword.text";
  if (/^(?:группа|путь группы|папка|group|group path)$/iu.test(value)) return "group.path";
  if (/^(?:теги|метки|tags)$/iu.test(value)) return "keyword.tags";
  if (preset === "POSITIONS" && positionRankingUrlHeader(value)) return "ranking.url";
  if (/^(?:целевой url|целевая страница|посадочная страница|target url|landing page)$/iu.test(value)) return "page.target_url";
  if (/^(?:язык|language|locale)$/iu.test(value)) return "keyword.language";
  if (/^(?:заметка|комментарий|note|comment)$/iu.test(value)) return "keyword.note";
  if (/^(?:избранное|favorite)$/iu.test(value)) return "keyword.favorite";
  if (/^(?:отслеживается|отслеживать|tracked|tracking)$/iu.test(value)) return "keyword.tracked";
  if (/^(?:дата|дата проверки|дата съема|date|checked at|observed at)$/iu.test(value)) return "metric.observed_at";
  if (/^(?:поисковик|поисковая система|search engine)$/iu.test(value)) return "context.search_engine";
  if (/^(?:регион|город|region|city)$/iu.test(value)) return "context.region";
  if (/^(?:позиция яндекс|яндекс позиция|yandex position)$/iu.test(value)) return "ranking.yandex.position";
  if (/^(?:url яндекс|яндекс url|yandex url)$/iu.test(value)) return "ranking.yandex.url";
  if (/^(?:позиция google|google position)$/iu.test(value)) return "ranking.google.position";
  if (/^(?:url google|google url)$/iu.test(value)) return "ranking.google.url";
  if (preset === "POSITIONS" && /^(?:позиция|position|rank)$/iu.test(value)) return "ranking.position";
  return undefined;
}

function sourceHelp(source: SemanticImportSource): string {
  const messages: Readonly<Record<SemanticImportSource, string>> = {
    KEY_COLLECTOR: "Загрузите нативный .kc4. Поля сопоставятся автоматически, после проверки Сеньорита сразу перенесёт дерево, цвета, заметки, колонки, частотности, позиции, URL и сохранённую выдачу.",
    TOPVISOR: "Поддерживаются CSV, TSV и XLSX. Названия стандартных колонок Топвизора будут сопоставлены автоматически, остальные останутся доступными как свои поля.",
    UNIVERSAL: "Загрузите таблицу с заголовками. Перед публикацией можно назначить каждой колонке поле Сеньориты и проверить конфликты.",
    POSITIONS: "Поддерживаются широкая история с датами в колонках и построчный формат с колонками Запрос, Дата, Поисковик, Позиция и URL из выдачи."
  };
  return messages[source];
}

function sourceExampleLinks(source: SemanticImportSource): readonly Readonly<{ href: string; label: string }>[] {
  if (source === "POSITIONS") return [
    { href: "/examples/imports/positions-wide.csv", label: "Широкий CSV" },
    { href: "/examples/imports/positions-long.csv", label: "Построчный CSV" }
  ];
  if (source === "TOPVISOR") return [
    { href: "/examples/imports/topvisor.csv", label: "Пример CSV" }
  ];
  if (source === "KEY_COLLECTOR") return [
    { href: "/examples/imports/key-collector-columns.csv", label: "Пример колонок" }
  ];
  return [
    { href: "/examples/imports/keywords.csv", label: "Пример CSV" }
  ];
}

function isPositionHistoryPreview(preview: SemanticImportPreview): boolean {
  return positionHistoryDateCount(preview) > 0 && preview.columns.some(column =>
    /^(?:запрос(?:ы)?|ключ(?:евая фраза)?|фраза|query|keyword)$/iu.test(column.sourceName.normalize("NFKC").trim())
  );
}

function positionHistoryDateCount(preview: SemanticImportPreview): number {
  return preview.columns.filter(column => semanticPositionHistoryHeaderDate(column.sourceName)).length;
}

function positionHistoryMapping(preview: SemanticImportPreview): readonly SemanticImportMappingColumn[] {
  const keyword = preview.columns.find(column =>
    /^(?:запрос(?:ы)?|ключ(?:евая фраза)?|фраза|query|keyword)$/iu.test(column.sourceName.normalize("NFKC").trim())
  ) ?? preview.columns[0];
  if (!keyword) return [];
  const keywordLanguage = preview.columns.find(column =>
    /^(?:язык запроса|keyword language)$/iu.test(column.sourceName.normalize("NFKC").trim())
  );
  const rankingUrl = preview.columns.find(column =>
    positionRankingUrlHeader(column.sourceName)
  );
  return [
    { sourceIndex: keyword.index, target: "keyword.text" },
    ...(keywordLanguage ? [{ sourceIndex: keywordLanguage.index, target: "keyword.language" as const }] : []),
    ...(rankingUrl ? [{ sourceIndex: rankingUrl.index, target: "ranking.url" as const }] : [])
  ];
}

function positionRankingUrlHeader(value: string): boolean {
  return /^(?:url|урл|url из выдачи|урл из выдачи|ссылка из выдачи|найденный url|найденная страница|релевантный url|релевантная страница|url позиции|ranking url|ranking page|serp url|result url|relevant url)$/iu.test(
    value.normalize("NFKC").trim()
  );
}

function defaultPositionHistoryOptions(filename?: string): SemanticPositionHistoryImportOptions {
  const google = /google|гугл/iu.test(filename ?? "");
  return {
    searchEngine: google ? "GOOGLE" : "YANDEX",
    countryCode: "RU",
    regionCode: google ? "1011969" : "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP"
  };
}

function importIssueLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    COLUMN_COUNT_MISMATCH: "разное число колонок",
    KEYWORD_REQUIRED: "нет ключевой фразы",
    INVALID_TARGET_URL: "некорректный URL",
    INVALID_FREQUENCY: "некорректная частотность",
    INVALID_POSITION: "некорректная позиция",
    INVALID_POSITION_CHANGE: "некорректное изменение позиции",
    INVALID_RANKING_URL: "некорректный релевантный URL",
    POSITION_HISTORY_SUMMARY_SKIPPED: "сводная строка пропущена",
    POSITION_HISTORY_DATES_REQUIRED: "не найдены колонки с датами",
    POSITION_HISTORY_CONTEXT_INVALID: "некорректный город, устройство или поисковик",
    INVALID_LANGUAGE: "некорректный язык",
    INVALID_PRIORITY: "приоритет должен быть целым числом от 0 до 100",
    INVALID_FAVORITE: "некорректное значение избранного",
    INVALID_INTENT: "неизвестный интент",
    INVALID_OBSERVED_AT: "некорректная дата",
    GROUP_DEPTH_EXCEEDED: "группа глубже 10 уровней",
    TRACKING_CONTEXT_REQUIRED: "позиции сохранены до выбора контекста"
  };
  return labels[value] ?? value;
}

// The UI consumes the canonical contract list so a newly supported import
// field cannot silently disappear from the mapping dropdown.
const MAPPING_TARGETS = semanticImportTargets;

function formatInteger(value: string, uiLocale: string = "ru-RU"): string {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? new Intl.NumberFormat(uiLocale).format(parsed)
    : value;
}

function inspectionRejectionMessage(code: string | undefined): string {
  const messages: Readonly<Record<string, string>> = {
    MALWARE_DETECTED:
      "Файл отклонён: антивирус обнаружил небезопасное содержимое.",
    SIZE_MISMATCH:
      "Файл отклонён: фактический размер не совпал с заявленным.",
    CHECKSUM_MISMATCH:
      "Файл отклонён: контрольная сумма не совпала. Загрузите исходный файл заново.",
    MIME_SIGNATURE_MISMATCH:
      "Файл отклонён: его содержимое не соответствует выбранному формату.",
    FORBIDDEN_FILE_SIGNATURE:
      "Файл отклонён: обнаружен неподдерживаемый или исполняемый формат.",
    BINARY_TEXT_FILE:
      "Файл отклонён: CSV/TSV содержит бинарные данные."
  };
  return (
    (code && messages[code]) ||
    "Файл не прошёл проверку безопасности. Выберите корректный исходный файл."
  );
}

function uploadErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "PAYMENT_REQUIRED") {
      return "Проект доступен только для чтения. Пополните баланс для нового импорта.";
    }
    if (error.code === "FILE_TOO_LARGE") {
      return "Файл превышает допустимый размер.";
    }
    if (error.code === "DEPENDENCY_UNAVAILABLE") {
      return "S3 временно недоступен. Прогресс сохранён — повторите позже.";
    }
    if (isExpiredUploadError(error)) {
      return "Предыдущая загрузка истекла или была удалена. Сессия очищена — начните загрузку заново.";
    }
    return error.message;
  }
  return "Загрузка прервалась. Прогресс сохранён; выберите тот же файл и повторите.";
}

function isExpiredUploadError(error: unknown): boolean {
  return (
    error instanceof BrowserApiError &&
    ["NOT_FOUND", "RESOURCE_STATE_CONFLICT"].includes(error.code)
  );
}
