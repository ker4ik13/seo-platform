"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectorFallbackReasons,
  credentialModeSupportsCapability,
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
  integrationCredentialModeLabel,
  integrationProviderLabel
} from "../lib/integration-presentation";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { IntegrationStatusBadge } from "./integration-status-badge";
import { ProviderLogo } from "./provider-logo";
import { UiText, useUiLocale } from "./ui-locale";
import {
  isWorkspaceConnectorCredentialConfigurable,
  workspaceRouteCredentialIdsAfterSelection,
  workspaceRouteMatchesBinding,
  workspaceRouteUpdateInput
} from "../lib/project-integration-settings";


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
const ROUTE_CONFIRMATION_ERROR =
  "Сервер не подтвердил новый порядок маршрута. Повторите сохранение.";

export function WorkspaceIntegrationRouting({
  revision = 0,
  workspaceId
}: Readonly<{ revision?: number; workspaceId: string }>) {
  const [settings, setSettings] = useState<WorkspaceConnectorRoutingSettings>();
  const [drafts, setDrafts] = useState<ReadonlyMap<IntegrationCapability, RouteDraft>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ReadonlySet<IntegrationCapability>>(
    new Set()
  );
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<IntegrationCapability>();
  const [failed, setFailed] = useState<IntegrationCapability>();
  const draftsRef = useRef<ReadonlyMap<IntegrationCapability, RouteDraft>>(new Map());
  const pendingSaves = useRef(new Map<IntegrationCapability, RouteDraft>());
  const activeSaves = useRef(new Set<IntegrationCapability>());
  const mutationEpoch = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const startedAtEpoch = mutationEpoch.current;
    setLoading(true);
    setError(undefined);
    try {
      const value = await browserApiRequest<WorkspaceConnectorRoutingSettings>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing`,
        signal ? { signal } : {}
      );
      if (signal?.aborted || startedAtEpoch !== mutationEpoch.current || activeSaves.current.size > 0) return;
      setSettings(value);
      setSuccess(undefined);
      setFailed(undefined);
      const nextDrafts = new Map(
          integrationCapabilities.map((capability) => {
            const binding = value.bindings.find(
              (candidate) => candidate.capability === capability
            );
            return [capability, draftFromBinding(binding)] as const;
          })
        );
      draftsRef.current = nextDrafts;
      setDrafts(nextDrafts);
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
  }, [load, revision]);

  const optionsByCapability = useMemo(
    () =>
      new Map(
        integrationCapabilities.map((capability) => [
          capability,
          (settings?.credentialOptions ?? []).filter((credential) => {
            const configured = settings?.bindings
              .find((binding) => binding.capability === capability)
              ?.routes.some((route) => route.credentialId === credential.id);
            return configured || (
              credential.capabilities.includes(capability) &&
              credentialModeSupportsCapability(
                credential.mode,
                capability,
                credential.provider
              )
            );
          })
        ])
      ),
    [settings]
  );

  function updateDraft(
    capability: IntegrationCapability,
    update: (current: RouteDraft) => RouteDraft
  ): void {
    setSuccess(undefined);
    setFailed(undefined);
    mutationEpoch.current += 1;
    const nextDraft = update(draftsRef.current.get(capability) ?? emptyDraft());
    const nextDrafts = new Map(draftsRef.current).set(capability, nextDraft);
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    if (nextDraft.credentialIds.length > 0) {
      void save(capability, nextDraft);
    }
  }

  async function save(
    capability: IntegrationCapability,
    draft = draftsRef.current.get(capability) ?? emptyDraft()
  ): Promise<void> {
    pendingSaves.current.set(capability, draft);
    if (activeSaves.current.has(capability)) return;
    activeSaves.current.add(capability);
    mutationEpoch.current += 1;
    setSaving((current) => new Set(current).add(capability));
    try {
      while (pendingSaves.current.has(capability)) {
        const nextDraft = pendingSaves.current.get(capability)!;
        pendingSaves.current.delete(capability);
        if (nextDraft.enabled && nextDraft.credentialIds.length === 0) {
          setError("Для включённой операции выберите хотя бы одно подключение.");
          setFailed(capability);
          continue;
        }
        setError(undefined);
        setSuccess(undefined);
        setFailed(undefined);
        try {
          let confirmed: WorkspaceConnectorRoutingSettings | undefined;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const saved = await browserApiRequest<WorkspaceConnectorBinding>(
              `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing/${encodeURIComponent(capability)}`,
              {
                method: "PUT",
                body: workspaceRouteUpdateInput(nextDraft)
              }
            );
            if (!workspaceRouteMatchesBinding(saved, nextDraft)) continue;
            const latest = await browserApiRequest<WorkspaceConnectorRoutingSettings>(
              `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing`
            );
            if (workspaceRouteMatchesBinding(
              latest.bindings.find((binding) => binding.capability === capability),
              nextDraft
            )) {
              confirmed = latest;
              break;
            }
          }
          if (!confirmed) {
            throw new Error(ROUTE_CONFIRMATION_ERROR);
          }
          mutationEpoch.current += 1;
          setSettings(confirmed);
          if (pendingSaves.current.has(capability)) continue;
          const nextDrafts = new Map(draftsRef.current).set(capability, nextDraft);
          draftsRef.current = nextDrafts;
          setDrafts(nextDrafts);
          setSuccess(capability);
        } catch (cause) {
          setError(requestErrorMessage(cause));
          setFailed(capability);
        }
      }
    } finally {
      activeSaves.current.delete(capability);
      setSaving((current) => {
        const next = new Set(current);
        next.delete(capability);
        return next;
      });
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
            {...(settings.bindings.find(
              (binding) => binding.capability === capability
            ) ? {
                binding: settings.bindings.find(
                  (binding) => binding.capability === capability
                )!
              } : {})}
            capability={capability}
            canManageFallback={settings.access.canManageFallback}
            canUpdate={settings.access.canUpdateBindings}
            draft={drafts.get(capability) ?? emptyDraft()}
            key={capability}
            onChange={(update) => updateDraft(capability, update)}
            onSave={() => void save(capability)}
            options={optionsByCapability.get(capability) ?? []}
            failed={failed === capability}
            saving={saving.has(capability)}
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
  binding,
  capability,
  canManageFallback,
  canUpdate,
  draft,
  failed,
  onChange,
  onSave,
  options,
  saving,
  success
}: Readonly<{
  binding?: WorkspaceConnectorBinding;
  capability: IntegrationCapability;
  canManageFallback: boolean;
  canUpdate: boolean;
  draft: RouteDraft;
  failed: boolean;
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
  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= draft.credentialIds.length) return;
    onChange((current) => {
      const credentialIds = [...current.credentialIds];
      [credentialIds[index], credentialIds[target]] = [
        credentialIds[target]!,
        credentialIds[index]!
      ];
      return { ...current, credentialIds };
    });
  };

  return (
    <article
      className="integration-routing-row"
      id={`routing-${capability.toLocaleLowerCase("en").replaceAll("_", "-")}`}
    >
      <div className="integration-routing-title">
        <div>
          <strong>{<UiText text={integrationCapabilityLabel(capability) ?? ""} />}</strong>
          <span><UiText text={capabilityDescription(capability)} /></span>
        </div>
        <label className="integration-routing-switch">
          <input
            checked={draft.enabled}
            disabled={!canUpdate || saving || selected.length === 0}
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
                {routeIsUnavailable(binding, credential.id)
                  ? <UiText text="· маршрут недоступен" before=" " />
                  : null}
              </span>
            </div>
            <IntegrationStatusBadge status={routeIsUnavailable(binding, credential.id) ? "DEGRADED" : credential.status} />
            {canUpdate && (
              <div className="integration-route-controls">
                <button aria-label={uiText("Поднять подключение {0}", [String(credential.label)])} disabled={saving || index === 0} onClick={() => move(index, -1)} type="button"><Icon name="arrowUp" /></button>
                <button aria-label={uiText("Опустить подключение {0}", [String(credential.label)])} disabled={saving || index === selected.length - 1} onClick={() => move(index, 1)} type="button"><Icon name="arrowDown" /></button>
                <button
                  aria-label={uiText("Убрать подключение {0}", [String(credential.label)])}
                  className="integration-route-remove"
                  disabled={saving || selected.length === 1}
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      credentialIds: current.credentialIds.filter(
                        (id) => id !== credential.id
                      )
                    }))
                  }
                  type="button"
                  title={selected.length === 1 ? uiText("Сначала добавьте новое подключение") : undefined}
                >
                  ×
                </button>
              </div>
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
          <span>{selected.length === 0
            ? <UiText text="Основное подключение" />
            : <UiText text="Добавить резерв" />}</span>
          <CustomSelect
            disabled={saving || (selected.length > 0 && !canManageFallback)}
            onChange={(event) => onChange((current) => {
              const credentialIds = workspaceRouteCredentialIdsAfterSelection(
                current.credentialIds,
                event.target.value
              );
              return {
                ...current,
                enabled: true,
                credentialIds,
                fallbackReasons:
                  credentialIds.length > 1 && current.fallbackReasons.length === 0
                    ? [...connectorFallbackReasons]
                    : current.fallbackReasons
              };
            })}
            popoverClassName="integration-credential-select-popover"
            popoverMinWidth={440}
            searchable
            value=""
          >
            <option disabled value=""><UiText text="Выберите подключение" /></option>
            {available.map((credential) => (
              <option
                disabled={!isWorkspaceConnectorCredentialConfigurable(
                  credential,
                  capability
                )}
                key={credential.id}
                value={credential.id}
              >
                <span className="integration-credential-select-option">
                  <ProviderLogo provider={credential.provider} size="compact" />
                  <span className="integration-credential-select-copy">
                    <strong>{<UiText text={integrationProviderLabel(credential.provider) ?? ""} />}</strong>
                    <small>{<UiText text={integrationCredentialModeLabel(credential.mode) ?? ""} />}</small>
                  </span>
                  <span className="integration-credential-select-badges">
                    <span className="integration-credential-label-chip">{credential.label}</span>
                    {credential.status === "ACTIVE"
                      ? null
                      : <span className="integration-credential-unavailable-chip"><UiText text="Недоступно" /></span>}
                  </span>
                </span>
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
        <span aria-live="polite" className={success ? "integration-save-success" : ""}>
          {saving
            ? <UiText text="Сохраняем маршрут…" />
            : success
              ? <UiText text="Сохранено автоматически" />
              : <UiText text="{0} источников в цепочке" values={[String(selected.length)]} />}
        </span>
        {canUpdate && failed && (
          <button
            className="secondary-button"
            disabled={saving || (draft.enabled && selected.length === 0)}
            onClick={onSave}
            type="button"
          >
            <UiText text="Повторить сохранение" />
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
  return { enabled: false, credentialIds: [], fallbackReasons: [] };
}

function routeIsUnavailable(
  binding: WorkspaceConnectorBinding | undefined,
  credentialId: string
): boolean {
  const route = binding?.routes.find(
    (candidate) => candidate.credentialId === credentialId
  );
  return route !== undefined && route.availability !== "READY";
}

function capabilityDescription(capability: IntegrationCapability): string {
  const descriptions: Readonly<Record<IntegrationCapability, string>> = {
    SERP_RANK_TRACKING: "Позиции и релевантные URL в поисковых системах",
    SERP_COLLECTION: "Сырые результаты поисковой выдачи",
    WORDSTAT: "Базовая, фразовая и точная частотность",
    CLUSTERING: "Группировка запросов по пересечению выдачи",
    INDEXATION: "Проверка наличия страниц в индексе",
    KEYWORD_RESEARCH: "Расширение семантики через Wordstat",
    COMPETITOR_RESEARCH: "Домены конкурентов и их запросы"
  };
  return descriptions[capability];
}

function requestErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message === ROUTE_CONFIRMATION_ERROR) {
    return ROUTE_CONFIRMATION_ERROR;
  }
  if (cause instanceof BrowserApiError) {
    return `${cause.message}${cause.requestId ? ` Код запроса: ${cause.requestId}.` : ""}`;
  }
  return "Не удалось сохранить маршрутизацию. Повторите попытку.";
}
