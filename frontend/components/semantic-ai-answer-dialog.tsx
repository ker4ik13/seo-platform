"use client";

import {
  arsenkinAiAnswerKeywordLimit,
  type AiAnswerCollectionSummary,
  type AiAnswerDevice,
  type AiAnswerSearchEngine,
  type ProjectConnectorBinding,
  type ProjectConnectorSettings
} from "@seo-platform/contracts";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  createProjectConnectorBindingInput,
  projectConnectorBinding,
  projectConnectorOptions,
  updateProjectConnectorBindingInput,
  withProjectConnectorBinding
} from "../lib/project-integration-settings";
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

export function SemanticAiAnswerDialog({
  activeGroupId,
  groups,
  initialSelections,
  onClose,
  onStarted,
  projectDomain,
  projectId
}: Readonly<{
  activeGroupId?: string | undefined;
  groups: readonly SemanticOperationGroup[];
  initialSelections: readonly SemanticOperationSelection[];
  onClose: () => void;
  onStarted: (collection: AiAnswerCollectionSummary) => void;
  projectDomain: string;
  projectId: string;
}>) {
  const [settings, setSettings] = useState<ProjectConnectorSettings>();
  const [credentialId, setCredentialId] = useState("");
  const [searchEngine, setSearchEngine] = useState<AiAnswerSearchEngine>("YANDEX");
  const [regionCodes, setRegionCodes] = useState({ YANDEX: "225", GOOGLE: "2643" });
  const [device, setDevice] = useState<AiAnswerDevice>("DESKTOP");
  const [host, setHost] = useState(() => projectHost(projectDomain));
  const [excludeSubdomains, setExcludeSubdomains] = useState(false);
  const [brandsText, setBrandsText] = useState("");
  const [selections, setSelections] = useState<readonly SemanticOperationSelection[]>(initialSelections);
  const [resolvingScope, setResolvingScope] = useState(false);
  const [scopeError, setScopeError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const binding = settings ? projectConnectorBinding(settings, "SERP_COLLECTION") : undefined;
  const sources = useMemo(
    () => settings
      ? projectConnectorOptions(settings, "SERP_COLLECTION").filter(
          ({ provider, status }) => provider === "ARSENKIN" && status === "ACTIVE"
        )
      : [],
    [settings]
  );
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const brands = splitBrands(brandsText);
  const regionCode = regionCodes[searchEngine];
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
    setHost(projectHost(projectDomain));
  }, [projectDomain]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void browserApiRequest<ProjectConnectorSettings>(
      `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        const current = projectConnectorBinding(result, "SERP_COLLECTION");
        const options = projectConnectorOptions(result, "SERP_COLLECTION").filter(
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
        if (!controller.signal.aborted) setError(aiAnswerErrorMessage(requestError));
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
    const normalizedHost = projectHost(host);
    if (!normalizedHost) {
      setError("Укажите домен проекта без пути, например nt-g.ru.");
      return;
    }
    if (brands.length > 10) {
      setError("Арсенкин принимает не больше 10 брендов за один запуск.");
      return;
    }
    setRunning(true);
    try {
      if (!settings || !selectedSource) {
        throw new Error("Нет активного подключения Arsenkin с доступом к сбору выдачи.");
      }
      await ensureBinding(settings, binding, selectedSource.id);
      const collection = await browserApiRequest<AiAnswerCollectionSummary>(
        `/app/api/projects/${encodeURIComponent(projectId)}/ai-answer-collections`,
        {
          method: "POST",
          idempotencyKey: `semantic-ai-answer:${crypto.randomUUID()}`,
          body: {
            items: selections.map(({ id, version }) => ({ id, version })),
            searchEngine,
            regionCode,
            device,
            host: normalizedHost,
            excludeSubdomains,
            brands
          }
        }
      );
      onStarted(collection);
    } catch (requestError) {
      setError(aiAnswerErrorMessage(requestError));
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
            idempotencyKey: `semantic-ai-answer-binding:${crypto.randomUUID()}`,
            body: createProjectConnectorBindingInput("SERP_COLLECTION", draft)
          }
        );
    setSettings(withProjectConnectorBinding(currentSettings, updated));
  }

  return (
    <SemanticModal
      description="Проверка ИИ-ответов Яндекса или Google через Arsenkin выполняется в фоне и расходует 2 лимита за каждый запрос."
      onClose={running ? () => undefined : onClose}
      size="large"
      title="Проверить ИИ-ответы"
    >
      <form className="semantic-ai-answer-dialog semantic-workflow-dialog" onSubmit={(event) => void submit(event)}>
        <div className="semantic-workflow-grid semantic-ai-answer-workflow-grid">
          <section className="semantic-workflow-panel semantic-ai-source-panel">
            <header>
              <h3>Поисковые системы</h3>
              <p>Выберите ИИ-выдачу и подключение провайдера.</p>
            </header>
            <div aria-label="Поисковая система ИИ-ответа" className="semantic-engine-cards" role="group">
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
            <div className="semantic-provider-field">
              <div className="semantic-provider-field-heading">
                <h4>Источник данных</h4>
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
                      <small>{source.label} · AI SERP API</small>
                      <b>Подключено</b>
                    </span>
                    <i aria-hidden="true" className="semantic-provider-radio" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-alert warning">Нет проверенного подключения Arsenkin с функцией сбора выдачи.</div>
            )}
            </div>
          </section>

          <section className="semantic-workflow-panel semantic-ai-geo-panel">
            <header>
              <h3>География и устройство</h3>
              <p>Параметры отдельного среза ИИ-ответов.</p>
            </header>
              <label className="semantic-workflow-field">
                <span>Регион</span>
                <SearchableRegionSelect
                  kind={searchEngine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK"}
                  onChange={({ code }) => setRegionCodes((current) => ({ ...current, [searchEngine]: code }))}
                  value={regionCode}
                />
              </label>
              <fieldset className="semantic-device-cards">
                <legend>Устройство</legend>
                <div aria-label="Устройство" role="radiogroup">
                  {(["DESKTOP", "MOBILE"] as const).map((value) => (
                    <label className={device === value ? "selected" : undefined} key={value}>
                      <input checked={device === value} onChange={() => setDevice(value)} type="radio" />
                      <Icon name={value === "DESKTOP" ? "desktop" : "mobile"} />
                      <span>{value === "DESKTOP" ? "Десктоп" : "Мобильное"}</span>
                      <i aria-hidden="true" />
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="semantic-workflow-field">
                <span>Домен проекта</span>
                <input onChange={(event) => setHost(event.target.value)} placeholder="nt-g.ru" required value={host} />
                <small>По нему определяется позиция сайта внутри ИИ-ответа.</small>
              </label>
              <label className="semantic-check-row">
                <input checked={excludeSubdomains} onChange={(event) => setExcludeSubdomains(event.target.checked)} type="checkbox" />
                <span><strong>Не учитывать поддомены</strong><small>Арсенкин проверит только основной домен.</small></span>
              </label>
              <label className="semantic-workflow-field semantic-ai-brands-field">
                <span>Бренды <small>необязательно, до 10</small></span>
                <textarea onChange={(event) => setBrandsText(event.target.value)} placeholder="По одному бренду на строку" rows={3} value={brandsText} />
              </label>
          </section>

          <section className="semantic-workflow-panel semantic-ai-scope-panel">
            <header>
              <h3>Охват проверки</h3>
              <p>Выберите все запросы, текущее выделение или папки.</p>
            </header>
            <SemanticOperationScope
              activeGroupId={activeGroupId}
              groups={groups}
              initialSelections={initialSelections}
              maxItems={arsenkinAiAnswerKeywordLimit}
              onChange={resolveScope}
              projectId={projectId}
            />
          </section>
        </div>
        <dl className="semantic-dialog-estimate">
          <div><Icon name="semantic" /><div><dt>К проверке</dt><dd>{selections.length} запросов</dd></div></div>
          <div><Icon name="ai" /><div><dt>Поисковик</dt><dd>{searchEngine === "YANDEX" ? "Яндекс" : "Google"}</dd></div></div>
          <div><Icon name="operations" /><div><dt>Лимитов Arsenkin</dt><dd>{selections.length * 2}</dd></div></div>
          <div><Icon name="checkDouble" /><div><dt>Брендов</dt><dd>{brands.length} из 10</dd></div></div>
        </dl>
        {(error || scopeError) && (
          <div className="semantic-workflow-feedback">
            {error && <div className="inline-alert danger" role="alert">{error}</div>}
            {scopeError && <div className="inline-alert warning" role="alert">{scopeError}</div>}
          </div>
        )}
        <div className="semantic-modal-actions semantic-workflow-footer">
          <button className="secondary-button" disabled={running} onClick={onClose} type="button">Отмена</button>
          <button className="primary-button" disabled={loading || resolvingScope || running || !selectedSource || !host || selections.length === 0 || brands.length > 10} type="submit">
            {resolvingScope ? "Загружаем запросы…" : running ? "Запускаем…" : `Проверить ИИ-ответы (${selections.length})`}
          </button>
        </div>
      </form>
    </SemanticModal>
  );
}

function projectHost(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) return "";
  try {
    return new URL(normalized.includes("://") ? normalized : `https://${normalized}`)
      .hostname
      .toLocaleLowerCase("en-US")
      .replace(/^www\./u, "");
  } catch {
    return "";
  }
}

function splitBrands(value: string): readonly string[] {
  const values = value
    .split(/[\n,;]/u)
    .map((brand) => brand.trim())
    .filter(Boolean);
  return [...new Map(values.map((brand) => [brand.toLocaleLowerCase("ru-RU"), brand])).values()];
}

function aiAnswerErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "CONNECTOR_NOT_READY") {
      return "Подключите Arsenkin, подтвердите API-ключ и назначьте маршрут сбора выдачи.";
    }
    if (error.code === "FORBIDDEN") return "Недостаточно прав для запуска проверки ИИ-ответов.";
    if (error.code === "PAYMENT_REQUIRED") return "Workspace доступен только для чтения.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Не удалось запустить проверку ИИ-ответов.";
}
