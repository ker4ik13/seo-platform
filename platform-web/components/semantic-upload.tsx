"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";

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
}

interface SemanticImportSummary {
  readonly id: string;
  readonly uploadId: string;
  readonly status: string;
  readonly stage: string;
  readonly progressBytes: string;
  readonly totalBytes: string;
  readonly preview?: SemanticImportPreview;
  readonly mapping?: {
    readonly columns: readonly SemanticImportMappingColumn[];
    readonly defaultLanguage: string;
    readonly groupSeparator: string;
    readonly duplicatePolicy: string;
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
  | "import-pending"
  | "preview"
  | "import-failed"
  | "uploaded"
  | "ready"
  | "completed"
  | "rejected"
  | "cancelled";

const MAX_CONCURRENCY = 3;
const INSPECTION_TIMEOUT_MS = 30 * 60 * 1_000;

export function SemanticUpload({
  projectId,
  onPublished
}: Readonly<{ projectId: string; onPublished?: () => void }>) {
  const [file, setFile] = useState<File>();
  const [stage, setStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [importPreview, setImportPreview] =
    useState<SemanticImportPreview>();
  const [mappingColumns, setMappingColumns] = useState<
    readonly SemanticImportMappingColumn[]
  >([]);
  const [duplicatePolicy, setDuplicatePolicy] =
    useState("SKIP_EXISTING");
  const [defaultLanguage, setDefaultLanguage] = useState("und");
  const [groupSeparator, setGroupSeparator] = useState("/");
  const [validation, setValidation] =
    useState<SemanticImportValidation>();
  const [importResult, setImportResult] =
    useState<SemanticImportResult>();
  const [importVersion, setImportVersion] = useState<number>();
  const [completedUploadId, setCompletedUploadId] = useState<string>();
  const [completedImportId, setCompletedImportId] = useState<string>();
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
    "ready",
    "completed",
    "rejected",
    "cancelled"
  ].includes(stage);
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
    onPublished?.();
  }

  useEffect(
    () => () => backgroundRequest.current?.abort(),
    []
  );

  function selectFile(event: ChangeEvent<HTMLInputElement>): void {
    backgroundRequest.current?.abort();
    const selected = event.target.files?.[0];
    setFile(selected);
    setStage("idle");
    setProgress(0);
    setCompletedUploadId(undefined);
    setCompletedImportId(undefined);
    setImportPreview(undefined);
    setMappingColumns([]);
    setDefaultLanguage("und");
    setGroupSeparator("/");
    setValidation(undefined);
    setImportResult(undefined);
    setImportVersion(undefined);
    setMessage(undefined);
    setError(undefined);
  }

  async function trackSemanticImport(
    importId: string,
    activeStage: "parsing" | "validating" | "publishing" = "parsing"
  ): Promise<void> {
    setStage(activeStage);
    const controller = new AbortController();
    backgroundRequest.current = controller;
    try {
      const semanticImport = await waitForSemanticImport(
        projectId,
        importId,
        controller.signal,
        (current, total) => {
          if (total > 0) {
            setProgress(Math.min(100, (current / total) * 100));
          }
        }
      );
      if (controller.signal.aborted) return;
      setCompletedImportId(semanticImport.id);
      setImportVersion(semanticImport.version);
      if (semanticImport.preview) {
        setImportPreview(semanticImport.preview);
      }
      if (
        semanticImport.status === "AWAITING_MAPPING" &&
        semanticImport.preview
      ) {
        setValidation(undefined);
        setImportResult(undefined);
        setMappingColumns(
          semanticImport.mapping?.columns ??
            suggestedMapping(semanticImport.preview)
        );
        setDuplicatePolicy(
          semanticImport.mapping?.duplicatePolicy ?? "SKIP_EXISTING"
        );
        setDefaultLanguage(
          semanticImport.mapping?.defaultLanguage ?? "und"
        );
        setGroupSeparator(
          semanticImport.mapping?.groupSeparator ?? "/"
        );
        setStage("preview");
        setMessage(
          `Распознано ${formatInteger(semanticImport.preview.totalRows)} строк. Проверьте предложенное сопоставление колонок.`
        );
      } else if (
        semanticImport.status === "AWAITING_CONFIRMATION" &&
        semanticImport.validation
      ) {
        setMappingColumns(semanticImport.mapping?.columns ?? []);
        setDuplicatePolicy(
          semanticImport.mapping?.duplicatePolicy ?? "SKIP_EXISTING"
        );
        setDefaultLanguage(
          semanticImport.mapping?.defaultLanguage ?? "und"
        );
        setGroupSeparator(
          semanticImport.mapping?.groupSeparator ?? "/"
        );
        setValidation(semanticImport.validation);
        setStage("validation-ready");
        setMessage(
          `Проверка завершена: ${formatInteger(semanticImport.validation.uniqueKeywordsToProcess)} уникальных запросов готовы к публикации.`
        );
      } else if (
        semanticImport.status === "COMPLETED" &&
        semanticImport.result
      ) {
        setImportResult(semanticImport.result);
        notifyPublished(semanticImport.result);
        setStage("completed");
        setMessage(
          `Импорт завершён. Создана версия ядра №${semanticImport.result.semanticVersionNumber}.`
        );
      } else if (semanticImport.status === "CANCELLED") {
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
        setStage("import-failed");
        setError(importFailureMessage(semanticImport.failureCode));
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
    signal?: AbortSignal
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
      await trackSemanticImport(semanticImport.id);
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

  async function validateImport(): Promise<void> {
    if (
      !completedImportId ||
      importVersion === undefined ||
      mappingColumns.length === 0
    ) {
      return;
    }
    setStage("validating");
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
              duplicatePolicy
            }
          }
        );
      setImportVersion(semanticImport.version);
      await trackSemanticImport(
        semanticImport.id,
        "validating"
      );
    } catch (validationError) {
      setStage("preview");
      setError(importCommandErrorMessage(validationError));
    }
  }

