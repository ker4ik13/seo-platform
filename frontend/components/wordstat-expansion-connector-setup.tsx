"use client";

import type {
  CreateProjectConnectorBindingInput,
  ProjectConnectorBinding,
  ProjectConnectorCredentialOption,
  ProjectConnectorSettings,
  UpdateProjectConnectorBindingInput
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  integrationCredentialStatusPresentation,
  integrationProviderLabel
} from "../lib/integration-presentation";
import { CustomSelect } from "./custom-select";
import { ProviderLogo } from "./provider-logo";

const CAPABILITY = "KEYWORD_RESEARCH";
const FALLBACK_REASONS = [
  "CREDENTIAL_UNAVAILABLE",
  "LOW_BALANCE",
  "RATE_LIMITED",
  "RETRYABLE_PROVIDER_ERROR"
] as const;

export function WordstatExpansionConnectorSetup({
  projectId
}: Readonly<{ projectId: string }>) {
  const [settings, setSettings] = useState<ProjectConnectorSettings>();
  const [xmlStockId, setXmlStockId] = useState("");
  const [arsenkinId, setArsenkinId] = useState("");
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
      const current = binding(result);
      const routes = bindingRoutes(current);
      setSettings(result);
      setXmlStockId(
        routes.find(({ provider }) => provider === "XMLSTOCK")?.credentialId ?? ""
      );
      setArsenkinId(
        routes.find(({ provider }) => provider === "ARSENKIN")?.credentialId ?? ""
      );
      setEnabled(current?.enabled ?? true);
      setError(undefined);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(message(caught, "Не удалось загрузить подключения Wordstat."));
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
          credential.mode === "BYOK_API_KEY" &&
          credential.capabilities.includes(CAPABILITY) &&
          (credential.provider === "XMLSTOCK" || credential.provider === "ARSENKIN")
      ) ?? [],
    [settings]
  );
  const xmlStockOptions = options.filter(({ provider }) => provider === "XMLSTOCK");
  const arsenkinOptions = options.filter(({ provider }) => provider === "ARSENKIN");
  const routeIds = [xmlStockId, arsenkinId].filter(Boolean);
  const currentIds = bindingRoutes(current)
    .filter(({ provider }) => provider === "XMLSTOCK" || provider === "ARSENKIN")
    .sort(providerRouteOrder)
    .map(({ credentialId }) => credentialId);
  const dirty = Boolean(
    settings &&
      (current?.enabled !== enabled || currentIds.join("\n") !== routeIds.join("\n"))
  );
  const selectedOptions = routeIds.map((id) =>
    options.find((option) => option.id === id)
  );
  const allSelectedActive = selectedOptions.every(
    (option): option is ProjectConnectorCredentialOption => option?.status === "ACTIVE"
  );
  const canSubmit = Boolean(
    settings?.access.canUpdateBindings &&
      settings.access.mutationRestriction === "NONE" &&
      dirty &&
      routeIds.length > 0 &&
      allSelectedActive &&
      (routeIds.length === 1 || settings.access.canManageFallback)
  );
  const ready = Boolean(
    current?.enabled &&
      current.availability === "READY" &&
      currentIds.length > 0
  );

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!settings || !canSubmit || saving) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    const routes = routeIds.map((credentialId, position) => ({
      position,
      sourceKind: "WORKSPACE_CREDENTIAL" as const,
      credentialId
    }));
    const [route, ...fallbackRoutes] = routes;
    if (!route) {
      setSaving(false);
      return;
    }
    const shared = {
      enabled,
      route,
      fallbackRoutes,
      fallbackPolicy: fallbackRoutes.length > 0
        ? { mode: "NEXT_AVAILABLE" as const, reasons: FALLBACK_REASONS }
        : { mode: "NONE" as const, reasons: [] },
      budgetPolicy: { mode: "DISABLED" as const }
    } satisfies UpdateProjectConnectorBindingInput;
    try {
      const updated = current
        ? await browserApiRequest<ProjectConnectorBinding>(
            `${path(projectId)}/${encodeURIComponent(current.id)}`,
            { method: "PATCH", ifMatch: current.version, body: shared }
          )
        : await createBinding(projectId, {
            capability: CAPABILITY,
            ...shared
          });
      setSettings({
        ...settings,
        bindings: [
          ...settings.bindings.filter(
            (candidate) =>
              candidate.id !== updated.id && candidate.capability !== CAPABILITY
          ),
          updated
        ]
      });
      const updatedRoutes = bindingRoutes(updated);
      setXmlStockId(
        updatedRoutes.find(({ provider }) => provider === "XMLSTOCK")?.credentialId ?? ""
      );
      setArsenkinId(
        updatedRoutes.find(({ provider }) => provider === "ARSENKIN")?.credentialId ?? ""
      );
      setEnabled(updated.enabled);
      createCommand.current = undefined;
      setNotice("Подключения Wordstat сохранены.");
    } catch (caught) {
      if (
        caught instanceof BrowserApiError &&
        (caught.status === 409 || caught.status === 412)
      ) {
        await load();
        setError("Маршрут уже изменён другим участником. Загружена актуальная версия.");
      } else {
        setError(message(caught, "Не удалось сохранить подключения Wordstat."));
      }
    } finally {
      setSaving(false);
    }
  }

  async function createBinding(
    currentProjectId: string,
    body: CreateProjectConnectorBindingInput
  ): Promise<ProjectConnectorBinding> {
    const signature = JSON.stringify(body);
    if (createCommand.current?.signature !== signature) {
      createCommand.current = {
        signature,
        key: `project-wordstat-expansion:${globalThis.crypto.randomUUID()}`
      };
    }
    return browserApiRequest<ProjectConnectorBinding>(path(currentProjectId), {
      method: "POST",
      idempotencyKey: createCommand.current.key,
      body
    });
  }

  if (loading && !settings) {
    return <section className="panel connector-setup-state" aria-busy="true"><span className="spinner" aria-hidden="true" /><span>Проверяем провайдеров Wordstat…</span></section>;
  }
  if (!settings) {
    return <section className="panel connector-setup-state"><span>{error ?? "Провайдеры Wordstat недоступны."}</span><button className="secondary-button" onClick={() => void load()} type="button">Повторить</button></section>;
  }

  return (
    <details className="panel competitor-connector" open={!ready}>
      <summary>
        <span className="connector-provider-mark keyword-research-provider-pair"><ProviderLogo provider="XMLSTOCK" size="compact" /><ProviderLogo provider="ARSENKIN" size="compact" /><span className={ready ? "connector-ready-mark" : "connector-pending-mark"}>{ready ? "✓" : "!"}</span></span>
        <span><strong>Парсинг Wordstat · XMLStock и Arsenkin</strong><small>{ready ? `${currentIds.length} ${currentIds.length === 1 ? "провайдер готов" : "провайдера готовы"}` : "Выберите хотя бы одно проверенное подключение"}</small></span>
        <span className="connector-summary-action">{ready ? "Изменить" : "Настроить"}</span>
      </summary>
      <form className="competitor-connector-body wordstat-connector-body" onSubmit={save}>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {notice && <div className="inline-success" role="status">{notice}</div>}
        <CredentialField disabled={saving || !settings.access.canUpdateBindings} label="XMLStock" onChange={setXmlStockId} options={xmlStockOptions} value={xmlStockId} />
        <CredentialField disabled={saving || !settings.access.canUpdateBindings || (Boolean(xmlStockId) && !settings.access.canManageFallback)} label="Arsenkin Tools" onChange={setArsenkinId} options={arsenkinOptions} value={arsenkinId} />
        {current && <label className="connector-enabled-toggle"><input checked={enabled} disabled={saving || !settings.access.canUpdateBindings} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />Использовать в новых парсингах</label>}
        {routeIds.length > 1 && !settings.access.canManageFallback && <p className="inline-note">Для двух провайдеров нужно право управления резервными маршрутами.</p>}
        {options.length === 0 && <p className="inline-note">Сначала добавьте и проверьте XMLStock или Arsenkin Tools в рабочей области.</p>}
        {settings.access.mutationRestriction !== "NONE" && <p className="inline-note">Изменение ограничено текущей ролью или состоянием рабочей области.</p>}
        <div className="button-row"><a className="secondary-button" href="/app/settings/integrations">Управление API-ключами</a><button className="primary-button" disabled={!canSubmit || saving} type="submit">{saving ? "Сохраняем…" : "Сохранить провайдеров"}</button></div>
      </form>
    </details>
  );
}

