"use client";

import type {
  SemanticHistoryEntityState,
  SemanticVersionChangeDetail,
  SemanticVersionDetail,
  SemanticVersionListItem
} from "@seo-platform/contracts";
import { useEffect, useMemo, useState } from "react";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { SemanticModal } from "./semantic-modal";
import { UiText, useUiLocale } from "./ui-locale";
import { SemanticSideDrawer } from "./semantic-side-drawer";


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
  const uiLocale = useUiLocale().locale;
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
            <h2><UiText text="История семантики" /></h2>
            <p><UiText text="Кто, когда и какие запросы или группы изменил" /></p>
          </div>
        </header>
      )}
      {error && (
        <div className="inline-alert danger" role="alert">
          <span>{<UiText text={error ?? ""} />}</span>
          <button
            className="text-button"
            onClick={() => setReloadVersion((value) => value + 1)}
            type="button"
          >
            <UiText text="Повторить" /></button>
        </div>
      )}
      {detailError && (
        <div className="inline-alert danger" role="alert">{<UiText text={detailError ?? ""} />}</div>
      )}
      {loading ? (
        <p className="muted-copy"><UiText text="Загружаем историю…" /></p>
      ) : groups.length === 0 ? (
        <div className="semantic-version-empty">
          <UiText text="История появится после первого добавления, изменения, переноса или импорта." /></div>
      ) : (
        <div className="semantic-version-list">
          {groups.map((group) => (
            <article key={group.id}>
              <div>
                <strong>{<UiText text={reasonLabel(group.reason) ?? ""} />}</strong>
                <span>{groupSummary(group)}</span>
                <small>
                  {formatDate(group.createdAt, uiLocale)} · {<UiText text={actorLabel(group) ?? ""} />} · {formatAffected(group.affectedCount)}
                </small>
              </div>
              <button
                className="text-button"
                disabled={detailLoadingId === group.id}
                onClick={() => void loadDetail(group)}
                type="button"
              >
                {detailLoadingId === group.id ? <UiText text="Загружаем…" /> : <UiText text="Подробнее" />}
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
        <SemanticSideDrawer
          ariaLabel="История семантического ядра"
          className="semantic-history-drawer"
          closeLabel="Закрыть историю"
          eyebrow="Изменения проекта"
          onClose={() => onClose?.()}
          presenceKey="semantic-history-drawer"
          title="История семантики"
        >
          <div className="semantic-history-body semantic-versions">{content}</div>
        </SemanticSideDrawer>
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
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const changes = detail.details.flatMap((item) => item.changes);
  const versions = detail.group.versions;
  return (
    <SemanticModal
      description={`${formatDate(detail.group.createdAt, uiLocale)} · ${actorLabel(detail.group)} · ${formatAffected(detail.group.affectedCount)}`}
      onClose={onClose}
      size="large"
      title={reasonLabel(detail.group.reason)}
    >
      <div className="semantic-history-detail">
        <section className="semantic-history-summary">
          <div><span><UiText text="Описание" /></span><strong>{groupSummary(detail.group)}</strong></div>
          <div><span><UiText text="Операций в пачке" /></span><strong>{versions.length}</strong></div>
          <div><span><UiText text="Затронуто" /></span><strong>{detail.group.affectedCount}</strong></div>
        </section>
        <section>
          <h3><UiText text="Запросы и изменения" /></h3>
          {changes.length === 0 ? (
            <div className="semantic-version-empty">
              <UiText text="Для этого старого действия построчная детализация не сохранялась." /></div>
          ) : (
            <div className="semantic-history-change-table semantic-history-compact-table" role="table" aria-label={uiText("Затронутые запросы и группы")}>
              <div className="semantic-history-change-head" role="row">
                <span><UiText text="Действие" /></span><span><UiText text="Запрос или объект" /></span><span><UiText text="Группа" /></span><span><UiText text="Изменения" /></span>
              </div>
              {changes.map((change, index) => (
                <div className="semantic-history-change-row" key={`${change.entityType}:${change.entityId}:${index}`} role="row">
                  <span className={`semantic-history-operation ${change.operation.toLowerCase()}`}>
                    {<UiText text={operationLabel(change.operation) ?? ""} />}
                  </span>
                  <div>
                    <strong>{change.after.title}</strong>
                  </div>
                  <span className="semantic-history-group-cell">{historyGroup(change)}</span>
                  <span className="semantic-history-fields-cell">{<UiText text={changedFieldsLabel(change) ?? ""} />}</span>
                </div>
              ))}
            </div>
          )}
          {detail.details.some(({ changesTruncated }) => changesTruncated) && (
            <p className="muted-copy"><UiText text="Для крупных операций показаны первые 500 строк каждой сохранённой части." /></p>
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
    IMPLICIT_DUPLICATES: "Удаление неявных дублей",
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

function formatDate(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function versionError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.status === 403) return "Недостаточно прав для просмотра истории.";
    return error.retryable ? "История временно недоступна. Повторите запрос." : error.message;
  }
  return "Не удалось загрузить историю изменений.";
}
