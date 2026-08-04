"use client";

import { CustomSelect } from "./custom-select";

import type {
  ProjectConnectorBinding,
  ProjectConnectorSettings
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import {
  integrationCredentialStatusPresentation,
  integrationProviderLabel
} from "../lib/integration-presentation";
import { ProviderLogo } from "./provider-logo";

const CAPABILITY = "COMPETITOR_RESEARCH";

export function KeywordResearchConnectorSetup({
  projectId
}: Readonly<{ projectId: string }>) {
  const [settings, setSettings] = useState<ProjectConnectorSettings>();
  const [credentialId, setCredentialId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const createCommand = useRef<
    Readonly<{ signature: string; key: string }> | undefined
  >(undefined);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await browserApiRequest<ProjectConnectorSettings>(
        path(projectId),
        signal ? { signal } : {}
      );
      if (signal?.aborted) return;
      setSettings(result);
      const current = binding(result);
      setCredentialId(current?.route.credentialId ?? "");
      setEnabled(current?.enabled ?? true);
      setError(undefined);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(message(caught, "Не удалось загрузить источник Keys.so."));
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

  const current = settings ? binding(settings) : undefined;
  const options = useMemo(
    () =>
      settings?.credentialOptions.filter(
        (credential) =>
          credential.provider === "KEYS_SO" &&
          credential.mode === "BYOK_API_KEY" &&
          credential.capabilities.includes(CAPABILITY)
      ) ?? [],
    [settings]
  );
  const eligible = options.filter(({ status }) => status === "ACTIVE");
  const selected = settings?.credentialOptions.find(
    ({ id }) => id === credentialId
  );
  const ready = Boolean(
    current?.enabled &&
      selected?.status === "ACTIVE" &&
      selected.provider === "KEYS_SO"
  );
  const dirty = Boolean(
    settings &&
      (current
        ? current.route.credentialId !== credentialId ||
          current.enabled !== enabled
        : credentialId)
  );
  const canSubmit = Boolean(
    settings?.access.canUpdateBindings &&
      settings.access.mutationRestriction === "NONE" &&
      dirty &&
      (eligible.some(({ id }) => id === credentialId) ||
        (!enabled &&
          current &&
          current.route.credentialId === credentialId))
  );

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!settings || !canSubmit || saving) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    const body = {
      enabled,
      route: {
        position: 0 as const,
        sourceKind: "WORKSPACE_CREDENTIAL" as const,
        credentialId
      },
      fallbackPolicy: { mode: "NONE" as const },
      budgetPolicy: { mode: "DISABLED" as const }
    };
    try {
      const updated = current
        ? await browserApiRequest<ProjectConnectorBinding>(
            `${path(projectId)}/${encodeURIComponent(current.id)}`,
            {
              method: "PATCH",
              ifMatch: current.version,
              body
            }
          )
        : await createBinding(projectId, body);
      setSettings({
        ...settings,
        bindings: [
          ...settings.bindings.filter(
            (candidate) =>
              candidate.id !== updated.id &&
              candidate.capability !== CAPABILITY
          ),
          updated
        ]
      });
      setCredentialId(updated.route.credentialId);
      setEnabled(updated.enabled);
      createCommand.current = undefined;
      setNotice(
        updated.enabled
          ? "Keys.so назначен источником сбора конкурентов."
          : "Источник Keys.so выключен."
      );
    } catch (caught) {
      if (
        caught instanceof BrowserApiError &&
        (caught.status === 409 || caught.status === 412)
      ) {
        await load();
        setError(
          "Источник уже изменён другим участником. Загружена актуальная версия."
        );
      } else {
        setError(message(caught, "Не удалось сохранить источник Keys.so."));
      }
    } finally {
      setSaving(false);
    }
  }

  async function createBinding(
    currentProjectId: string,
    body: Readonly<{
      enabled: boolean;
      route: Readonly<{
        position: 0;
        sourceKind: "WORKSPACE_CREDENTIAL";
        credentialId: string;
      }>;
      fallbackPolicy: Readonly<{ mode: "NONE" }>;
      budgetPolicy: Readonly<{ mode: "DISABLED" }>;
    }>
  ): Promise<ProjectConnectorBinding> {
    const payload = { capability: CAPABILITY, ...body };
    const signature = JSON.stringify(payload);
    if (createCommand.current?.signature !== signature) {
      createCommand.current = {
        signature,
        key: `project-competitor-connector:${globalThis.crypto.randomUUID()}`
      };
    }
    return browserApiRequest<ProjectConnectorBinding>(path(currentProjectId), {
      method: "POST",
      idempotencyKey: createCommand.current.key,
      body: payload
    });
  }

  if (loading && !settings) {
    return (
      <section className="panel connector-setup-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <span>Проверяем источник Keys.so…</span>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="panel connector-setup-state">
        <span>{error ?? "Источник Keys.so недоступен."}</span>
        <button className="secondary-button" onClick={() => void load()} type="button">
          Повторить
        </button>
      </section>
    );
  }

  return (
    <details className="panel competitor-connector" open={!ready}>
      <summary>
        <span className="connector-provider-mark">
          <ProviderLogo provider="KEYS_SO" size="compact" />
          <span className={ready ? "connector-ready-mark" : "connector-pending-mark"}>
            {ready ? "✓" : "!"}
          </span>
        </span>
        <span>
          <strong>Источник данных · Keys.so</strong>
          <small>
            {ready
              ? `${selected?.label ?? "API-ключ"} готов к сбору и импорту`
              : "Выберите проверенный ключ для этого проекта"}
          </small>
        </span>
        <span className="connector-summary-action">
          {ready ? "Изменить" : "Настроить"}
        </span>
      </summary>
      <form className="competitor-connector-body" onSubmit={save}>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {notice && <div className="inline-success" role="status">{notice}</div>}
        <label className="form-field">
          <span>Подключение Keys.so</span>
          <CustomSelect
            disabled={saving || settings.access.canUpdateBindings !== true}
            onChange={(event) => {
              setCredentialId(event.target.value);
              setError(undefined);
              setNotice(undefined);
            }}
            value={credentialId}
          >
            {!credentialId && <option value="">Выберите активный API-ключ</option>}
            {credentialId &&
              !eligible.some(({ id }) => id === credentialId) && (
                <option disabled value={credentialId}>
                  {selected
                    ? `${selected.label} — ${integrationCredentialStatusPresentation(selected.status).label}`
                    : "Подключение недоступно"}
                </option>
              )}
            {eligible.map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.label} · {integrationProviderLabel(credential.provider)}
              </option>
            ))}
          </CustomSelect>
          <small>
            Используется только для сбора запросов конкурентов; импорт всегда
            подтверждается вручную.
          </small>
        </label>
        {current && (
          <label className="connector-enabled-toggle">
            <input
              checked={enabled}
              disabled={saving || settings.access.canUpdateBindings !== true}
              onChange={(event) => setEnabled(event.target.checked)}
              type="checkbox"
            />
            Использовать в новых сборах
          </label>
        )}
        {eligible.length === 0 && (
          <p className="inline-note">
            Сначала добавьте и проверьте API-ключ Keys.so в workspace.
          </p>
        )}
        {settings.access.mutationRestriction !== "NONE" && (
          <p className="inline-note">
            Изменение ограничено текущей ролью или состоянием workspace.
          </p>
        )}
        <div className="button-row">
          <a className="secondary-button" href="/app/settings/integrations">
            Управление API-ключами
          </a>
          <button className="primary-button" disabled={!canSubmit || saving} type="submit">
            {saving ? "Сохраняем…" : "Сохранить источник"}
          </button>
        </div>
      </form>
    </details>
  );
}

function binding(
  settings: ProjectConnectorSettings
): ProjectConnectorBinding | undefined {
  return settings.bindings.find(
    ({ capability }) => capability === CAPABILITY
  );
}

function path(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`;
}

function message(error: unknown, fallback: string): string {
  if (!(error instanceof BrowserApiError)) return fallback;
  if (error.status === 402) {
    return "Workspace работает только для чтения.";
  }
  if (error.status === 403) {
    return "Недостаточно прав для изменения источника.";
  }
  return error.message;
}