function CredentialField({ disabled, label, onChange, options, value }: Readonly<{ disabled: boolean; label: string; onChange: (value: string) => void; options: readonly ProjectConnectorCredentialOption[]; value: string }>) {
  const selected = options.find(({ id }) => id === value);
  return (
    <label className="form-field"><span>{label}</span><CustomSelect disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}><option value="">Не использовать</option>{value && !selected && <option disabled value={value}>Подключение недоступно</option>}{options.map((credential) => <option disabled={credential.status !== "ACTIVE"} key={credential.id} value={credential.id}>{credential.label} · {integrationProviderLabel(credential.provider)}{credential.status === "ACTIVE" ? "" : ` · ${integrationCredentialStatusPresentation(credential.status).label}`}</option>)}</CustomSelect></label>
  );
}

function binding(settings: ProjectConnectorSettings): ProjectConnectorBinding | undefined {
  return settings.bindings.find(({ capability }) => capability === CAPABILITY);
}

function bindingRoutes(bindingValue: ProjectConnectorBinding | undefined) {
  return bindingValue?.routes ?? (bindingValue?.route ? [bindingValue.route] : []);
}

function providerRouteOrder(left: { readonly provider: string }, right: { readonly provider: string }): number {
  return (left.provider === "XMLSTOCK" ? 0 : 1) - (right.provider === "XMLSTOCK" ? 0 : 1);
}

function path(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`;
}

function message(error: unknown, fallback: string): string {
  if (!(error instanceof BrowserApiError)) return fallback;
  if (error.status === 402) return "Рабочая область доступна только для чтения.";
  if (error.status === 403) return "Недостаточно прав для изменения провайдеров.";
  return error.message;
}
