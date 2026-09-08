"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectorFallbackReasons,
  integrationCapabilities,
  type ConnectorFallbackReason,
  type IntegrationCapability,
  type ProjectConnectorCredentialOption,
  type WorkspaceConnectorBinding,
  type WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  integrationCapabilityLabel,
  integrationProviderLabel
} from "../lib/integration-presentation";
import { CustomSelect } from "./custom-select";
import { IntegrationStatusBadge } from "./integration-status-badge";
import { ProviderLogo } from "./provider-logo";
import { UiText, useUiLocale } from "./ui-locale";


type RouteDraft = {
  readonly enabled: boolean;
  readonly credentialIds: readonly string[];
  readonly fallbackReasons: readonly ConnectorFallbackReason[];
};

const FALLBACK_REASON_LABELS: Readonly<Record<ConnectorFallbackReason, string>> = {
  CREDENTIAL_UNAVAILABLE: "подключение недоступно",
  LOW_BALANCE: "недостаточно баланса",
  RATE_LIMITED: "лимит запросов",
  RETRYABLE_PROVIDER_ERROR: "временная ошибка провайдера"
};

export function WorkspaceIntegrationRouting({
  workspaceId
}: Readonly<{ workspaceId: string }>) {
  const [settings, setSettings] = useState<WorkspaceConnectorRoutingSettings>();
  const [drafts, setDrafts] = useState<ReadonlyMap<IntegrationCapability, RouteDraft>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<IntegrationCapability>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<IntegrationCapability>();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(undefined);
    try {
      const value = await browserApiRequest<WorkspaceConnectorRoutingSettings>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing`,
        signal ? { signal } : {}
      );
      if (signal?.aborted) return;
      setSettings(value);
      setDrafts(
        new Map(
          integrationCapabilities.map((capability) => {
            const binding = value.bindings.find(
              (candidate) => candidate.capability === capability
            );
            return [capability, draftFromBinding(binding)] as const;
          })
        )
      );
    } catch (cause) {
      if (!signal?.aborted) setError(requestErrorMessage(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const optionsByCapability = useMemo(
    () =>
      new Map(
        integrationCapabilities.map((capability) => [
          capability,
          (settings?.credentialOptions ?? []).filter((credential) =>
            credential.capabilities.includes(capability)
          )
        ])
      ),
    [settings]
  );

  function updateDraft(
    capability: IntegrationCapability,
    update: (current: RouteDraft) => RouteDraft
  ): void {
    setSuccess(undefined);
    setDrafts((current) => {
      const next = new Map(current);
      next.set(capability, update(current.get(capability) ?? emptyDraft()));
      return next;
    });
  }

  async function save(capability: IntegrationCapability): Promise<void> {
    const draft = drafts.get(capability) ?? emptyDraft();
    if (draft.enabled && draft.credentialIds.length === 0) {
      setError("Для включённой операции выберите хотя бы одно подключение.");
      return;
    }
    const current = settings?.bindings.find(
      (binding) => binding.capability === capability
    );
    setSaving(capability);
    setError(undefined);
    setSuccess(undefined);
    try {
      const saved = await browserApiRequest<WorkspaceConnectorBinding>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing/${encodeURIComponent(capability)}`,
        {
          method: "PUT",
          body: {
            enabled: draft.enabled,
            routes: draft.credentialIds.map((credentialId, position) => ({
              position,
              sourceKind: "WORKSPACE_CREDENTIAL",
              credentialId
            })),
            fallbackPolicy: {
              mode: draft.credentialIds.length > 1 ? "NEXT_AVAILABLE" : "NONE",
              reasons: draft.credentialIds.length > 1 ? draft.fallbackReasons : []
            },
            ...(current ? { version: current.version } : {})
          }
        }
      );
      setSettings((value) =>
        value
          ? {
              ...value,
              bindings: [
                ...value.bindings.filter(
                  (binding) => binding.capability !== capability
                ),
                saved
              ]
            }
          : value
      );
      setDrafts((value) => {
        const next = new Map(value);
        next.set(capability, draftFromBinding(saved));
        return next;
      });
      setSuccess(capability);
    } catch (cause) {
      setError(requestErrorMessage(cause));
    } finally {
      setSaving(undefined);
    }
  }

  if (loading) {
    return (
      <section className="panel integration-routing-panel" aria-busy="true">
        <span className="spinner" />
        <p><UiText text="Загружаем маршруты операций…" /></p>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="panel panel-empty compact">
        <strong><UiText text="Маршрутизация временно недоступна" /></strong>
        <p>{error ?? <UiText text="Не удалось загрузить настройки." />}</p>
        <button className="secondary-button" onClick={() => void load()} type="button">
          <UiText text="Повторить" /></button>
      </section>
    );
  }

  return (
    <section className="panel integration-routing-panel">
      <header className="security-card-header integration-routing-header">
        <div>
          <h2><UiText text="Маршрутизация операций" /></h2>
          <p>
            <UiText text="Первый источник — основной. Следующие используются по порядку при недоступности, нехватке баланса, ограничении запросов или временной ошибке." /></p>
        </div>
        <span className="security-status"><UiText text="Настройка рабочей области" /></span>
      </header>
      {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
      <div className="integration-routing-list">
        {integrationCapabilities.map((capability) => (
          <CapabilityRoutingRow
            capability={capability}
            canManageFallback={settings.access.canManageFallback}
            canUpdate={settings.access.canUpdateBindings}
            draft={drafts.get(capability) ?? emptyDraft()}
            key={capability}
            onChange={(update) => updateDraft(capability, update)}
            onSave={() => void save(capability)}
            options={optionsByCapability.get(capability) ?? []}
            saving={saving === capability}
            success={success === capability}
          />
        ))}
      </div>
      {settings.credentialOptionsTruncated && (
        <div className="inline-alert warning">
          <UiText text="Показаны первые 500 подключений. Уточните список или отключите неиспользуемые." /></div>
      )}
    </section>
  );
}

