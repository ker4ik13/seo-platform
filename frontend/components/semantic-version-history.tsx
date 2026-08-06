"use client";

import type {
  SemanticHistoryEntityState,
  SemanticHistoryField,
  SemanticVersionChangeDetail,
  SemanticVersionDetail,
  SemanticVersionListItem
} from "@seo-platform/contracts";
import { useEffect, useMemo, useState } from "react";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { SemanticModal } from "./semantic-modal";

interface SemanticHistoryGroup {
  readonly id: string;
  readonly versions: readonly SemanticVersionListItem[];
  readonly reason: SemanticVersionListItem["reason"];
  readonly actorId: string;
  readonly actorDisplayName?: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly affectedCount: number;
}

interface SemanticHistoryGroupDetail {
  readonly group: SemanticHistoryGroup;
  readonly details: readonly SemanticVersionDetail[];
}

const HISTORY_BATCH_GAP_MS = 120_000;

export function SemanticVersionHistory({
  drawer = false,
  onClose,
  projectId,
  refreshVersion
}: Readonly<{
  drawer?: boolean;
  onClose?: () => void;
  projectId: string;
  refreshVersion: number;
}>) {
  const [versions, setVersions] = useState<readonly SemanticVersionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [detail, setDetail] = useState<SemanticHistoryGroupDetail>();
  const [detailLoadingId, setDetailLoadingId] = useState<string>();
  const [detailError, setDetailError] = useState<string>();
  const [reloadVersion, setReloadVersion] = useState(0);
  const groups = useMemo(() => groupVersions(versions), [versions]);

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
        if (!controller.signal.aborted) setError(versionError(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, refreshVersion, reloadVersion]);

  async function loadDetail(group: SemanticHistoryGroup): Promise<void> {
    setDetailLoadingId(group.id);
    setDetailError(undefined);
    try {
      const details = await Promise.all(
        group.versions.map((version) =>
          browserApiRequest<SemanticVersionDetail>(
            `${versionPath(projectId)}/${encodeURIComponent(version.id)}`
          )
        )
      );
      setDetail({ group, details });
    } catch (requestError) {
      setDetailError(versionError(requestError));
    } finally {
      setDetailLoadingId(undefined);
    }
  }

  const content = (
    <>
      {!drawer && (
        <header className="panel-header">
          <div>
            <h2>История семантики</h2>
            <p>Кто, когда и какие запросы или группы изменил</p>
          </div>
        </header>
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
      {detailError && (
        <div className="inline-alert danger" role="alert">{detailError}</div>
      )}
      {loading ? (
        <p className="muted-copy">Загружаем историю…</p>
      ) : groups.length === 0 ? (
        <div className="semantic-version-empty">
          История появится после первого добавления, изменения, переноса или импорта.
        </div>
      ) : (
        <div className="semantic-version-list">
          {groups.map((group) => (
            <article key={group.id}>
              <div>
                <strong>{reasonLabel(group.reason)}</strong>
                <span>{groupSummary(group)}</span>
                <small>
                  {formatDate(group.createdAt)} · {actorLabel(group)} · {formatAffected(group.affectedCount)}
                </small>
              </div>
              <button
                className="text-button"
                disabled={detailLoadingId === group.id}
                onClick={() => void loadDetail(group)}
                type="button"
              >
                {detailLoadingId === group.id ? "Загружаем…" : "Подробнее"}
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );

  return (
    <>
      {drawer ? (
        <aside aria-label="История семантического ядра" className="semantic-history-drawer">
          <header className="semantic-sidebar-header">
            <div>
              <span>Изменения проекта</span>
              <h2>История семантики</h2>
            </div>
            <button aria-label="Закрыть историю" onClick={onClose} type="button">×</button>
          </header>
          <div className="semantic-history-body semantic-versions">{content}</div>
        </aside>
      ) : (
        <section className="panel semantic-versions">{content}</section>
      )}
      {detail && (
        <SemanticHistoryDetail
          detail={detail}
          onClose={() => setDetail(undefined)}
        />
      )}
    </>
  );
}

function SemanticHistoryDetail({
  detail,
  onClose
}: Readonly<{
  detail: SemanticHistoryGroupDetail;
  onClose: () => void;
}>) {
  const changes = detail.details.flatMap((item) => item.changes);
  const parameters = uniqueParameters(detail.details.flatMap((item) => item.parameters));
  const versions = detail.group.versions;
  return (
    <SemanticModal
      description={`${formatDate(detail.group.createdAt)} · ${actorLabel(detail.group)} · ${formatAffected(detail.group.affectedCount)}`}
      footer={
        <button className="primary-button" onClick={onClose} type="button">
          Закрыть
        </button>
      }
      onClose={onClose}
      size="large"
      title={reasonLabel(detail.group.reason)}
    >
      <div className="semantic-history-detail">
        <section className="semantic-history-summary">
          <div><span>Описание</span><strong>{groupSummary(detail.group)}</strong></div>
          <div><span>Операций в пачке</span><strong>{versions.length}</strong></div>
          <div><span>Затронуто</span><strong>{detail.group.affectedCount}</strong></div>
        </section>
        {parameters.length > 0 && (
          <section>
            <h3>Параметры действия</h3>
            <dl className="semantic-history-parameters">
              {parameters.map((field) => (
                <div key={`${field.key}:${field.value}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>
              ))}
            </dl>
          </section>
        )}
        <section>
          <h3>Запросы и изменения</h3>
          {changes.length === 0 ? (
            <div className="semantic-version-empty">
              Для этого старого действия построчная детализация не сохранялась.
            </div>
          ) : (
            <div className="semantic-history-change-table semantic-history-compact-table" role="table" aria-label="Затронутые запросы и группы">
              <div className="semantic-history-change-head" role="row">
                <span>Действие</span><span>Запрос или объект</span><span>Группа</span><span>Изменения</span>
              </div>
              {changes.map((change, index) => (
                <div className="semantic-history-change-row" key={`${change.entityType}:${change.entityId}:${index}`} role="row">
                  <span className={`semantic-history-operation ${change.operation.toLowerCase()}`}>
                    {operationLabel(change.operation)}
                  </span>
                  <div>
                    <strong>{change.after.title}</strong>
                    <small>{change.entityType === "KEYWORD" ? "Запрос" : "Группа"} · {shortId(change.entityId)}</small>
                  </div>
                  <span className="semantic-history-group-cell">{historyGroup(change)}</span>
                  <span className="semantic-history-fields-cell">{changedFieldsLabel(change)}</span>
                </div>
              ))}
            </div>
          )}
          {detail.details.some(({ changesTruncated }) => changesTruncated) && (
            <p className="muted-copy">Для крупных операций показаны первые 500 строк каждой сохранённой части.</p>
          )}
        </section>
      </div>
    </SemanticModal>
  );
}

function groupVersions(versions: readonly SemanticVersionListItem[]): readonly SemanticHistoryGroup[] {
  const groups: SemanticHistoryGroup[] = [];
  for (const version of versions) {
    const previous = groups.at(-1);
    if (previous && belongsToGroup(previous, version)) {
      groups[groups.length - 1] = {
        ...previous,
        versions: [...previous.versions, version],
        affectedCount: previous.affectedCount + version.affectedCount
      };
      continue;
    }
    groups.push({
      id: version.id,
      versions: [version],
      reason: version.reason,
      actorId: version.actorId,
      ...(version.actorDisplayName ? { actorDisplayName: version.actorDisplayName } : {}),
      summary: version.summary,
      createdAt: version.createdAt,
      affectedCount: version.affectedCount
    });
  }
  return groups;
}

function belongsToGroup(group: SemanticHistoryGroup, version: SemanticVersionListItem): boolean {
  const latest = group.versions.at(-1);
  if (!latest) return false;
  const sameOperation =
    group.reason === version.reason &&
    group.actorId === version.actorId &&
    group.summary === version.summary &&
    (latest.sourceJobId ?? "") === (version.sourceJobId ?? "");
  if (!sameOperation) return false;
  if (latest.sourceJobId) return true;
  return Math.abs(new Date(latest.createdAt).getTime() - new Date(version.createdAt).getTime()) <= HISTORY_BATCH_GAP_MS;
}

function uniqueParameters(fields: readonly SemanticHistoryField[]): readonly SemanticHistoryField[] {
  const values = new Map<string, SemanticHistoryField>();
  for (const field of fields) values.set(`${field.key}:${field.value}`, field);
  return [...values.values()];
}

function historyGroup(change: SemanticVersionChangeDetail): string {
  return stateField(change.after, "groupId") ?? stateField(change.before, "groupId") ?? "—";
}

function changedFieldsLabel(change: SemanticVersionChangeDetail): string {
  if (change.operation === "CREATE") return "Добавлен со всеми параметрами";
  if (change.operation === "DELETE") return "Перемещён в корзину или удалён";
  return change.changedFields.length > 0 ? change.changedFields.join(", ") : "Параметры не менялись";
}

function stateField(state: SemanticHistoryEntityState | undefined, key: string): string | undefined {
  return state?.fields.find((field) => field.key === key)?.value;
}

function groupSummary(group: SemanticHistoryGroup): string {
  if (group.versions.length === 1) return group.summary;
  return `${group.summary} · ${formatAffected(group.affectedCount)}`;
}

function versionPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/semantic-versions`;
}

function reasonLabel(reason: SemanticVersionListItem["reason"]): string {
  const labels: Record<SemanticVersionListItem["reason"], string> = {
    KEYWORD_CREATE: "Добавление запросов",
    KEYWORD_UPDATE: "Изменение запросов",
    KEYWORD_DELETE: "Удаление запросов",
    CLUSTER_CREATE: "Создание группы",
    CLUSTER_UPDATE: "Изменение группы",
    CLUSTER_DELETE: "Удаление группы",
    CLUSTER_BULK_UPDATE: "Массовое изменение групп",
    CLUSTER_MERGE: "Объединение групп",
    CLUSTER_SPLIT: "Разделение группы",
    BULK_UPDATE: "Массовое изменение запросов",
    CLEANING: "Очистка запросов",
    NEGATIVE_KEYWORDS: "Применение минус-слов",
    IMPORT: "Импорт запросов",
    UNDO: "Служебное изменение",
    LEGACY: "Системное изменение"
  };
  return labels[reason];
}

function operationLabel(value: "CREATE" | "UPDATE" | "DELETE"): string {
  return value === "CREATE" ? "Добавлено" : value === "DELETE" ? "Удалено" : "Изменено";
}

function actorLabel(version: Pick<SemanticHistoryGroup, "actorDisplayName" | "actorId">): string {
  return version.actorDisplayName ?? `Пользователь ${version.actorId.slice(0, 8)}`;
}

function formatAffected(value: number): string {
  const lastTwo = value % 100;
  const last = value % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? "объектов" : last === 1 ? "объект" : last >= 2 && last <= 4 ? "объекта" : "объектов";
  return `${value} ${noun}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function versionError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.status === 403) return "Недостаточно прав для просмотра истории.";
    return error.retryable ? "История временно недоступна. Повторите запрос." : error.message;
  }
  return "Не удалось загрузить историю изменений.";
}
