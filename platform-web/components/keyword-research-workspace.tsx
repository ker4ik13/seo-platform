"use client";

import { CustomSelect } from "./custom-select";

import {
  keysSoDatabases,
  type KeywordResearchCollection,
  type KeywordResearchRunSummary,
  type KeysSoDatabase,
  type SemanticImportDuplicatePolicy
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { ProviderLogo } from "./provider-logo";

const ACTIVE = new Set([
  "QUEUED",
  "RUNNING",
  "RETRY_SCHEDULED",
  "IMPORT_QUEUED",
  "IMPORTING"
]);

export function KeywordResearchWorkspace({
  projectId,
  projectDomain
}: Readonly<{ projectId: string; projectDomain: string }>) {
  const [collection, setCollection] = useState<KeywordResearchCollection>();
  const [domain, setDomain] = useState(projectDomain);
  const [database, setDatabase] = useState<KeysSoDatabase>("msk");
  const [maxKeywords, setMaxKeywords] = useState("100");
  const [duplicatePolicy, setDuplicatePolicy] =
    useState<SemanticImportDuplicatePolicy>("SKIP_EXISTING");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expandedRunId, setExpandedRunId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await browserApiRequest<KeywordResearchCollection>(
        path(projectId),
        signal ? { signal } : {}
      );
      setCollection(next);
      setError(undefined);
      const ready = next.runs.find(
        ({ status }) => status === "READY_TO_IMPORT"
      );
      setExpandedRunId((current) => current ?? ready?.id ?? next.runs[0]?.id);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(message(caught, "Не удалось загрузить сборы семантики."));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasActive = useMemo(
    () => collection?.runs.some(({ status }) => ACTIVE.has(status)) ?? false,
    [collection]
  );

  useEffect(() => {
    if (!hasActive) return;
    const timer = globalThis.setInterval(() => void load(), 4_000);
    return () => globalThis.clearInterval(timer);
  }, [hasActive, load]);

  const expanded = collection?.runs.find(({ id }) => id === expandedRunId);
  const selectionSeed =
    expanded?.status === "READY_TO_IMPORT"
      ? expanded.rows.map(({ id }) => id).join(",")
      : "";

  useEffect(() => {
    setSelected(new Set(selectionSeed ? selectionSeed.split(",") : []));
  }, [selectionSeed]);

  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || collection?.access.canRun !== true) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const run = await browserApiRequest<KeywordResearchRunSummary>(
        path(projectId),
        {
          method: "POST",
          idempotencyKey: `keyword-research:${globalThis.crypto.randomUUID()}`,
          body: {
            domain: domain.trim(),
            database,
            maxKeywords: Number(maxKeywords)
          }
        }
      );
      setExpandedRunId(run.id);
      setNotice(
        "Сбор поставлен в очередь. Предпросмотр появится автоматически."
      );
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось запустить сбор через Keys.so."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(run: KeywordResearchRunSummary): Promise<void> {
    if (busy || selected.size < 1 || collection?.access.canImport !== true) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await browserApiRequest<KeywordResearchRunSummary>(
        `${path(projectId)}/${encodeURIComponent(run.id)}/confirm`,
        {
          method: "POST",
          ifMatch: run.version,
          body: {
            selectedRowIds: [...selected],
            duplicatePolicy
          }
        }
      );
      setNotice("Выбранные запросы поставлены в очередь импорта.");
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось подтвердить импорт."));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(run: KeywordResearchRunSummary): Promise<void> {
    if (busy || !collection?.access.canCancel) return;
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest<KeywordResearchRunSummary>(
        `${path(projectId)}/${encodeURIComponent(run.id)}/cancel`,
        { method: "POST", ifMatch: run.version, body: {} }
      );
      setNotice("Сбор отменён.");
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось отменить сбор."));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !collection) {
    return (
      <section className="panel panel-empty" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <p>Загружаем сборы семантики…</p>
      </section>
    );
  }

  return (
    <div className="settings-stack">
      {error && <div className="inline-error" role="alert">{error}</div>}
      {notice && <div className="inline-success" role="status">{notice}</div>}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow provider-inline"><ProviderLogo provider="KEYS_SO" size="compact" /> Keys.so · organic keywords</p>
            <h2>Собрать запросы конкурента</h2>
            <p>
              Сначала сервис показывает найденные запросы. В ядро попадут
              только отмеченные строки после подтверждения.
            </p>
          </div>
          <a className="secondary-button" href="/app/settings/integrations">
            Настроить API
          </a>
        </div>
        <form className="settings-form" onSubmit={start}>
          <label className="form-field">
            <span>Домен конкурента</span>
            <input
              autoComplete="off"
              onChange={(event) => setDomain(event.target.value)}
              placeholder="competitor.ru"
              required
              value={domain}
            />
          </label>
          <label className="form-field">
            <span>База Keys.so</span>
            <CustomSelect
              onChange={(event) =>
                setDatabase(event.target.value as KeysSoDatabase)
              }
              value={database}
            >
              {keysSoDatabases.map((code) => (
                <option key={code} value={code}>
                  {databaseLabel(code)}
                </option>
              ))}
            </CustomSelect>
          </label>
          <label className="form-field">
            <span>Максимум запросов</span>
            <input
              max={500}
              min={25}
              onChange={(event) => setMaxKeywords(event.target.value)}
              required
              step={25}
              type="number"
              value={maxKeywords}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || collection?.access.canRun !== true}
            type="submit"
          >
            {busy ? "Подождите…" : "Начать сбор"}
          </button>
        </form>
        {collection?.access.mutationRestriction !== "NONE" && (
          <p className="inline-note">
            Запуск ограничен текущей ролью или состоянием проекта.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">История</p>
            <h2>Сборы и импорт</h2>
          </div>
          {hasActive && <span className="status-badge">Выполняется</span>}
        </div>
        {!collection || collection.runs.length === 0 ? (
          <div className="panel-empty">
            <strong>Сборов пока нет</strong>
            <p>Подключите Keys.so и запустите первый анализ конкурента.</p>
          </div>
        ) : (
          <div className="settings-stack">
            {collection.runs.map((run) => (
              <article className="subpanel" key={run.id}>
                <button
                  className="semantic-row-button"
                  onClick={() => setExpandedRunId(run.id)}
                  type="button"
                >
                  <span>
                    <strong>{run.domain}</strong>
                    <small>
                      {run.database} · {run.collectedKeywords} из{" "}
                      {run.totalAvailable ?? "?"}
                    </small>
                  </span>
                  <span className={`status-badge status-${run.status.toLowerCase()}`}>
                    {statusLabel(run.status)}
                  </span>
                </button>
                {expanded?.id === run.id && (
                  <RunPreview
                    busy={busy}
                    duplicatePolicy={duplicatePolicy}
                    onCancel={() => void cancel(run)}
                    onConfirm={() => void confirm(run)}
                    onDuplicatePolicy={setDuplicatePolicy}
                    onSelected={setSelected}
                    run={run}
                    selected={selected}
                    canCancel={collection.access.canCancel}
                    canImport={collection.access.canImport}
                  />
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RunPreview({
  run,
  selected,
  onSelected,
  duplicatePolicy,
  onDuplicatePolicy,
  onConfirm,
  onCancel,
  canImport,
  canCancel,
  busy
}: Readonly<{
  run: KeywordResearchRunSummary;
  selected: ReadonlySet<string>;
  onSelected: (value: ReadonlySet<string>) => void;
  duplicatePolicy: SemanticImportDuplicatePolicy;
  onDuplicatePolicy: (value: SemanticImportDuplicatePolicy) => void;
  onConfirm: () => void;
  onCancel: () => void;
  canImport: boolean;
  canCancel: boolean;
  busy: boolean;
}>) {
  const ready = run.status === "READY_TO_IMPORT";
  return (
    <div className="settings-stack">
      {run.failureCode && (
        <div className="inline-error">Ошибка: {run.failureCode}</div>
      )}
      {run.rows.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    aria-label="Выбрать все"
                    checked={
                      ready &&
                      run.rows.length > 0 &&
                      selected.size === run.rows.length
                    }
                    disabled={!ready}
                    onChange={(event) =>
                      onSelected(
                        event.target.checked
                          ? new Set(run.rows.map(({ id }) => id))
                          : new Set()
                      )
                    }
                    type="checkbox"
                  />
                </th>
                <th>Запрос</th>
                <th>Позиция</th>
                <th>Частотность</th>
                <th>KEI</th>
              </tr>
            </thead>
            <tbody>
              {run.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      aria-label={`Выбрать ${row.keyword}`}
                      checked={selected.has(row.id)}
                      disabled={!ready}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        onSelected(next);
                      }}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <strong>{row.keyword}</strong>
                    {row.url && <small className="table-secondary">{row.url}</small>}
                  </td>
                  <td>{row.position ?? "—"}</td>
                  <td>
                    {row.frequencyBase ?? "—"} / {row.frequencyExact ?? "—"} /{" "}
                    {row.frequencyFixed ?? "—"}
                  </td>
                  <td>{row.kei ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ready && (
        <div className="button-row">
          <label className="form-field">
            <span>Если запрос уже есть</span>
            <CustomSelect
              onChange={(event) =>
                onDuplicatePolicy(
                  event.target.value as SemanticImportDuplicatePolicy
                )
              }
              value={duplicatePolicy}
            >
              <option value="SKIP_EXISTING">Пропустить</option>
              <option value="OVERWRITE_MAPPED">Обновить метрики</option>
            </CustomSelect>
          </label>
          <button
            className="primary-button"
            disabled={!canImport || selected.size < 1 || busy}
            onClick={onConfirm}
            type="button"
          >
            Импортировать выбранные ({selected.size})
          </button>
        </div>
      )}
      {["QUEUED", "RUNNING", "RETRY_SCHEDULED", "READY_TO_IMPORT"].includes(
        run.status
      ) && (
        <button
          className="danger-button"
          disabled={!canCancel || busy}
          onClick={onCancel}
          type="button"
        >
          Отменить
        </button>
      )}
    </div>
  );
}

function path(projectId: string): string {
  return `/api/v1/projects/${encodeURIComponent(
    projectId
  )}/keyword-research-runs`;
}

function statusLabel(status: KeywordResearchRunSummary["status"]): string {
  return {
    QUEUED: "В очереди",
    RUNNING: "Собирается",
    RETRY_SCHEDULED: "Повтор",
    READY_TO_IMPORT: "Готов к импорту",
    IMPORT_QUEUED: "Импорт в очереди",
    IMPORTING: "Импортируется",
    COMPLETED: "Готово",
    FAILED: "Ошибка",
    CANCELLED: "Отменено"
  }[status];
}

function databaseLabel(database: KeysSoDatabase): string {
  const known: Partial<Record<KeysSoDatabase, string>> = {
    msk: "Москва · Google",
    zen: "Москва · Яндекс",
    spb: "Санкт-Петербург",
    gkv: "Казахстан",
    mns: "Минск",
    gny: "Нью-Йорк · English"
  };
  return known[database] ?? `Регион ${database.toUpperCase()}`;
}

function message(error: unknown, fallback: string): string {
  return error instanceof BrowserApiError ? error.message : fallback;
}
