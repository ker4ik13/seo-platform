"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectorFallbackReasons,
  integrationCapabilities,
  type ConnectorFallbackReason,
  type IntegrationCapability,
  type ProjectConnectorBinding,
  type ProjectConnectorCredentialOption,
  type ProjectConnectorSettings,
  type WorkspaceConnectorBinding,
  type WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import {
  integrationCapabilityLabel,
  integrationProviderLabel
} from "../lib/integration-presentation";
import { CustomSelect } from "./custom-select";
import { IntegrationStatusBadge } from "./integration-status-badge";
import { ProviderLogo } from "./provider-logo";
import { UiText, useUiLocale } from "./ui-locale";


type ProjectRouteDraft = {
  readonly source: "WORKSPACE" | "PROJECT";
  readonly enabled: boolean;
  readonly credentialIds: readonly string[];
  readonly appendWorkspaceFallback: boolean;
  readonly fallbackReasons: readonly ConnectorFallbackReason[];
};

const FALLBACK_REASON_LABELS: Readonly<Record<ConnectorFallbackReason, string>> = {
  CREDENTIAL_UNAVAILABLE: "подключение недоступно",
  LOW_BALANCE: "не хватает баланса",
  RATE_LIMITED: "провайдер ограничил запросы",
  RETRYABLE_PROVIDER_ERROR: "временная ошибка провайдера"
};

