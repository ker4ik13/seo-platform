"use client";

import { CustomSelect } from "./custom-select";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  FrequencyCollectionSummary,
  ProjectConnectorBinding,
  ProjectConnectorSettings,
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import {
  arsenkinWordstatKeywordLimit,
  xmlStockWordstatKeywordLimit
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  createProjectConnectorBindingInput,
  projectConnectorBinding,
  projectConnectorOptions,
  updateProjectConnectorBindingInput,
  withProjectConnectorBinding
} from "../lib/project-integration-settings";
import { integrationProviderLabel } from "../lib/integration-presentation";
import { frequencyProviderUsageEstimate } from "../lib/provider-usage-estimate";
import { ProviderLogo } from "./provider-logo";
import { SearchableRegionSelect } from "./searchable-region-select";
import { SemanticModal } from "./semantic-modal";
import {
  SemanticOperationScope,
  type SemanticOperationGroup,
  type SemanticOperationSelection
} from "./semantic-operation-scope";

export function SemanticFrequencyDialog({
  onClose,
  onStarted,
  projectId,
  activeGroupId,
  groups,
  initialSelections
}: Readonly<{
  onClose: () => void;
  onStarted: (collection: FrequencyCollectionSummary) => void;
  projectId: string;
  activeGroupId?: string | undefined;
  groups: readonly SemanticOperationGroup[];
  initialSelections: readonly SemanticOperationSelection[];
}>) {
  const [types, setTypes] = useState<ReadonlySet<SemanticFrequencyType>>(
    new Set(["BASE", "EXACT", "FIXED"])
  );
  const [regionCode, setRegionCode] = useState("213");
  const [device, setDevice] = useState<SemanticFrequencyDevice>("ALL");
  const [settings, setSettings] = useState<ProjectConnectorSettings>();
  const [credentialId, setCredentialId] = useState("");
  const [loadingSources, setLoadingSources] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [scopeError, setScopeError] = useState<string>();
  const [resolvingScope, setResolvingScope] = useState(false);
  const [selections, setSelections] = useState<readonly SemanticOperationSelection[]>(
    initialSelections
  );
  const orderedTypes = useMemo(
    () => (["BASE", "EXACT", "FIXED"] as const).filter((type) => types.has(type)),
    [types]
  );
  const wordstatBinding = settings
    ? projectConnectorBinding(settings, "WORDSTAT")
    : undefined;
  const sources = useMemo(
    () => settings
      ? projectConnectorOptions(settings, "WORDSTAT").filter(
          ({ status }) => status === "ACTIVE"
        )
      : [],
    [settings]
  );
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const providerUsage = frequencyProviderUsageEstimate(
    selectedSource,
    selections.length,
    orderedTypes.length
  );
  const keywordLimit = selectedSource?.provider === "ARSENKIN"
    ? arsenkinWordstatKeywordLimit
    : selectedSource
      ? xmlStockWordstatKeywordLimit
      : arsenkinWordstatKeywordLimit;
  const resolveScope = useCallback((
    next: readonly SemanticOperationSelection[],
    resolving: boolean,
    nextError?: string
  ) => {
    setSelections(next);
    setResolvingScope(resolving);
    setScopeError(nextError);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingSources(true);
    void browserApiRequest<ProjectConnectorSettings>(
      `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        const binding = projectConnectorBinding(result, "WORDSTAT");
        const options = projectConnectorOptions(result, "WORDSTAT").filter(
          ({ status }) => status === "ACTIVE"
        );
        setSettings(result);
        setCredentialId(
          options.some(({ id }) => id === binding?.route?.credentialId)
            ? binding?.route?.credentialId ?? ""
            : options[0]?.id ?? ""
        );
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(frequencyErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSources(false);
      });
    return () => controller.abort();
  }, [projectId]);

  function toggleType(type: SemanticFrequencyType): void {
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(type) && next.size > 1) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (running || orderedTypes.length === 0) return;
    setRunning(true);
    setError(undefined);
    try {
      if (!settings || !selectedSource) {
        throw new Error(
          "Нет активного подключения XMLStock или Arsenkin с доступом к Wordstat."
        );
      }
      await ensureWordstatBinding(settings, wordstatBinding, selectedSource.id);
      const collection = await browserApiRequest<FrequencyCollectionSummary>(
        `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections`,
        {
          method: "POST",
          idempotencyKey: `semantic-frequency:${crypto.randomUUID()}`,
          body: {
            items: selections.map(({ id, version }) => ({ id, version })),
            types: orderedTypes,
            regionCode,
            device
          }
        }
      );
      onStarted(collection);
    } catch (requestError) {
      setError(frequencyErrorMessage(requestError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <SemanticModal
      description="Сбор выполняется в фоне через выбранный проверенный Wordstat API. Секрет не попадает в очередь, браузер или журнал операции."
      onClose={running ? () => undefined : onClose}
      size="large"
      title="Сбор частотности"
    >
      <form className="semantic-frequency-dialog" onSubmit={(event) => void submit(event)}>
        <SemanticOperationScope
          activeGroupId={activeGroupId}
          groups={groups}
          initialSelections={initialSelections}
          maxItems={keywordLimit}
          onChange={resolveScope}
          projectId={projectId}
        />
        <div className="semantic-frequency-grid">
          <section>
            <h3>Источник данных</h3>
            {loadingSources ? (
              <div className="semantic-dialog-loading" role="status">Загружаем подключения…</div>
            ) : sources.length ? (
              <div className="semantic-provider-list" role="radiogroup" aria-label="Источник Wordstat">
                {sources.map((source) => (
                  <button
                    aria-checked={source.id === credentialId}
                    className={`semantic-provider-card ${source.id === credentialId ? "selected" : ""}`}
                    key={source.id}
                    onClick={() => setCredentialId(source.id)}
                    role="radio"
                    type="button"
                  >
                    <ProviderLogo provider={source.provider} />
                    <span>
                      <strong>{integrationProviderLabel(source.provider)}</strong>
                      <small>{source.label} · ваш API</small>
                    </span>
                    <i>{source.id === credentialId ? "Выбран" : "Выбрать"}</i>
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-alert warning">Нет проверенного подключения с функцией Wordstat.</div>
            )}
            <a href="/app/settings/integrations">Управление API-ключами</a>
          </section>
          <section>
            <h3>Параметры сбора</h3>
            <fieldset>
              <legend>Виды частотности</legend>
              <label><input checked={types.has("BASE")} onChange={() => toggleType("BASE")} type="checkbox" /> Базовая</label>
              <label><input checked={types.has("EXACT")} onChange={() => toggleType("EXACT")} type="checkbox" /> Фразовая</label>
              <label><input checked={types.has("FIXED")} onChange={() => toggleType("FIXED")} type="checkbox" /> Точная словоформа</label>
            </fieldset>
            <label>
              <span>Регион Wordstat</span>
              <SearchableRegionSelect
                allowAll
                autoFocus
                kind="WORDSTAT"
                onChange={({ code }) => setRegionCode(code)}
                value={regionCode}
              />
              <small>Начните вводить название или код региона.</small>
            </label>
            <label>
              <span>Устройство</span>
              <CustomSelect onChange={(event) => setDevice(event.target.value as SemanticFrequencyDevice)} value={device}>
                <option value="ALL">Все устройства</option>
                <option value="DESKTOP">Десктоп</option>
                <option value="MOBILE">Мобильные</option>
                <option value="PHONE_ONLY">Только телефоны</option>
                <option value="TABLET_ONLY">Только планшеты</option>
              </CustomSelect>
            </label>
          </section>
        </div>
        <dl className="semantic-dialog-estimate">
          <div><dt>Запросов</dt><dd>{selections.length}</dd></div>
          <div>
            <dt>Задач провайдера</dt>
            <dd>
              {selectedSource?.provider === "ARSENKIN"
                ? selections.length > 0
                  ? 1
                  : 0
                : `до ${selections.length * orderedTypes.length}`}
            </dd>
          </div>
          <div><dt>Расход провайдера</dt><dd>{providerUsage.usage}</dd></div>
          <div><dt>Доступно сейчас</dt><dd>{providerUsage.available}</dd></div>
        </dl>
        {error && (
          <div className="inline-alert danger" role="alert">
            <span>{error}</span>{" "}
            <a href={`/app/projects/${encodeURIComponent(projectId)}/settings/integrations`}>Настроить маршрут Wordstat</a>
          </div>
        )}
        {scopeError && <div className="inline-alert warning" role="alert">{scopeError}</div>}
        <div className="semantic-modal-actions">
          <button className="secondary-button" disabled={running} onClick={onClose} type="button">Отмена</button>
          <button className="primary-button" disabled={loadingSources || resolvingScope || running || !selectedSource || selections.length === 0 || orderedTypes.length === 0} type="submit">
            {resolvingScope ? "Загружаем запросы…" : running ? "Запускаем…" : `Запустить сбор (${selections.length})`}
          </button>
        </div>
      </form>
    </SemanticModal>
  );

  async function ensureWordstatBinding(
    currentSettings: ProjectConnectorSettings,
    binding: ProjectConnectorBinding | undefined,
    selectedCredentialId: string
  ): Promise<void> {
    if (
      binding?.enabled &&
      binding.route?.credentialId === selectedCredentialId &&
      binding.availability === "READY"
    ) return;
    const draft = { credentialId: selectedCredentialId, enabled: true };
    const updated = binding
      ? await browserApiRequest<ProjectConnectorBinding>(
          `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings/${encodeURIComponent(binding.id)}`,
          {
            method: "PATCH",
            ifMatch: binding.version,
            body: updateProjectConnectorBindingInput(draft)
          }
        )
      : await browserApiRequest<ProjectConnectorBinding>(
          `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`,
          {
            method: "POST",
            idempotencyKey: `semantic-wordstat-binding:${crypto.randomUUID()}`,
            body: createProjectConnectorBindingInput("WORDSTAT", draft)
          }
        );
    setSettings(withProjectConnectorBinding(currentSettings, updated));
  }
}

function frequencyErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "CONNECTOR_NOT_READY") {
      return "Подключите XMLStock или Arsenkin, подтвердите ключ и назначьте проекту маршрут Wordstat.";
    }
    if (error.code === "FORBIDDEN") return "Недостаточно прав для запуска сборщика.";
    if (error.code === "PAYMENT_REQUIRED") return "Workspace доступен только для чтения.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Не удалось запустить сбор частотности.";
}