function CapabilityRoutingRow({
  capability,
  canManageFallback,
  canUpdate,
  draft,
  onChange,
  onSave,
  options,
  saving,
  success
}: Readonly<{
  capability: IntegrationCapability;
  canManageFallback: boolean;
  canUpdate: boolean;
  draft: RouteDraft;
  onChange: (update: (current: RouteDraft) => RouteDraft) => void;
  onSave: () => void;
  options: readonly ProjectConnectorCredentialOption[];
  saving: boolean;
  success: boolean;
}>) {
  const { t: uiText } = useUiLocale();
  const selected = draft.credentialIds
    .map((id) => options.find((option) => option.id === id))
    .filter((option): option is ProjectConnectorCredentialOption => Boolean(option));
  const available = options.filter(
    (option) => !draft.credentialIds.includes(option.id)
  );

  return (
    <article className="integration-routing-row">
      <div className="integration-routing-title">
        <div>
          <strong>{<UiText text={integrationCapabilityLabel(capability) ?? ""} />}</strong>
          <span><UiText text={capabilityDescription(capability)} /></span>
        </div>
        <label className="integration-routing-switch">
          <input
            checked={draft.enabled}
            disabled={!canUpdate || saving}
            onChange={(event) =>
              onChange((current) => ({ ...current, enabled: event.target.checked }))
            }
            type="checkbox"
          />
          <span>{draft.enabled ? <UiText text="Включено" /> : <UiText text="Выключено" />}</span>
        </label>
      </div>
      <div className="integration-route-chain">
        {selected.map((credential, index) => (
          <div className="integration-route-item" key={credential.id}>
            <span className="integration-route-position">{index + 1}</span>
            <ProviderLogo provider={credential.provider} size="compact" />
            <div className="integration-route-copy">
              <strong>{credential.label}</strong>
              <span>
                {<UiText text={integrationProviderLabel(credential.provider) ?? ""} />} · {index === 0 ? <UiText text="основной" /> : <UiText text="резерв" />}
              </span>
            </div>
            <IntegrationStatusBadge status={credential.status} />
            {canUpdate && (
              <button
                aria-label={uiText("Убрать подключение {0}", [String(credential.label)])}
                className="icon-button"
                disabled={saving}
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    credentialIds: current.credentialIds.filter(
                      (id) => id !== credential.id
                    )
                  }))
                }
                type="button"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {selected.length === 0 && (
          <div className="integration-route-empty">
            <UiText text="Подключение для этой операции не назначено." /></div>
        )}
      </div>
      {canUpdate && available.length > 0 && (
        <label className="form-field integration-route-add">
          <span>{selected.length === 0 ? <UiText text="Основное подключение" /> : <UiText text="Добавить резерв" />}</span>
          <CustomSelect
            disabled={saving || (selected.length > 0 && !canManageFallback)}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                credentialIds: [...current.credentialIds, event.target.value],
                fallbackReasons:
                  current.fallbackReasons.length > 0
                    ? current.fallbackReasons
                    : [...connectorFallbackReasons]
              }))
            }
            searchable
            value=""
          >
            <option value=""><UiText text="Выберите подключение" /></option>
            {available.map((credential) => (
              <option
                disabled={credential.status !== "ACTIVE"}
                key={credential.id}
                value={credential.id}
              >
                {<UiText text={integrationProviderLabel(credential.provider) ?? ""} />} · {credential.label}
                {credential.status === "ACTIVE" ? "" : <UiText text="· недоступно" before=" " />}
              </option>
            ))}
          </CustomSelect>
        </label>
      )}
      {draft.credentialIds.length > 1 && (
        <fieldset className="integration-fallback-reasons" disabled={!canManageFallback || saving}>
          <legend><UiText text="Переключать на следующий источник, если" /></legend>
          {connectorFallbackReasons.map((reason) => (
            <label key={reason}>
              <input
                checked={draft.fallbackReasons.includes(reason)}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    fallbackReasons: event.target.checked
                      ? [...current.fallbackReasons, reason]
                      : current.fallbackReasons.filter((value) => value !== reason)
                  }))
                }
                type="checkbox"
              />
              <span>{FALLBACK_REASON_LABELS[reason]}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="integration-routing-actions">
        <span className={success ? "integration-save-success" : ""}>
          {success ? <UiText text="Сохранено" /> : <UiText text="{0} источников в цепочке" values={[String(selected.length)]} />}
        </span>
        {canUpdate && (
          <button
            className="secondary-button"
            disabled={saving || (draft.enabled && selected.length === 0)}
            onClick={onSave}
            type="button"
          >
            {saving ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить маршрут" />}
          </button>
        )}
      </div>
    </article>
  );
}

