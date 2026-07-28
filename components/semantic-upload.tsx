"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";

interface UploadSummary {
  readonly id: string;
  readonly status: string;
  readonly originalName: string;
  readonly sizeBytes: string;
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
  | "uploaded"
  | "cancelled";

const MAX_CONCURRENCY = 3;

export function SemanticUpload({
  projectId
}: Readonly<{ projectId: string }>) {
  const [file, setFile] = useState<File>();
  const [stage, setStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const activeRequests = useRef(new Set<XMLHttpRequest>());
  const cancelled = useRef(false);
  const busy = !["idle", "uploaded", "cancelled"].includes(stage);
  const statusText = useMemo(
    () => uploadStatus(stage, progress),
    [stage, progress]
  );

  function selectFile(event: ChangeEvent<HTMLInputElement>): void {
    const selected = event.target.files?.[0];
    setFile(selected);
    setStage("idle");
    setProgress(0);
    setMessage(undefined);
    setError(undefined);
  }

  async function upload(): Promise<void> {
    if (!file || busy) return;
    cancelled.current = false;
    setStage("preparing");
    setProgress(0);
    setError(undefined);
    setMessage(undefined);
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
      setProgress(100);
      setStage("uploaded");
      setMessage(
        `${result.originalName} загружен. Проверка checksum и безопасности будет выполнена в фоне.`
      );
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
          <p>CSV, TSV, XLS/XLSX или архив Key Collector до 5 ГБ</p>
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
          accept=".csv,.tsv,.xls,.xlsx,.zip"
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
      <div className="security-actions">
        <button
          className="primary-button"
          disabled={!file || busy}
          onClick={() => void upload()}
          type="button"
        >
          {stage === "uploaded" ? "Загрузить ещё раз" : "Начать загрузку"}
        </button>
        {busy && (
          <button
            className="secondary-button"
            onClick={() => void cancel()}
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

function uploadStatus(stage: UploadStage, progress: number): string {
  if (stage === "preparing") return "Создаём защищённую загрузку…";
  if (stage === "uploading") {
    return progress > 0 ? "Загружаем части в S3…" : "Получаем ссылки…";
  }
  if (stage === "completing") return "Проверяем целостность объекта…";
  if (stage === "uploaded") return "Загрузка завершена";
  return "";
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
