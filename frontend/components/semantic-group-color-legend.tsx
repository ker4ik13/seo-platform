"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import {
  semanticGroupColorLegendNoteMaxLength,
  type SemanticGroupColorLegend,
  type SemanticGroupPaletteColor
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { semanticGroupColors } from "../lib/semantic-group-colors";
import { Icon } from "./icon";
import { SemanticModal } from "./semantic-modal";

export function SemanticGroupColorLegendControl({
  onLegendChange,
  projectId,
  refreshVersion
}: Readonly<{
  onLegendChange?: (legend: SemanticGroupColorLegend | undefined) => void;
  projectId: string;
  refreshVersion: number;
}>) {
  const [legend, setLegend] = useState<SemanticGroupColorLegend>();
  const [draft, setDraft] = useState<Readonly<Record<string, string>>>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [remoteConflict, setRemoteConflict] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const openRef = useRef(false);
  const legendRef = useRef<SemanticGroupColorLegend | undefined>(undefined);
  const draftRef = useRef<Readonly<Record<string, string>>>({});

  useEffect(() => {
    onLegendChange?.(legend);
  }, [legend, onLegendChange]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    legendRef.current = undefined;
    setLegend(undefined);
    setDraft({});
    setOpen(false);
    setMutationError(undefined);
    setNotice(undefined);
    setRemoteConflict(false);
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    void browserApiRequest<SemanticGroupColorLegend>(legendPath(projectId), {
      signal: controller.signal
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        const previousLegend = legendRef.current;
        const hasLocalEdits =
          openRef.current &&
          previousLegend !== undefined &&
          !sameLegendDraft(draftRef.current, previousLegend);
        legendRef.current = result;
        setLegend(result);
        if (hasLocalEdits) {
          setRemoteConflict(true);
          setMutationError(
            "Примечание изменили в другой вкладке. Примите актуальную версию и повторите правку."
          );
        } else {
          setDraft(draftFromLegend(result));
          setRemoteConflict(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadError("Не удалось загрузить примечание по цветам.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, refreshVersion, retryVersion]);

  const normalizedEntries = useMemo(
    () => normalizedEntriesFromDraft(draft),
    [draft]
  );
  const dirty = legend
    ? JSON.stringify(normalizedEntries) !== JSON.stringify(legend.entries)
    : false;
  const configuredCount = legend?.entries.length ?? 0;

  function showLegend(): void {
    setOpen(true);
    setMutationError(undefined);
    setNotice(undefined);
    if (legend) setDraft(draftFromLegend(legend));
    if (!legend?.unread) return;
    void browserApiRequest<SemanticGroupColorLegend>(
      `${legendPath(projectId)}/seen`,
      { method: "POST", body: { version: legend.version } }
    )
      .then((result) => {
        legendRef.current = result;
        setLegend(result);
      })
      .catch(() => {
        setMutationError(
          "Примечание открыто, но отметку о просмотре сохранить не удалось."
        );
      });
  }

  async function save(): Promise<void> {
    if (!legend?.access.canManage || saving || !dirty || remoteConflict) return;
    setSaving(true);
    setMutationError(undefined);
    setNotice(undefined);
    try {
      const result = await browserApiRequest<SemanticGroupColorLegend>(
        legendPath(projectId),
        {
          method: "PATCH",
          body: { entries: normalizedEntries },
          ifMatch: legend.version
        }
      );
      legendRef.current = result;
      setLegend(result);
      setDraft(draftFromLegend(result));
      setRemoteConflict(false);
      setNotice("Общее примечание по цветам сохранено");
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 412) {
        setRemoteConflict(true);
        setMutationError(
          "Примечание уже изменили. Загружаем актуальную версию."
        );
        setRetryVersion((value) => value + 1);
      } else {
        setMutationError(
          "Не удалось сохранить примечание по цветам. Повторите попытку."
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        aria-busy={loading || undefined}
        aria-label={legend?.unread
          ? "Примечание по цветам: есть непросмотренные изменения"
          : "Открыть примечание по цветам"}
        className={`semantic-group-legend-trigger${configuredCount > 0 ? " configured" : ""}${legend?.unread ? " unread" : ""}`}
        onClick={showLegend}
        title={legend?.unread
          ? "Примечание по цветам обновилось"
          : "Примечание по цветам"}
        type="button"
      >
        <Icon name="palette" />
        {legend?.unread && <i aria-hidden="true" />}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <SemanticModal
          className="semantic-group-color-legend-modal"
          description={legend?.access.canManage
            ? "Общее для проекта. Пустые цвета не будут считаться настроенными."
            : "Общее для проекта. Изменять может SEO Lead, Admin или Owner."}
          footer={
            <div className="semantic-group-color-legend-actions">
              {legend?.access.canManage && (
                <button
                  className="secondary-button"
                  disabled={saving || !dirty}
                  onClick={() => legend && setDraft(draftFromLegend(legend))}
                  type="button"
                >
                  Отменить изменения
                </button>
              )}
              <button
                className={legend?.access.canManage ? "primary-button" : "secondary-button"}
                disabled={legend?.access.canManage
                  ? saving || !dirty || loading || Boolean(loadError) || remoteConflict
                  : false}
                onClick={legend?.access.canManage ? () => void save() : () => setOpen(false)}
                type="button"
              >
                {legend?.access.canManage
                  ? saving ? "Сохраняем…" : "Сохранить"
                  : "Закрыть"}
              </button>
            </div>
          }
          onClose={() => {
            if (saving) return;
            setOpen(false);
            if (legend) setDraft(draftFromLegend(legend));
          }}
          size="large"
          title="Примечание по цветам групп"
        >
          <div className="semantic-group-color-legend">
            <section className="semantic-group-color-legend-summary">
              <div>
                <strong>{configuredCount} из {semanticGroupColors.length}</strong>
                <span>цветов имеют общее пояснение</span>
              </div>
              {legend?.updatedAt && (
                <small>Обновлено {formatUpdatedAt(legend.updatedAt)}</small>
              )}
            </section>

            {loadError && (
              <div className="semantic-group-color-legend-state error" role="alert">
                <span>{loadError}</span>
                <button onClick={() => setRetryVersion((value) => value + 1)} type="button">
                  Повторить
                </button>
              </div>
            )}
            {loading && !legend && (
              <div className="semantic-group-color-legend-state" role="status">
                Загружаем проектное примечание…
              </div>
            )}
            {mutationError && (
              <div className="semantic-group-color-legend-state error" role="alert">
                <span>{mutationError}</span>
                {remoteConflict && legend && (
                  <button
                    disabled={loading}
                    onClick={() => {
                      setDraft(draftFromLegend(legend));
                      setRemoteConflict(false);
                      setMutationError(undefined);
                    }}
                    type="button"
                  >
                    Принять актуальную
                  </button>
                )}
              </div>
            )}
            {notice && <div className="semantic-group-color-legend-state success" role="status">{notice}</div>}

            {legend && (
              <div className="semantic-group-color-legend-grid">
                {semanticGroupColors.map(({ value, label }) => (
                  <ColorLegendEntry
                    canManage={legend.access.canManage}
                    color={value}
                    key={value}
                    label={label}
                    note={draft[value] ?? ""}
                    onChange={(note) => {
                      setDraft((current) => ({ ...current, [value]: note }));
                      setMutationError(undefined);
                      setNotice(undefined);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </SemanticModal>,
        document.body
      )}
    </>
  );
}

function ColorLegendEntry({
  canManage,
  color,
  label,
  note,
  onChange
}: Readonly<{
  canManage: boolean;
  color: SemanticGroupPaletteColor;
  label: string;
  note: string;
  onChange: (value: string) => void;
}>) {
  return (
    <label className={`semantic-group-color-legend-entry${note.trim() ? " configured" : ""}`}>
      <i aria-hidden="true" style={{ backgroundColor: color }} />
      <span>
        <strong>{label}</strong>
        <small>{color.toUpperCase()}</small>
      </span>
      {canManage ? (
        <textarea
          aria-label={`Пояснение для цвета ${label}`}
          maxLength={semanticGroupColorLegendNoteMaxLength}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Например: ждёт сбора позиций"
          rows={2}
          value={note}
        />
      ) : (
        <p>{note.trim() || "Примечание не задано"}</p>
      )}
    </label>
  );
}

function draftFromLegend(
  legend: SemanticGroupColorLegend
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    legend.entries.map(({ color, note }) => [color, note])
  );
}

function normalizeNote(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizedEntriesFromDraft(
  draft: Readonly<Record<string, string>>
): readonly Readonly<{ color: SemanticGroupPaletteColor; note: string }>[] {
  return semanticGroupColors.flatMap(({ value }) => {
    const note = normalizeNote(draft[value] ?? "");
    return note ? [{ color: value, note }] : [];
  });
}

function sameLegendDraft(
  draft: Readonly<Record<string, string>>,
  legend: SemanticGroupColorLegend
): boolean {
  return JSON.stringify(normalizedEntriesFromDraft(draft)) ===
    JSON.stringify(legend.entries);
}

function legendPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/semantic-group-color-legend`;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "недавно";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
