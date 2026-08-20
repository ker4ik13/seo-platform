"use client";

import {
  arsenkinClusteringKeywordLimit,
  clusteringDepths,
  type ClusteringDepth,
  type ClusteringFrequencyType,
  type ClusteringMethod,
  type ClusteringRunSummary,
  type ClusteringSearchEngine,
  type ProjectConnectorBinding,
  type ProjectConnectorSettings
} from "@seo-platform/contracts";
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  createProjectConnectorBindingInput,
  projectConnectorBinding,
  projectConnectorOptions,
  updateProjectConnectorBindingInput,
  withProjectConnectorBinding
} from "../lib/project-integration-settings";
import {
  defaultSemanticClusteringFrequencyTypes,
  defaultSemanticClusteringMethod,
  semanticClusteringMethodOptions
} from "../lib/semantic-clustering-defaults";
import {
  defaultSemanticSearchRegions,
  readLastSemanticSearchRegions,
  searchRegionKind,
  writeLastSemanticRegion
} from "../lib/semantic-region-preference";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";
import { SearchableRegionSelect } from "./searchable-region-select";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticModal } from "./semantic-modal";
import {
  SemanticOperationScope,
  type SemanticOperationGroup,
  type SemanticOperationSelection
} from "./semantic-operation-scope";