  async function publishImport(): Promise<void> {
    if (!completedImportId || importVersion === undefined) return;
    setStage("publishing");
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
        "publishing"
      );
    } catch (publishError) {
      setStage("validation-ready");
      setError(importCommandErrorMessage(publishError));
    }
  }

  async function cancelImport(): Promise<void> {
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
        setImportResult(semanticImport.result);
        if (semanticImport.result?.partial) {
          notifyPublished(semanticImport.result);
        }
        setStage("cancelled");
        setMessage("Импорт отменён.");
      } else {
        await trackSemanticImport(
          semanticImport.id,
          "publishing"
        );
      }
    } catch (cancelError) {
      setError(importCommandErrorMessage(cancelError));
    }
  }

  async function trackInspection(uploadId: string): Promise<void> {
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
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          ].includes(mediaType(file))
        ) {
          await startSemanticImport(inspected.id, controller.signal);
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

  async function upload(): Promise<void> {
    if (!file || busy) return;
    if (stage === "uploaded" && completedUploadId) {
      setError(undefined);
      setMessage(undefined);
      await trackInspection(completedUploadId);
      return;
    }
    if (stage === "import-pending" && completedImportId) {
      setError(undefined);
      setMessage(undefined);
      await trackSemanticImport(completedImportId);
      return;
    }
    cancelled.current = false;
    setStage("preparing");
    setProgress(0);
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
      await trackInspection(result.id);
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
  }

  return (
    <section className="panel semantic-upload">
      <header className="panel-header">
        <div>
          <h2>Импорт семантики</h2>
          <p>CSV, TSV или XLSX из Key Collector до 5 ГБ</p>
        </div>
      </header>
      {message && (
        <div className="inline-alert success" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="inline-alert danger" role="alert">
          {error}
        </div>
      )}
      <label className="upload-dropzone">
        <input
          accept=".csv,.tsv,.xlsx"
          disabled={busy}
          onChange={selectFile}
          type="file"
        />
        <strong>{file ? file.name : "Выберите файл семантики"}</strong>
        <span>
          {file
            ? formatBytes(file.size)
            : "Файл отправляется напрямую в S3 частями и не занимает память сервера"}
        </span>
      </label>
      {stage !== "idle" && stage !== "cancelled" && (
        <div className="upload-progress" aria-live="polite">
          <div>
            <span>{statusText}</span>
            <strong>{Math.round(progress)}%</strong>
          </div>
          <span className="upload-progress-track">
            <i style={{ width: `${progress}%` }} />
          </span>
        </div>
      )}
      {importPreview && (
        <div className="import-preview" aria-label="Предпросмотр импорта">
          <div className="import-preview-summary">
            <span>
              <strong>{formatInteger(importPreview.totalRows)}</strong>
              строк
            </span>
            <span>
              <strong>{formatInteger(importPreview.warningRows)}</strong>
              предупреждений
            </span>
            <span>
              <strong>{importPreview.columns.length}</strong>
              колонок
            </span>
          </div>
          <div className="import-preview-table" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {importPreview.columns.slice(0, 12).map((column) => {
                    const selected =
                      mappingColumns.find(
                        ({ sourceIndex }) => sourceIndex === column.index
                      ) ?? {
                        sourceIndex: column.index,
                        target: column.suggestedTarget
                      };
                    return (
                      <th key={column.index}>
                        <span>{column.sourceName}</span>
                        <select
                          aria-label={`Назначение колонки ${column.sourceName}`}
                          disabled={stage !== "preview"}
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
                              {mappingTargetLabel(target)}
                            </option>
                          ))}
                        </select>
                        {selected.target === "custom" && (
                          <input
                            aria-label={`Имя пользовательской колонки ${column.sourceName}`}
                            disabled={stage !== "preview"}
                            maxLength={160}
                            onChange={(event) =>
                              updateCustomName(
                                column.index,
                                event.target.value
                              )
                            }
                            value={selected.customName ?? column.sourceName}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {importPreview.sampleRows.slice(0, 5).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {importPreview.columns.slice(0, 12).map((column) => (
                      <td key={column.index}>
                        {row[column.index] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {importPreview.columns.length > 12 && (
            <small className="upload-note">
              В preview показаны первые 12 колонок из{" "}
              {importPreview.columns.length}; остальные значения сохранены в
              staging.
            </small>
          )}
          {stage === "preview" && (
            <div className="import-mapping-options">
              <label>
                Язык запросов
                <input
                  aria-label="Язык запросов по умолчанию"
                  maxLength={35}
                  onChange={(event) =>
                    setDefaultLanguage(event.target.value)
                  }
                  placeholder="ru, en или und"
                  value={defaultLanguage}
                />
              </label>
              <label>
                Разделитель групп
                <input
                  aria-label="Разделитель пути групп"
                  maxLength={8}
                  onChange={(event) =>
                    setGroupSeparator(event.target.value)
                  }
                  value={groupSeparator}
                />
              </label>
              <label>
                Дубли в проекте
                <select
                  onChange={(event) =>
                    setDuplicatePolicy(event.target.value)
                  }
                  value={duplicatePolicy}
                >
                  <option value="SKIP_EXISTING">
                    Пропустить существующие
                  </option>
                  <option value="MERGE_NON_EMPTY">
                    Заполнить только пустые поля
                  </option>
                  <option value="OVERWRITE_MAPPED">
                    Обновить сопоставленные поля
                  </option>
                </select>
              </label>
            </div>
          )}
        </div>
      )}
      {validation && (
        <div className="import-validation" aria-label="Проверка импорта">
          <div className="import-preview-summary">
            <span>
              <strong>
                {formatInteger(validation.uniqueKeywordsToProcess)}
              </strong>
              уникальных
            </span>
            <span>
              <strong>
                {formatInteger(validation.duplicateRowsInFile)}
              </strong>
              дублей в файле
            </span>
            <span>
              <strong>
                {formatInteger(validation.existingKeywordsInProject)}
              </strong>
              уже в проекте
            </span>
            <span>
              <strong>{formatInteger(validation.errorRows)}</strong>
              ошибок
            </span>
          </div>
          {Object.keys(validation.issueCounts).length > 0 && (
            <p className="upload-note">
              Проверка сохранила проблемные строки отдельно:{" "}
              {Object.entries(validation.issueCounts)
                .map(
                  ([code, count]) =>
                    `${importIssueLabel(code)} — ${formatInteger(count)}`
                )
                .join("; ")}
            </p>
          )}
        </div>
      )}
      {importResult && (
        <div className="import-validation" aria-label="Результат импорта">
          <div className="import-preview-summary">
            <span>
              <strong>{formatInteger(importResult.createdKeywords)}</strong>
              создано запросов
            </span>
            <span>
              <strong>{formatInteger(importResult.updatedKeywords)}</strong>
              обновлено
            </span>
            <span>
              <strong>{formatInteger(importResult.createdGroups)}</strong>
              новых групп
            </span>
            <span>
              <strong>
                {formatInteger(importResult.createdMetricSnapshots)}
              </strong>
              метрик
            </span>
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
            onClick={() => void validateImport()}
            type="button"
          >
            Проверить импорт
          </button>
        )}
        {stage === "validation-ready" && (
          <button
            className="primary-button"
            disabled={
              !validation ||
              validation.uniqueKeywordsToProcess === "0"
            }
            onClick={() => void publishImport()}
            type="button"
          >
            Импортировать{" "}
            {validation
              ? formatInteger(validation.uniqueKeywordsToProcess)
              : ""}
          </button>
        )}
        {!["preview", "validation-ready"].includes(stage) && (
          <button
            className="primary-button"
            disabled={!file || busy}
            onClick={() => void upload()}
            type="button"
          >
            {stage === "uploaded"
              ? "Обновить статус"
              : stage === "import-pending"
                ? "Обновить импорт"
                : stage === "validating"
                  ? "Проверяем импорт…"
                  : stage === "publishing"
                    ? "Публикуем ядро…"
                : [
                      "ready",
                      "rejected",
                      "import-failed",
                      "completed"
                    ].includes(stage)
                  ? "Загрузить ещё раз"
                  : "Начать загрузку"}
          </button>
        )}
        {canCancel && (
          <button
            className="secondary-button"
            onClick={() =>
              void (completedImportId &&
              semanticCancellationStages.includes(stage)
                ? cancelImport()
                : cancel())
            }
            type="button"
          >
            Отменить
          </button>
        )}
      </div>
      <small className="upload-note">
        После загрузки файл не публикуется сразу: сначала идут антивирусная
        проверка, распознавание колонок и preview конфликтов.
      </small>
    </section>
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
    request.open("PUT", url);
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
  onProgress: (current: number, total: number) => void
): Promise<SemanticImportSummary> {
  const startedAt = Date.now();
  let delayMs = 1_000;
  while (Date.now() - startedAt < INSPECTION_TIMEOUT_MS) {
    const semanticImport = await browserApiRequest<SemanticImportSummary>(
      `/app/api/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(importId)}`,
      { signal }
    );
    onProgress(
      Number(semanticImport.progressBytes),
      Number(semanticImport.totalBytes)
    );
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
  if (stage === "import-pending") return "Импорт обрабатывается в фоне";
  if (stage === "preview") return "Предпросмотр импорта готов";
  if (stage === "import-failed") return "Файл не удалось разобрать";
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
      return "Этот формат пока нельзя разобрать. Поддерживаются CSV, TSV и XLSX; legacy XLS и ZIP требуют отдельного конвертера.";
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

function importFailureMessage(code: string | undefined): string {
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
      "Сервис семантики отклонил публикацию. Данные staging сохранены для диагностики."
  };
  return (
    (code && messages[code]) ||
    "Файл не удалось разобрать. Проверьте формат, кодировку и разделитель."
  );
}

function mappingTargetLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    "keyword.text": "Ключевая фраза",
    "group.path": "Путь группы",
    "page.target_url": "Целевая страница",
    "frequency.base": "Базовая частотность",
    "frequency.exact": "Точная частотность",
    "frequency.fixed": "Фиксированная частотность",
    "ranking.position": "Позиция",
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

function importIssueLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    COLUMN_COUNT_MISMATCH: "разное число колонок",
    KEYWORD_REQUIRED: "нет ключевой фразы",
    INVALID_TARGET_URL: "некорректный URL",
    INVALID_FREQUENCY: "некорректная частотность",
    INVALID_OBSERVED_AT: "некорректная дата",
    GROUP_DEPTH_EXCEEDED: "группа глубже 10 уровней",
    TRACKING_CONTEXT_REQUIRED: "позиции сохранены до выбора контекста"
  };
  return labels[value] ?? value;
}

const MAPPING_TARGETS = [
  "ignore",
  "keyword.text",
  "group.path",
  "page.target_url",
  "frequency.base",
  "frequency.exact",
  "frequency.fixed",
  "ranking.position",
  "context.search_engine",
  "context.region",
  "metric.observed_at",
  "keyword.tags",
  "metric.kei",
  "custom"
] as const;

function formatInteger(value: string): string {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? new Intl.NumberFormat("ru-RU").format(parsed)
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
