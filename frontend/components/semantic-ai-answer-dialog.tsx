"use client";
import { prepareOperationAttempt, type OperationAttempt } from "../lib/operation-attempt";

import {
  aiAnswerCollectionKeywordLimit,
  type AiAnswerCollectionSummary,
  type AiAnswerSearchEngine,
  type ProjectConnectorCredentialOption,
  type WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  isProjectConnectorCredentialEligible,
  workspaceConnectorOptions
} from "../lib/project-integration-settings";
import {
  defaultSemanticSearchRegions,
  readLastSemanticSearchRegions,
  searchRegionKind,
  writeLastSemanticRegion
} from "../lib/semantic-region-preference";
import { type RankTarget } from "../lib/rank-targets";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticRankTargets } from "./semantic-rank-targets";
import { SemanticModal } from "./semantic-modal";
import {
  SemanticOperationScope,
  type SemanticOperationGroup,
  type SemanticOperationSelection,
  type SemanticOperationScopeState
} from "./semantic-operation-scope";
import { useUiLocale, UiText } from "./ui-locale";


export function SemanticAiAnswerDialog({
  activeGroupId,
  groups,
  initialScope,
  initialSelections,
  mode = "positions",
  onClose,
  onStarted,
  projectDomain,
  projectId,
  workspaceId
}: Readonly<{
  activeGroupId?: string | undefined;
  groups: readonly SemanticOperationGroup[];
  initialScope?: SemanticOperationScopeState | undefined;
  initialSelections: readonly SemanticOperationSelection[];
  mode?: "positions" | "competitors";
  onClose: () => void;
  onStarted: (collection: AiAnswerCollectionSummary) => void;
  projectDomain: string;
  projectId: string;
  workspaceId: string;
}>) {
  const { t: uiText } = useUiLocale();
  const competitorMode = mode === "competitors";
  const formId = useId();
  const operationAttempts = useRef(new Map<string, OperationAttempt>());
  const [routing, setRouting] = useState<WorkspaceConnectorRoutingSettings>();
  const [credentialId, setCredentialId] = useState("");
  const [searchEngine, setSearchEngine] = useState<AiAnswerSearchEngine>("YANDEX");
  const [regions, setRegions] = useState(defaultSemanticSearchRegions);
  const [targets, setTargets] = useState<readonly RankTarget[]>(() => [{
    ...defaultSemanticSearchRegions().YANDEX,
    regionCode: defaultSemanticSearchRegions().YANDEX.code,
    regionLabel: defaultSemanticSearchRegions().YANDEX.label,
    device: "DESKTOP"
  }]);
  const [host, setHost] = useState(() => projectHost(projectDomain));
  const [excludeSubdomains, setExcludeSubdomains] = useState(false);
  const [brandsText, setBrandsText] = useState("");
  const [saveProjectPosition, setSaveProjectPosition] = useState(false);
  const [selections, setSelections] = useState<readonly SemanticOperationSelection[]>(initialSelections);
  const [resolvingScope, setResolvingScope] = useState(false);
  const [scopeError, setScopeError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const sources = useMemo(
    () => routing
      ? workspaceConnectorOptions(routing, "SERP_COLLECTION").filter(
          ({ provider }) => provider === "ARSENKIN"
        )
      : [],
    [routing]
  );
  const connectedAiSources = useMemo<readonly ProjectConnectorCredentialOption[]>(
    () => (routing?.credentialOptions ?? []).filter((source) =>
      source.provider === "ARSENKIN" &&
      isProjectConnectorCredentialEligible(source, "SERP_COLLECTION")
    ),
    [routing]
  );
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const brands = splitBrands(brandsText);
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
    const saved = readLastSemanticSearchRegions(
        window.localStorage,
        projectId,
        "AI_ANSWERS"
      );
    setRegions(saved);
    setTargets([{ regionCode: saved.YANDEX.code, regionLabel: saved.YANDEX.label, device: "DESKTOP" }]);
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void browserApiRequest<WorkspaceConnectorRoutingSettings>(
      `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        const options = workspaceConnectorOptions(result, "SERP_COLLECTION").filter(
          ({ provider }) => provider === "ARSENKIN"
        );
        setRouting(result);
        setCredentialId(options[0]?.id ?? "");
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(aiAnswerErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (running) return;
    setError(undefined);
    const normalizedHost = projectHost(competitorMode ? projectDomain : host);
    if (!normalizedHost) {
      setError("Укажите домен проекта без пути, например nt-g.ru.");
      return;
    }
    if (!competitorMode && brands.length > 10) {
      setError("Арсенкин принимает не больше 10 брендов за один запуск.");
      return;
    }
    setRunning(true);
    try {
      if (!routing || !selectedSource) {
        throw new Error("Нет активного подключения Arsenkin с доступом к сбору выдачи.");
      }
      const operationPath = `/app/api/projects/${encodeURIComponent(projectId)}/ai-answer-collections`;
      const collections: AiAnswerCollectionSummary[] = [];
      for (const target of targets) {
        const body = {
            items: selections.map(({ id, version }) => ({ id, version })),
            credentialId: selectedSource.id,
            searchEngine,
            regionCode: target.regionCode,
            device: target.device,
            host: normalizedHost,
            excludeSubdomains: competitorMode ? false : excludeSubdomains,
            brands: competitorMode ? [] : brands,
            ...(competitorMode
              ? {
                  purpose: "COMPETITOR_SERP" as const,
                  saveProjectPosition
                }
              : {})
          };
        const targetKey = `${searchEngine}:${target.regionCode}:${target.device}`;
        const attempt = prepareOperationAttempt(
          operationAttempts.current.get(targetKey),
          operationPath,
          body,
          selectedSource.id,
          `semantic-ai-answer:${targetKey}`
        );
        operationAttempts.current.set(targetKey, attempt);
        collections.push(await browserApiRequest<AiAnswerCollectionSummary>(operationPath, {
          method: "POST", operationAttempt: attempt, body
        }));
      }
      writeLastSemanticRegion(
        window.localStorage,
        projectId,
        "AI_ANSWERS",
        searchRegionKind(searchEngine),
        targets[0]!.regionCode
      );
      onStarted(collections[0]!);
    } catch (requestError) {
      if (requestError instanceof BrowserApiError && requestError.code === "OPERATION_CANCELLED") return;
      setError(aiAnswerErrorMessage(requestError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <SemanticModal
      description={competitorMode ? uiText("Собирает ИИ-выдачу и источники конкурентов через Arsenkin без ручного ввода домена. Домен автоматически берётся из настроек проекта.") : uiText("Проверка ИИ-ответов Яндекса или Google через Arsenkin выполняется в фоне и расходует 2 лимита за каждый запрос.")}
      footer={(
        <div className="semantic-workflow-footer">
          <dl className="semantic-dialog-estimate semantic-workflow-footer-estimate">
            <div><Icon name="semantic" /><div><dt><UiText text="К проверке" /></dt><dd>{selections.length} <UiText text="запросов" before=" " /></dd></div></div>
            <div><Icon name="ai" /><div><dt><UiText text="Поисковик" /></dt><dd>{searchEngine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}</dd></div></div>
            <div><Icon name="operations" /><div><dt><UiText text="Лимитов Arsenkin" /></dt><dd>{selections.length * targets.length * 2}</dd></div></div>
            {competitorMode ? (
              <div>
                <Icon name="rankCheck" />
                <div><dt><UiText text="Позиция сайта" /></dt><dd>{saveProjectPosition ? <UiText text="Сохранять" /> : <UiText text="Не сохранять" />}</dd></div>
              </div>
            ) : (
              <div><Icon name="checkDouble" /><div><dt><UiText text="Брендов" /></dt><dd>{brands.length} <UiText text="из 10" before=" " /></dd></div></div>
            )}
          </dl>
          <div className="semantic-modal-actions">
            <button className="secondary-button" disabled={running} onClick={onClose} type="button"><UiText text="Отмена" /></button>
            <button className="primary-button" disabled={loading || resolvingScope || running || !selectedSource || !projectHost(competitorMode ? projectDomain : host) || selections.length === 0 || targets.length === 0 || (!competitorMode && brands.length > 10)} form={formId} type="submit">
              {resolvingScope
                ? <UiText text="Загружаем запросы…" />
                : running
                  ? <UiText text="Запускаем…" />
                  : competitorMode
                    ? <UiText text="Собрать ИИ-выдачу ({0})" values={[String(selections.length * targets.length)]} />
                    : <UiText text="Проверить ИИ-ответы ({0})" values={[String(selections.length * targets.length)]} />}
            </button>
          </div>
        </div>
      )}
      onClose={running ? () => undefined : onClose}
      presenceKey={competitorMode
        ? "semantic-modal:ai-competitors"
        : "semantic-modal:ai-answers"}
      size="large"
      title={competitorMode ? uiText("Сбор ИИ-выдачи") : uiText("Проверить ИИ-ответы")}
    >
      <form className="semantic-ai-answer-dialog semantic-workflow-dialog" id={formId} onSubmit={(event) => void submit(event)}>
        <div className="semantic-workflow-grid semantic-ai-answer-workflow-grid">
          <section className="semantic-workflow-panel semantic-ai-source-panel">
            <header>
              <h3><UiText text="Поисковые системы" /></h3>
              <p><UiText text="Выберите ИИ-выдачу и подключение провайдера." /></p>
            </header>
            <div aria-label={uiText("Поисковая система ИИ-ответа")} className="semantic-engine-cards" role="group">
              {(["YANDEX", "GOOGLE"] as const).map((engine) => (
                <button
                  aria-pressed={searchEngine === engine}
                  className={searchEngine === engine ? "selected" : undefined}
                  key={engine}
                  onClick={() => {
                    setSearchEngine(engine);
                    const preferred = regions[engine];
                    setTargets([{
                      regionCode: preferred.code,
                      regionLabel: preferred.label,
                      device: targets[0]?.device ?? "DESKTOP"
                    }]);
                  }}
                  type="button"
                >
                  <SearchEngineLogo engine={engine} />
                  <span>{engine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}</span>
                  <i aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="semantic-provider-field">
              <div className="semantic-provider-field-heading">
                <h4><UiText text="Источник данных" /></h4>
                <a className="semantic-dialog-link" href="/app/settings/integrations"><UiText text="Управлять" /></a>
              </div>
            {loading ? (
              <div className="semantic-dialog-loading" role="status"><UiText text="Загружаем подключение…" /></div>
            ) : sources.length > 0 ? (
              <div aria-label={uiText("Подключение Arsenkin")} className="semantic-provider-list" role="radiogroup">
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
                      <b><UiText text="Подключено" /></b>
                    </span>
                    <i aria-hidden="true" className="semantic-provider-radio" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-alert warning">
                <span>{connectedAiSources.length > 0
                  ? <UiText text="Arsenkin подключён, но для сбора выдачи не выбран маршрут рабочей области." />
                  : <UiText text="Нет проверенного подключения Arsenkin с функцией сбора выдачи." />}</span>{" "}
                <a href="/app/settings/integrations"><UiText text="Настроить маршрутизацию" /></a>
              </div>
            )}
            </div>
          </section>

          <section className="semantic-workflow-panel semantic-ai-geo-panel">
            <header>
              <h3><UiText text="География и устройство" /></h3>
              <p>
                {competitorMode
                  ? <UiText text="Параметры отдельного среза ИИ-выдачи конкурентов." />
                  : <UiText text="Параметры отдельного среза ИИ-ответов." />}
              </p>
            </header>
              <SemanticRankTargets
                disabled={running}
                engine={searchEngine}
                onChange={setTargets}
                targets={targets}
              />
              {competitorMode ? (
                <>
                  <label className="semantic-check-row semantic-competitor-position-toggle">
                    <input
                      checked={saveProjectPosition}
                      onChange={(event) =>
                        setSaveProjectPosition(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong><UiText text="Сохранять позицию сайта из этой ИИ-выдачи" /></strong>
                      <small>
                        <UiText text="Если сайт проекта найден среди источников, позиция сохранится без отдельного API-запроса. При выключенной галочке сохраняются только ИИ-ответ и конкуренты." /></small>
                    </span>
                  </label>
                  {!projectHost(projectDomain) && (
                    <div className="inline-alert warning" role="alert">
                      <UiText text="В проекте не задан домен. Укажите его в настройках проекта, чтобы Arsenkin мог выполнить сбор ИИ-выдачи." /></div>
                  )}
                </>
              ) : (
                <>
                  <label className="semantic-workflow-field">
                    <span><UiText text="Домен проекта" /></span>
                    <input onChange={(event) => setHost(event.target.value)} placeholder="nt-g.ru" required value={host} />
                    <small><UiText text="По нему определяется позиция сайта внутри ИИ-ответа." /></small>
                  </label>
                  <label className="semantic-check-row">
                    <input checked={excludeSubdomains} onChange={(event) => setExcludeSubdomains(event.target.checked)} type="checkbox" />
                    <span><strong><UiText text="Не учитывать поддомены" /></strong><small><UiText text="Арсенкин проверит только основной домен." /></small></span>
                  </label>
                  <label className="semantic-workflow-field semantic-ai-brands-field">
                    <span><UiText text="Бренды" after=" " /><small><UiText text="необязательно, до 10" /></small></span>
                    <textarea onChange={(event) => setBrandsText(event.target.value)} placeholder={uiText("По одному бренду на строку")} rows={3} value={brandsText} />
                  </label>
                </>
              )}
          </section>

          <section className="semantic-workflow-panel semantic-ai-scope-panel">
            <header>
              <h3>{competitorMode ? <UiText text="Охват сбора" /> : <UiText text="Охват проверки" />}</h3>
              <p><UiText text="Выберите все запросы, текущее выделение или папки." /></p>
            </header>
            <SemanticOperationScope
              activeGroupId={activeGroupId}
              groups={groups}
              initialScope={initialScope}
              initialSelections={initialSelections}
              maxItems={aiAnswerCollectionKeywordLimit}
              onChange={resolveScope}
              projectId={projectId}
            />
          </section>
        </div>
        {(error || scopeError) && (
          <div className="semantic-workflow-feedback">
            {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
            {scopeError && <div className="inline-alert warning" role="alert">{<UiText text={scopeError ?? ""} />}</div>}
          </div>
        )}
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