export function ProjectIntegrationRouting({
  projectId,
  workspaceId
}: Readonly<{ projectId: string; workspaceId: string }>) {
  const [settings, setSettings] = useState<ProjectConnectorSettings>();
  const [workspace, setWorkspace] = useState<WorkspaceConnectorRoutingSettings>();
  const [drafts, setDrafts] = useState<ReadonlyMap<IntegrationCapability, ProjectRouteDraft>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<IntegrationCapability>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<IntegrationCapability>();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(undefined);
    try {
      const [projectSettings, workspaceSettings] = await Promise.all([
        browserApiRequest<ProjectConnectorSettings>(
          projectApiPath(projectId),
          signal ? { signal } : {}
        ),
        browserApiRequest<WorkspaceConnectorRoutingSettings>(
          `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing`,
          signal ? { signal } : {}
        )
      ]);
      if (signal?.aborted) return;
      setSettings(projectSettings);
      setWorkspace(workspaceSettings);
      setDrafts(new Map(integrationCapabilities.map((capability) => [
        capability,
        draftFromSettings(projectSettings, workspaceSettings, capability)
      ] as const)));
    } catch (cause) {
      if (!signal?.aborted) setError(requestErrorMessage(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId, workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const optionsByCapability = useMemo(() => new Map(
    integrationCapabilities.map((capability) => [
      capability,
      (settings?.credentialOptions ?? []).filter((credential) =>
        credential.capabilities.includes(capability)
      )
    ])
  ), [settings]);

  function updateDraft(
    capability: IntegrationCapability,
    update: (current: ProjectRouteDraft) => ProjectRouteDraft
  ): void {
    setSuccess(undefined);
    setDrafts((current) => {
      const next = new Map(current);
      next.set(capability, update(current.get(capability) ?? emptyProjectDraft()));
      return next;
    });
  }

  async function save(capability: IntegrationCapability): Promise<void> {
    if (!settings || !workspace) return;
    const draft = drafts.get(capability) ?? emptyProjectDraft();
    const binding = settings.bindings.find((candidate) => candidate.capability === capability);
    if (draft.source === "PROJECT" && draft.enabled && draft.credentialIds.length === 0) {
      setError("Для проектного маршрута выберите основное подключение.");
      return;
    }
    setSaving(capability);
    setError(undefined);
    setSuccess(undefined);
    try {
      let saved: ProjectConnectorBinding | undefined;
      if (draft.source === "WORKSPACE") {
        if (binding?.configurationScope === "PROJECT_OVERRIDE") {
          saved = await browserApiRequest<ProjectConnectorBinding>(
            `${projectApiPath(projectId)}/${encodeURIComponent(binding.id)}/inherit`,
            { method: "POST", ifMatch: binding.version }
          );
        }
      } else {
        const payload = projectPayload(draft);
        saved = binding
          ? await browserApiRequest<ProjectConnectorBinding>(
              `${projectApiPath(projectId)}/${encodeURIComponent(binding.id)}`,
              { method: "PATCH", body: payload, ifMatch: binding.version }
            )
          : await browserApiRequest<ProjectConnectorBinding>(projectApiPath(projectId), {
              method: "POST",
              body: { capability, ...payload },
              idempotencyKey: crypto.randomUUID()
            });
      }
      if (saved) {
        setSettings((current) => current ? {
          ...current,
          bindings: [
            ...current.bindings.filter((candidate) => candidate.capability !== capability),
            saved as ProjectConnectorBinding
          ]
        } : current);
      }
      setDrafts((current) => {
        const next = new Map(current);
        const nextSettings = saved && settings
          ? {
              ...settings,
              bindings: [
                ...settings.bindings.filter((candidate) => candidate.capability !== capability),
                saved
              ]
            }
          : settings;
        next.set(capability, draftFromSettings(nextSettings, workspace, capability));
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
    return <section className="panel integration-routing-panel" aria-busy="true"><span className="spinner" /><p><UiText text="Загружаем маршруты проекта…" /></p></section>;
  }
  if (!settings || !workspace) {
    return (
      <section className="panel panel-empty compact">
        <strong><UiText text="Маршрутизация проекта временно недоступна" /></strong>
        <p>{error ?? <UiText text="Не удалось загрузить настройки." />}</p>
        <button className="secondary-button" onClick={() => void load()} type="button"><UiText text="Повторить" /></button>
      </section>
    );
  }

  return (
    <section className="panel integration-routing-panel">
      <header className="security-card-header integration-routing-header">
        <div>
          <h2><UiText text="Источники операций проекта" /></h2>
          <p><UiText text="Наследуйте общий маршрут рабочей области или задайте отдельную цепочку аккаунтов для конкретного проекта." /></p>
        </div>
        <span className="security-status"><UiText text="Проектный уровень" /></span>
      </header>
      {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
      <div className="integration-routing-list">
        {integrationCapabilities.map((capability) => (
          <ProjectCapabilityRoutingRow
            binding={settings.bindings.find((candidate) => candidate.capability === capability)}
            canManageFallback={settings.access.canManageFallback}
            canUpdate={settings.access.canUpdateBindings}
            capability={capability}
            draft={drafts.get(capability) ?? emptyProjectDraft()}
            key={capability}
            onChange={(update) => updateDraft(capability, update)}
            onSave={() => void save(capability)}
            options={optionsByCapability.get(capability) ?? []}
            saving={saving === capability}
            success={success === capability}
            workspaceBinding={workspace.bindings.find((candidate) => candidate.capability === capability)}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectCapabilityRoutingRow({
  binding,
  canManageFallback,
  canUpdate,
  capability,
  draft,
  onChange,
  onSave,
  options,
  saving,
  success,
  workspaceBinding
}: Readonly<{
  binding: ProjectConnectorBinding | undefined;
  canManageFallback: boolean;
  canUpdate: boolean;
  capability: IntegrationCapability;
  draft: ProjectRouteDraft;
  onChange: (update: (current: ProjectRouteDraft) => ProjectRouteDraft) => void;
  onSave: () => void;
  options: readonly ProjectConnectorCredentialOption[];
  saving: boolean;
  success: boolean;
  workspaceBinding: WorkspaceConnectorBinding | undefined;
}>) {
  const { t: uiText } = useUiLocale();
  const selected = draft.credentialIds
    .map((id) => options.find((option) => option.id === id))
    .filter((option): option is ProjectConnectorCredentialOption => Boolean(option));
  const available = options.filter((option) => !draft.credentialIds.includes(option.id));

  return (
    <article className="integration-routing-row">
      <div className="integration-routing-title">
        <div><strong>{<UiText text={integrationCapabilityLabel(capability) ?? ""} />}</strong><span><UiText text={capabilityDescription(capability)} /></span></div>
        <IntegrationStatusBadge status={binding?.availability === "READY" ? "ACTIVE" : "PENDING_VERIFICATION"} />
      </div>
      <div className="integration-routing-source-tabs" role="radiogroup" aria-label={uiText("Источник {0}", [String(integrationCapabilityLabel(capability))])}>
        <label>
          <input checked={draft.source === "WORKSPACE"} disabled={!canUpdate || saving || !workspaceBinding} name={`${capability}-source`} onChange={() => onChange((current) => ({ ...current, source: "WORKSPACE" }))} type="radio" />
          <span><UiText text="Наследовать рабочую область" /></span>
        </label>
        <label>
          <input checked={draft.source === "PROJECT"} disabled={!canUpdate || saving} name={`${capability}-source`} onChange={() => onChange((current) => ({ ...current, source: "PROJECT", credentialIds: current.source === "PROJECT" ? current.credentialIds : [] }))} type="radio" />
          <span><UiText text="Отдельный маршрут проекта" /></span>
        </label>
      </div>
      {draft.source === "WORKSPACE" ? (
        <WorkspaceRoutePreview binding={workspaceBinding} options={options} />
      ) : (
        <>
          <label className="integration-routing-switch">
            <input checked={draft.enabled} disabled={!canUpdate || saving} onChange={(event) => onChange((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" />
            <span>{draft.enabled ? <UiText text="Операция включена" /> : <UiText text="Операция выключена" />}</span>
          </label>
          <RouteChain onChange={onChange} saving={saving} selected={selected} />
          {canUpdate && available.length > 0 && (
            <label className="form-field integration-route-add">
              <span>{selected.length === 0 ? <UiText text="Основное подключение" /> : <UiText text="Добавить резерв проекта" />}</span>
              <CustomSelect disabled={saving || (selected.length > 0 && !canManageFallback)} onChange={(event) => onChange((current) => ({ ...current, credentialIds: [...current.credentialIds, event.target.value], fallbackReasons: current.fallbackReasons.length > 0 ? current.fallbackReasons : [...connectorFallbackReasons] }))} searchable value="">
                <option value=""><UiText text="Выберите подключение" /></option>
                {available.map((credential) => <option disabled={credential.status !== "ACTIVE"} key={credential.id} value={credential.id}>{<UiText text={integrationProviderLabel(credential.provider) ?? ""} />} · {credential.label}</option>)}
              </CustomSelect>
            </label>
          )}
          {workspaceBinding && canManageFallback && (
            <label className="integration-workspace-fallback">
              <input checked={draft.appendWorkspaceFallback} disabled={saving} onChange={(event) => onChange((current) => ({ ...current, appendWorkspaceFallback: event.target.checked, fallbackReasons: current.fallbackReasons.length > 0 ? current.fallbackReasons : [...connectorFallbackReasons] }))} type="checkbox" />
              <span><UiText text="После резервов проекта использовать цепочку рабочей области" /></span>
            </label>
          )}
          {(draft.credentialIds.length > 1 || draft.appendWorkspaceFallback) && (
            <fieldset className="integration-fallback-reasons" disabled={!canManageFallback || saving}>
              <legend><UiText text="Переключать на следующий источник, если" /></legend>
              {connectorFallbackReasons.map((reason) => <label key={reason}><input checked={draft.fallbackReasons.includes(reason)} onChange={(event) => onChange((current) => ({ ...current, fallbackReasons: event.target.checked ? [...current.fallbackReasons, reason] : current.fallbackReasons.filter((value) => value !== reason) }))} type="checkbox" /><span>{FALLBACK_REASON_LABELS[reason]}</span></label>)}
            </fieldset>
          )}
        </>
      )}
      <div className="integration-routing-actions">
        <span className={success ? "integration-save-success" : ""}>{success ? <UiText text="Сохранено" /> : draft.source === "WORKSPACE" ? <UiText text="Обновления маршрута применяются ко всем наследующим проектам" /> : <UiText text="{0} проектных источников" values={[String(selected.length)]} />}</span>
        {canUpdate && <button className="secondary-button" disabled={saving || (draft.source === "PROJECT" && draft.enabled && selected.length === 0)} onClick={onSave} type="button">{saving ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}</button>}
      </div>
    </article>
  );
}

function RouteChain({ onChange, saving, selected }: Readonly<{ onChange: (update: (current: ProjectRouteDraft) => ProjectRouteDraft) => void; saving: boolean; selected: readonly ProjectConnectorCredentialOption[] }>) {
  const { t: uiText } = useUiLocale();
  return <div className="integration-route-chain">{selected.map((credential, index) => <div className="integration-route-item" key={credential.id}><span className="integration-route-position">{index + 1}</span><ProviderLogo provider={credential.provider} size="compact" /><div className="integration-route-copy"><strong>{credential.label}</strong><span>{<UiText text={integrationProviderLabel(credential.provider) ?? ""} />} · {index === 0 ? <UiText text="основной" /> : <UiText text="резерв" />}</span></div><IntegrationStatusBadge status={credential.status} /><button aria-label={uiText("Убрать {0}", [String(credential.label)])} className="icon-button" disabled={saving} onClick={() => onChange((current) => ({ ...current, credentialIds: current.credentialIds.filter((id) => id !== credential.id) }))} type="button">×</button></div>)}{selected.length === 0 && <div className="integration-route-empty"><UiText text="Проектные подключения ещё не выбраны." /></div>}</div>;
}

function WorkspaceRoutePreview({ binding, options }: Readonly<{ binding: WorkspaceConnectorBinding | undefined; options: readonly ProjectConnectorCredentialOption[] }>) {
  if (!binding) return <div className="integration-route-empty"><UiText text="Для этой операции маршрут рабочей области ещё не настроен." /></div>;
  return <div className="integration-route-chain">{binding.routes.map((route, index) => { const credential = options.find(({ id }) => id === route.credentialId); return <div className="integration-route-item" key={route.id}><span className="integration-route-position">{index + 1}</span><ProviderLogo provider={route.provider} size="compact" /><div className="integration-route-copy"><strong>{credential?.label ?? integrationProviderLabel(route.provider)}</strong><span>{index === 0 ? <UiText text="основной workspace" /> : <UiText text="резерв workspace" />}</span></div>{credential && <IntegrationStatusBadge status={credential.status} />}</div>; })}</div>;
}

function projectPayload(draft: ProjectRouteDraft) {
  const [credentialId, ...fallbackIds] = draft.credentialIds;
  if (!credentialId) throw new Error("Project connector primary route is missing");
  const fallbackMode = draft.appendWorkspaceFallback ? "NEXT_AVAILABLE_THEN_WORKSPACE" : fallbackIds.length > 0 ? "NEXT_AVAILABLE" : "NONE";
  return {
    enabled: draft.enabled,
    route: { position: 0, sourceKind: "WORKSPACE_CREDENTIAL" as const, credentialId },
    fallbackRoutes: fallbackIds.map((id, index) => ({ position: index + 1, sourceKind: "WORKSPACE_CREDENTIAL" as const, credentialId: id })),
    fallbackPolicy: { mode: fallbackMode, reasons: fallbackMode === "NONE" ? [] : draft.fallbackReasons },
    budgetPolicy: { mode: "DISABLED" as const }
  };
}

function draftFromSettings(project: ProjectConnectorSettings | undefined, workspace: WorkspaceConnectorRoutingSettings, capability: IntegrationCapability): ProjectRouteDraft {
  const binding = project?.bindings.find((candidate) => candidate.capability === capability);
  if (!binding || binding.configurationScope !== "PROJECT_OVERRIDE") {
    return { source: "WORKSPACE", enabled: binding?.enabled ?? true, credentialIds: [], appendWorkspaceFallback: false, fallbackReasons: [] };
  }
  const projectRoutes = (binding.routes ?? (binding.route ? [binding.route] : [])).filter((route) => route.routingScope === "PROJECT_OVERRIDE" || route.routingScope === undefined);
  return { source: "PROJECT", enabled: binding.enabled, credentialIds: projectRoutes.map((route) => route.credentialId), appendWorkspaceFallback: binding.fallbackPolicy.mode === "NEXT_AVAILABLE_THEN_WORKSPACE" && Boolean(workspace.bindings.find((candidate) => candidate.capability === capability)), fallbackReasons: binding.fallbackPolicy.reasons ?? [] };
}

function emptyProjectDraft(): ProjectRouteDraft { return { source: "PROJECT", enabled: true, credentialIds: [], appendWorkspaceFallback: false, fallbackReasons: [] }; }
function projectApiPath(projectId: string): string { return `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`; }
function requestErrorMessage(cause: unknown): string { return cause instanceof BrowserApiError ? `${cause.message}${cause.requestId ? ` Код запроса: ${cause.requestId}.` : ""}` : "Не удалось сохранить маршрут проекта."; }
function capabilityDescription(capability: IntegrationCapability): string { return ({ SERP_RANK_TRACKING: "Съём позиций и релевантных URL", SERP_COLLECTION: "Получение поисковой выдачи", WORDSTAT: "Базовая, фразовая и точная частотность", CLUSTERING: "Кластеризация запросов", INDEXATION: "Проверка индексации", KEYWORD_RESEARCH: "Сбор и расширение семантики", COMPETITOR_RESEARCH: "Сбор конкурентов и их запросов" } as const)[capability]; }