export function SemanticClusteringDialog({
  activeGroupId,
  groups,
  initialSelections,
  onClose,
  onStarted,
  projectId
}: Readonly<{
  activeGroupId?: string | undefined;
  groups: readonly SemanticOperationGroup[];
  initialSelections: readonly SemanticOperationSelection[];
  onClose: () => void;
  onStarted: (run: ClusteringRunSummary) => void;
  projectId: string;
}>) {
  const formId = useId();
  const [settings, setSettings] = useState<ProjectConnectorSettings>();
  const [credentialId, setCredentialId] = useState("");
  const [searchEngine, setSearchEngine] = useState<ClusteringSearchEngine>("YANDEX");
  const [regions, setRegions] = useState(defaultSemanticSearchRegions);
  const [method, setMethod] = useState<ClusteringMethod>(
    defaultSemanticClusteringMethod
  );
  const [overlapCount, setOverlapCount] = useState(3);
  const [depth, setDepth] = useState<ClusteringDepth>(10);
  const [excludeMainPages, setExcludeMainPages] = useState(false);
  const [frequencyTypes, setFrequencyTypes] = useState<readonly ClusteringFrequencyType[]>(
    defaultSemanticClusteringFrequencyTypes
  );
  const [replaceExistingClusters, setReplaceExistingClusters] = useState(false);
  const [stopDomainsText, setStopDomainsText] = useState("");
  const [selections, setSelections] = useState<readonly SemanticOperationSelection[]>(initialSelections);
  const [resolvingScope, setResolvingScope] = useState(false);
  const [scopeError, setScopeError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const binding = settings ? projectConnectorBinding(settings, "CLUSTERING") : undefined;
  const sources = useMemo(
    () => settings
      ? projectConnectorOptions(settings, "CLUSTERING").filter(
          ({ provider, status }) => provider === "ARSENKIN" && status === "ACTIVE"
        )
      : [],
    [settings]
  );
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const stopDomains = splitDomains(stopDomainsText);
  const regionCode = regions[searchEngine].code;
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
    setRegions(
      readLastSemanticSearchRegions(
        window.localStorage,
        projectId,
        "CLUSTERING"
      )
    );
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void browserApiRequest<ProjectConnectorSettings>(
      `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        const current = projectConnectorBinding(result, "CLUSTERING");
        const options = projectConnectorOptions(result, "CLUSTERING").filter(
          ({ provider, status }) => provider === "ARSENKIN" && status === "ACTIVE"
        );
        setSettings(result);
        setCredentialId(
          options.some(({ id }) => id === current?.route?.credentialId)
            ? current?.route?.credentialId ?? ""
            : options[0]?.id ?? ""
        );
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(clusteringErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (running) return;
    setError(undefined);
    if (stopDomains.length > 100) {
      setError("Можно исключить не больше 100 доменов за один запуск.");
      return;
    }
    setRunning(true);
    try {
      if (!settings || !selectedSource) {
        throw new Error("Нет активного подключения Arsenkin с доступом к кластеризации.");
      }
      await ensureBinding(settings, binding, selectedSource.id);
      const run = await browserApiRequest<ClusteringRunSummary>(
        `/app/api/projects/${encodeURIComponent(projectId)}/clustering-runs`,
        {
          method: "POST",
          idempotencyKey: `semantic-clustering:${crypto.randomUUID()}`,
          body: {
            items: selections.map(({ id, version }) => ({ id, version })),
            searchEngine,
            regionCode,
            method,
            overlapCount,
            depth,
            excludeMainPages,
            stopDomains,
            frequencyTypes,
            replaceExistingClusters
          }
        }
      );
      writeLastSemanticRegion(
        window.localStorage,
        projectId,
        "CLUSTERING",
        searchRegionKind(searchEngine),
        regionCode
      );
      onStarted(run);
    } catch (requestError) {
      setError(clusteringErrorMessage(requestError));
    } finally {
      setRunning(false);
    }
  }

  async function ensureBinding(
    currentSettings: ProjectConnectorSettings,
    currentBinding: ProjectConnectorBinding | undefined,
    selectedCredentialId: string
  ): Promise<void> {
    if (
      currentBinding?.enabled &&
      currentBinding.route?.credentialId === selectedCredentialId &&
      currentBinding.availability === "READY"
    ) return;
    const draft = { credentialId: selectedCredentialId, enabled: true };
    const updated = currentBinding
      ? await browserApiRequest<ProjectConnectorBinding>(
          `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings/${encodeURIComponent(currentBinding.id)}`,
          {
            method: "PATCH",
            ifMatch: currentBinding.version,
            body: updateProjectConnectorBindingInput(draft)
          }
        )
      : await browserApiRequest<ProjectConnectorBinding>(
          `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`,
          {
            method: "POST",
            idempotencyKey: `semantic-clustering-binding:${crypto.randomUUID()}`,
            body: createProjectConnectorBindingInput("CLUSTERING", draft)
          }
        );
    setSettings(withProjectConnectorBinding(currentSettings, updated));
  }

  return (
    <SemanticModal
      description="Arsenkin сравнит выдачу по каждому запросу. Результат сначала сохраняется как черновик: папки и кластеры изменятся только после вашего подтверждения."
      footer={(
        <div className="semantic-workflow-footer">
          <dl className="semantic-dialog-estimate semantic-workflow-footer-estimate">
            <div><Icon name="cluster" /><div><dt>Запросов</dt><dd>{selections.length}</dd></div></div>
            <div><SearchEngineLogo engine={searchEngine} /><div><dt>Выдача</dt><dd>{searchEngine === "YANDEX" ? "Яндекс" : "Google"} · ТОП-{depth}</dd></div></div>
            <div><Icon name="multiGroup" /><div><dt>Метод</dt><dd>{method === "SOFT" ? "Мягкий" : "Жёсткий"} · {overlapCount} совп.</dd></div></div>
            <div><ProviderLogo provider="ARSENKIN" size="compact" /><div><dt>Применение</dt><dd>После проверки</dd></div></div>
          </dl>
          <div className="semantic-modal-actions">
            <button className="secondary-button" disabled={running} onClick={onClose} type="button">Отмена</button>
            <button className="primary-button" disabled={loading || resolvingScope || running || !selectedSource || selections.length === 0 || stopDomains.length > 100} form={formId} type="submit">
              {resolvingScope ? "Загружаем запросы…" : running ? "Запускаем…" : `Кластеризовать (${selections.length})`}
            </button>
          </div>
        </div>
      )}
      onClose={running ? () => undefined : onClose}
      presenceKey="semantic-modal:clustering"
      size="large"
      title="Кластеризовать запросы"
    >
      <form className="semantic-clustering-dialog semantic-workflow-dialog" id={formId} onSubmit={(event) => void submit(event)}>
        <div className="semantic-workflow-grid semantic-clustering-workflow-grid">
          <section className="semantic-workflow-panel semantic-clustering-source-panel">
            <header>
              <h3>Источник и выдача</h3>
              <p>Выберите поисковик и подключение Arsenkin.</p>
            </header>
            <div aria-label="Поисковая система" className="semantic-engine-cards" role="group">
              {(["YANDEX", "GOOGLE"] as const).map((engine) => (
                <button
                  aria-pressed={searchEngine === engine}
                  className={searchEngine === engine ? "selected" : undefined}
                  key={engine}
                  onClick={() => setSearchEngine(engine)}
                  type="button"
                >
                  <SearchEngineLogo engine={engine} />
                  <span>{engine === "YANDEX" ? "Яндекс" : "Google"}</span>
                  <i aria-hidden="true" />
                </button>
              ))}
            </div>
            <label className="semantic-workflow-field">
              <span>Регион выдачи</span>
              <SearchableRegionSelect
                kind={searchEngine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK"}
                onChange={(region) => setRegions((current) => ({
                  ...current,
                  [searchEngine]: region
                }))}
                value={regionCode}
              />
              <small>
                Первый запуск — Москва; затем используется регион последней успешной кластеризации.
              </small>
            </label>
            <div className="semantic-provider-field">
              <div className="semantic-provider-field-heading">
                <h4>Провайдер</h4>
                <a className="semantic-dialog-link" href="/app/settings/integrations">Управлять</a>
              </div>
              {loading ? (
                <div className="semantic-dialog-loading" role="status">Загружаем подключение…</div>
              ) : sources.length > 0 ? (
                <div aria-label="Подключение Arsenkin" className="semantic-provider-list" role="radiogroup">
                  {sources.map((source) => (
                    <button
                      aria-checked={source.id === credentialId}
                      className={`semantic-provider-card ${source.id === credentialId ? "selected" : ""}`}
                      key={source.id}
                      onClick={() => setCredentialId(source.id)}
                      role="radio"
                      type="button"
                    >
                      <ProviderLogo provider="ARSENKIN" />
                      <span className="semantic-provider-card-copy">
                        <strong>Arsenkin Tools</strong>
                        <small>{source.label} · Clustering API</small>
                        <b>Подключено</b>
                      </span>
                      <i aria-hidden="true" className="semantic-provider-radio" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="inline-alert warning">Нет проверенного подключения Arsenkin с функцией кластеризации.</div>
              )}
            </div>
          </section>

          <section className="semantic-workflow-panel semantic-clustering-settings-panel">
            <header>
              <h3>Правила кластеризации</h3>
              <p>Настройте силу объединения и глубину выдачи.</p>
            </header>
            <fieldset className="semantic-segmented-field">
              <legend>Метод</legend>
              <div className="semantic-segmented-control" role="radiogroup" aria-label="Метод кластеризации">
                {semanticClusteringMethodOptions.map((option) => (
                  <label className={method === option.value ? "selected" : undefined} key={option.value}>
                    <input checked={method === option.value} onChange={() => setMethod(option.value)} type="radio" />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              <small>{method === "SOFT" ? "Запросы объединяются, если имеют общие URL с ведущим запросом." : "Все запросы внутри группы должны быть связаны общими URL."}</small>
            </fieldset>
            <label className="semantic-workflow-field">
              <span>Совпадений в ТОПе: {overlapCount}</span>
              <input
                max={10}
                min={2}
                onChange={(event) => setOverlapCount(Number(event.target.value))}
                type="range"
                value={overlapCount}
              />
              <small>Чем больше значение, тем уже и точнее получатся группы.</small>
            </label>
            <fieldset className="semantic-segmented-field">
              <legend>Глубина выдачи</legend>
              <div className="semantic-segmented-control" role="radiogroup" aria-label="Глубина выдачи">
                {clusteringDepths.map((value) => (
                  <label className={depth === value ? "selected" : undefined} key={value}>
                    <input checked={depth === value} onChange={() => setDepth(value)} type="radio" />
                    <span>ТОП-{value}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="semantic-check-row">
              <input checked={excludeMainPages} onChange={(event) => setExcludeMainPages(event.target.checked)} type="checkbox" />
              <span><strong>Исключить главные страницы</strong><small>Не учитывать главные страницы сайтов при сравнении выдачи.</small></span>
            </label>
            <fieldset className="semantic-segmented-field">
              <legend>Частотность <small>необязательно</small></legend>
              <div aria-label="Виды частотности" className="semantic-segmented-control" role="group">
                {([[
                  "BASE", "Базовая"
                ], ["QUOTED", "Фразовая"], ["OVERALL", "Общая"], ["EXACT", "Точная"]] as const).map(([value, label]) => (
                  <label className={frequencyTypes.includes(value) ? "selected" : undefined} key={value}>
                    <input
                      checked={frequencyTypes.includes(value)}
                      onChange={() => setFrequencyTypes((current) => current.includes(value)
                        ? current.filter((item) => item !== value)
                        : [...current, value])}
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <small>Можно оставить все варианты выключенными, чтобы не собирать частотность.</small>
            </fieldset>
            <label className="semantic-check-row">
              <input checked={replaceExistingClusters} onChange={(event) => setReplaceExistingClusters(event.target.checked)} type="checkbox" />
              <span><strong>Разрешить перекластеризацию</strong><small>Иначе запросы из существующих кластеров будут отмечены конфликтами и останутся без изменений.</small></span>
            </label>
            <label className="semantic-workflow-field semantic-clustering-stoplist">
              <span>Стоп-домены <small>необязательно, до 100</small></span>
              <textarea onChange={(event) => setStopDomainsText(event.target.value)} placeholder="market.yandex.ru&#10;ozon.ru" rows={3} value={stopDomainsText} />
              <small>По одному домену на строку. Эти сайты не участвуют в сравнении.</small>
            </label>
          </section>

          <section className="semantic-workflow-panel semantic-clustering-scope-panel">
            <header>
              <h3>Запросы</h3>
              <p>Выберите вручную, из папок или весь проект.</p>
            </header>
            <SemanticOperationScope
              activeGroupId={activeGroupId}
              groups={groups}
              initialSelections={initialSelections}
              maxItems={arsenkinClusteringKeywordLimit}
              onChange={resolveScope}
              projectId={projectId}
            />
          </section>
        </div>
        {(error || scopeError) && (
          <div className="semantic-workflow-feedback">
            {error && <div className="inline-alert danger" role="alert">{error}</div>}
            {scopeError && <div className="inline-alert warning" role="alert">{scopeError}</div>}
          </div>
        )}
      </form>
    </SemanticModal>
  );
}

function splitDomains(value: string): readonly string[] {
  const values = value
    .split(/[\n,;]/u)
    .map((domain) => domain.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/^www\./u, ""))
    .filter(Boolean);
  return [...new Set(values)];
}

function clusteringErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "CONNECTOR_NOT_READY") {
      return "Подключите Arsenkin, подтвердите API-ключ и назначьте маршрут кластеризации.";
    }
    if (error.code === "FORBIDDEN") return "Недостаточно прав для запуска кластеризации.";
    if (error.code === "PAYMENT_REQUIRED") return "Workspace доступен только для чтения.";
    if (error.code === "QUOTA_EXCEEDED") return "Выбранный объём превышает лимит текущего тарифа.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Не удалось запустить кластеризацию.";
}
