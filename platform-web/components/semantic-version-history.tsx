"use client";

import type {
  SemanticVersionListItem,
  SemanticVersionUndoPreview,
  SemanticVersionUndoResult
} from "@seo-platform/contracts";
import { useEffect, useState } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";

export function SemanticVersionHistory({
  projectId,
  refreshVersion,
  onRestored
}: Readonly<{
  projectId: string;
  refreshVersion: number;
  onRestored: () => void;
}>) {
  const [versions, setVersions] = useState<readonly SemanticVersionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<SemanticVersionUndoPreview>();
  const [previewingId, setPreviewingId] = useState<string>();
  const [undoIdempotencyKey, setUndoIdempotencyKey] =
    useState<string>();
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void browserApiRequest<readonly SemanticVersionListItem[]>(
      versionPath(projectId),
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setVersions(result);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(versionError(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, refreshVersion, reloadVersion]);

  async function loadPreview(versionId: string): Promise<void> {
    setPreviewingId(versionId);
    setPreview(undefined);
    setUndoIdempotencyKey(undefined);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await browserApiRequest<SemanticVersionUndoPreview>(
          `${versionPath(projectId)}/${encodeURIComponent(
            versionId
          )}/undo-preview`
        );
      setPreview(result);
      setUndoIdempotencyKey(`semantic-undo:${crypto.randomUUID()}`);
    } catch (requestError) {
      setError(versionError(requestError));
    } finally {
      setPreviewingId(undefined);
    }
  }

  async function restore(): Promise<void> {
    if (
      !preview ||
      !undoIdempotencyKey ||
      preview.applicable === 0 ||
      restoring
    ) {
      return;
    }
    if (
      !window.confirm(
        `Откатить ${preview.applicable} изменений версии №${preview.version.number}? Конфликтующие строки не будут перезаписаны.`
      )
    ) {
      return;
    }
    setRestoring(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<SemanticVersionUndoResult>(
        `${versionPath(projectId)}/${encodeURIComponent(
          preview.version.id
        )}/undo`,
        {
          method: "POST",
          body: {},
          idempotencyKey: undoIdempotencyKey
        }
      );
      setPreview(undefined);
      setUndoIdempotencyKey(undefined);
      setNotice(
        `Откат завершён: восстановлено ${result.applied}` +
          (result.conflicted > 0
            ? `, конфликтов ${result.conflicted}`
            : "")
      );
      setReloadVersion((value) => value + 1);
      onRestored();
    } catch (requestError) {
      setError(versionError(requestError));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="panel semantic-versions">
      <header className="panel-header">
        <div>
          <h2>История изменений</h2>
          <p>Версии, безопасный preview и откат без перезаписи новых правок</p>
        </div>
      </header>

      {notice && (
        <div className="inline-alert success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="inline-alert danger" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            onClick={() => setReloadVersion((value) => value + 1)}
            type="button"
          >
            Повторить
          </button>
        </div>
      )}

      {loading ? (
        <p className="muted-copy">Загружаем историю…</p>
      ) : versions.length === 0 ? (
        <div className="semantic-version-empty">
          История появится после первого изменения или импорта.
        </div>
      ) : (
        <div className="semantic-version-list">
          {versions.slice(0, 20).map((version) => (
            <article key={version.id}>
              <div>
                <strong>№{version.number} · {reasonLabel(version.reason)}</strong>
                <span>{version.summary}</span>
                <small>
                  {formatDate(version.createdAt)} · изменений{" "}
                  {version.affectedCount}
                </small>
              </div>
              {version.reversible ? (
                <button
                  className="text-button"
                  disabled={previewingId === version.id || restoring}
                  onClick={() => void loadPreview(version.id)}
                  type="button"
                >
                  {previewingId === version.id
                    ? "Проверяем…"
                    : "Проверить откат"}
                </button>
              ) : (
                <span className="semantic-version-readonly">
                  Только история
                </span>
              )}
            </article>
          ))}
        </div>
      )}

      {preview && (
        <div className="semantic-undo-preview">
          <div>
            <strong>Preview отката версии №{preview.version.number}</strong>
            <span>
              Можно восстановить: {preview.applicable}. Конфликты:{" "}
              {preview.conflicted}. Не поддерживается: {preview.unsupported}.
            </span>
          </div>
          {preview.conflicted > 0 && (
            <details>
              <summary>Показать конфликты</summary>
              <ul>
                {preview.changes
                  .filter(({ state }) => state !== "APPLICABLE")
                  .slice(0, 50)
                  .map((change) => (
                    <li key={change.entityId}>
                      {change.entityId} —{" "}
                      {conflictLabel(change.conflictCode)}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <div className="semantic-undo-actions">
            <button
              className="secondary-button"
              disabled={restoring}
              onClick={() => {
                setPreview(undefined);
                setUndoIdempotencyKey(undefined);
              }}
              type="button"
            >
              Закрыть
            </button>
            <button
              className="primary-button"
              disabled={restoring || preview.applicable === 0}
              onClick={() => void restore()}
              type="button"
            >
              {restoring ? "Откатываем…" : "Выполнить безопасный откат"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function versionPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(
    projectId
  )}/semantic-versions`;
}

function reasonLabel(reason: SemanticVersionListItem["reason"]): string {
  switch (reason) {
    case "KEYWORD_CREATE":
      return "добавление запроса";
    case "KEYWORD_UPDATE":
      return "изменение запроса";
    case "KEYWORD_DELETE":
      return "удаление запроса";
    case "CLUSTER_CREATE":
      return "создание кластера";
    case "CLUSTER_UPDATE":
      return "изменение кластера";
    case "CLUSTER_DELETE":
      return "удаление кластера";
    case "CLUSTER_BULK_UPDATE":
      return "массовое назначение посадочных";
    case "CLUSTER_MERGE":
      return "объединение кластеров";
    case "CLUSTER_SPLIT":
      return "разделение кластера";
    case "BULK_UPDATE":
      return "массовое изменение";
    case "IMPORT":
      return "импорт";
    case "UNDO":
      return "откат";
    case "LEGACY":
      return "системное изменение";
  }
}

function conflictLabel(code: string | undefined): string {
  switch (code) {
    case "NEWER_CHANGE":
      return "после версии строка уже изменена";
    case "ENTITY_UNAVAILABLE":
      return "строка больше недоступна";
    case "DUPLICATE_KEYWORD":
      return "исходный запрос уже занят другой строкой";
    case "GROUP_UNAVAILABLE":
      return "исходная группа удалена";
    case "CLUSTER_UNAVAILABLE":
      return "исходный кластер удалён";
    case "TARGET_PAGE_UNAVAILABLE":
      return "исходная целевая страница недоступна";
    case "PRIMARY_PAGE_UNAVAILABLE":
      return "исходная посадочная кластера недоступна";
    case "DUPLICATE_CLUSTER":
      return "исходное имя занято другим кластером";
    case "CLUSTER_NOT_EMPTY":
      return "кластер уже содержит запросы и не может быть удалён откатом";
    case "TAG_UNAVAILABLE":
      return "один из исходных тегов удалён";
    case "VERSION_NOT_REVERSIBLE":
      return "для версии нет полного undo package";
    default:
      return "изменение нельзя безопасно откатить";
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function versionError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.status === 403) {
      return "Недостаточно прав для просмотра или восстановления версии.";
    }
    if (error.status === 409 || error.status === 412) {
      return "Состояние изменилось. Обновите preview и повторите.";
    }
    return error.retryable
      ? "История временно недоступна. Повторите запрос."
      : error.message;
  }
  return "Не удалось обработать историю изменений.";
}