function draftFromBinding(binding: WorkspaceConnectorBinding | undefined): RouteDraft {
  return binding
    ? {
        enabled: binding.enabled,
        credentialIds: binding.routes.map((route) => route.credentialId),
        fallbackReasons: binding.fallbackPolicy.reasons ?? []
      }
    : emptyDraft();
}

function emptyDraft(): RouteDraft {
  return { enabled: true, credentialIds: [], fallbackReasons: [] };
}

function capabilityDescription(capability: IntegrationCapability): string {
  const descriptions: Readonly<Record<IntegrationCapability, string>> = {
    SERP_RANK_TRACKING: "Позиции и релевантные URL в поисковых системах",
    SERP_COLLECTION: "Сырые результаты поисковой выдачи",
    WORDSTAT: "Базовая, фразовая и точная частотность",
    CLUSTERING: "Группировка запросов по пересечению выдачи",
    INDEXATION: "Проверка наличия страниц в индексе",
    KEYWORD_RESEARCH: "Расширение семантики и подсказки",
    COMPETITOR_RESEARCH: "Домены конкурентов и их запросы"
  };
  return descriptions[capability];
}

function requestErrorMessage(cause: unknown): string {
  if (cause instanceof BrowserApiError) {
    return `${cause.message}${cause.requestId ? ` Код запроса: ${cause.requestId}.` : ""}`;
  }
  return "Не удалось сохранить маршрутизацию. Повторите попытку.";
}
