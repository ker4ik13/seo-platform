"use client";
import { prepareOperationAttempt, type OperationAttempt } from "../lib/operation-attempt";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  FrequencyCollectionMode,
  FrequencyCollectionSummary,
  FrequencySeasonalityGranularity,
  ProjectConnectorBinding,
  ProjectConnectorSettings,
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import {
  arsenkinWordstatKeywordLimit,
  frequencyCollectionKeywordLimit,
  parseFrequencySeasonalityRequest
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { preparedProjectIntegrations } from "../lib/prepared-project-integrations";
import {
  createProjectConnectorBindingInput,
  projectConnectorBinding,
  projectConnectorOptions,
  updateProjectConnectorBindingInput,
  withProjectConnectorBinding
} from "../lib/project-integration-settings";
import { integrationProviderLabel } from "../lib/integration-presentation";
import { frequencyProviderUsageEstimate } from "../lib/provider-usage-estimate";
import {
  defaultSemanticRegion,
  readLastSemanticRegion,
  writeLastSemanticRegion
} from "../lib/semantic-region-preference";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";
import { SearchableRegionSelect } from "./searchable-region-select";
import { CustomDateRangePicker } from "./custom-date-range-picker";
import { CustomSelect } from "./custom-select";
import { SemanticModal } from "./semantic-modal";
import {
  SemanticOperationScope,
  type SemanticOperationGroup,
  type SemanticOperationSelection
} from "./semantic-operation-scope";
import { UiText, useUiLocale } from "./ui-locale";


export function SemanticFrequencyDialog({
  onClose,
  onStarted,
  projectId,
  activeGroupId,
  groups,
  initialSelections,
  initialConfiguration,
  mode: requestedMode = "FREQUENCY"
}: Readonly<{
  mode?: FrequencyCollectionMode;
  onClose: () => void;
  onStarted: (collection: FrequencyCollectionSummary) => void;
  projectId: string;
  activeGroupId?: string | undefined;
  groups: readonly SemanticOperationGroup[];
  initialSelections: readonly SemanticOperationSelection[];
  initialConfiguration?: Pick<FrequencyCollectionSummary, "mode" | "types" | "regionCode" | "device" | "provider" | "credentialMode" | "seasonality">;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const formId = useId();
  const operationAttempt = useRef<OperationAttempt | undefined>(undefined);
  const mode = initialConfiguration?.mode ?? requestedMode;
  const seasonalityMode = mode === "SEASONALITY";
  const [granularity, setGranularity] = useState<FrequencySeasonalityGranularity>(
    initialConfiguration?.seasonality?.granularity ?? "MONTH"
  );
  const [seasonalityRange, setSeasonalityRange] = useState(() =>
    initialConfiguration?.seasonality
      ? {
          from: initialConfiguration.seasonality.observedFrom,
          through: initialConfiguration.seasonality.observedThrough
        }
      : defaultSeasonalityRange("MONTH")
  );
  const [seasonalityDatePickerOpen, setSeasonalityDatePickerOpen] = useState(false);
  const [types, setTypes] = useState<ReadonlySet<SemanticFrequencyType>>(
    new Set(seasonalityMode ? ["BASE"] : initialConfiguration?.types ?? ["BASE", "EXACT", "FIXED"])
  );
  const [regionCode, setRegionCode] = useState(
    () => initialConfiguration?.regionCode ?? defaultSemanticRegion("WORDSTAT").code
  );
  const [device, setDevice] = useState<SemanticFrequencyDevice>(initialConfiguration?.device ?? "ALL");
  const [settings, setSettings] = useState<ProjectConnectorSettings>();
  const [credentialId, setCredentialId] = useState("");
  const [loadingSources, setLoadingSources] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<FrequencyDialogError>();
  const [scopeError, setScopeError] = useState<string>();
  const [resolvingScope, setResolvingScope] = useState(false);
  const [scopeCount, setScopeCount] = useState<number | undefined>(
    initialSelections.length
  );
  const [selections, setSelections] = useState<readonly SemanticOperationSelection[]>(
    initialSelections
  );
  const orderedTypes = useMemo(
    () => (["BASE", "EXACT", "FIXED"] as const).filter((type) =>
      types.has(type) && (!seasonalityMode || type === "BASE")
    ),
    [seasonalityMode, types]
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
  const seasonalityAvailableRange = useMemo(
    () => availableSeasonalityRange(granularity),
    [granularity]
  );
  const seasonalityPresets = useMemo(
    () => seasonalityPresetOptions(granularity, seasonalityAvailableRange),
    [granularity, seasonalityAvailableRange]
  );
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const providerUsage = frequencyProviderUsageEstimate(
    selectedSource,
    scopeCount ?? selections.length,
    orderedTypes.length, uiLocale
  );
  const seasonalityRangeReady = !seasonalityMode || validSeasonalityRange({
    granularity,
    observedFrom: seasonalityRange.from,
    observedThrough: seasonalityRange.through
  });
  const keywordLimit = frequencyCollectionKeywordLimit;
  const resolveScope = useCallback((
    next: readonly SemanticOperationSelection[],
    resolving: boolean,
    nextError?: string
  ) => {
    setSelections(next);
    if (!resolving && !nextError) setScopeCount(next.length);
    setResolvingScope(resolving);
    setScopeError(nextError);
  }, []);
  const resolveScopeCount = useCallback((count: number | undefined) => {
    setScopeCount(count);
  }, []);

  useEffect(() => {
    if (initialConfiguration) return;
    setRegionCode(
      readLastSemanticRegion(
        window.localStorage,
        projectId,
        "FREQUENCY",
        "WORDSTAT"
      ).code
    );
  }, [projectId, initialConfiguration]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingSources(true);
    void preparedProjectIntegrations(projectId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const binding = projectConnectorBinding(result, "WORDSTAT");
        const options = projectConnectorOptions(result, "WORDSTAT").filter(
          ({ status }) => status === "ACTIVE"
        );
        const selectedCredentialId =
          (initialConfiguration && options.find(option => option.provider === initialConfiguration.provider && (!initialConfiguration.credentialMode || option.mode === initialConfiguration.credentialMode)))?.id ?? (options.some(({ id }) => id === binding?.route?.credentialId)
            ? binding?.route?.credentialId ?? ""
            : options[0]?.id ?? "");
        setSettings(result);
        setCredentialId(selectedCredentialId);
        if (seasonalityMode) {
          setTypes(new Set(["BASE"]));
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(frequencyErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSources(false);
      });
    return () => controller.abort();
  }, [projectId, initialConfiguration, seasonalityMode]);

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
      const operationPath = `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections`;
      const body = {
            items: selections.map(({ id, version }) => ({ id, version })),
            mode,
            types: orderedTypes,
            regionCode,
            device,
            ...(seasonalityMode
              ? {
                  seasonality: {
                    granularity,
                    observedFrom: seasonalityRange.from,
                    observedThrough: seasonalityRange.through
                  }
                }
              : {})
          };
      operationAttempt.current = prepareOperationAttempt(
        operationAttempt.current,
        operationPath,
        body,
        selectedSource.id,
        seasonalityMode ? "semantic-seasonality" : "semantic-frequency"
      );
      const collection = await browserApiRequest<FrequencyCollectionSummary>(operationPath, {
        method: "POST", operationAttempt: operationAttempt.current, body
      });
      writeLastSemanticRegion(
        window.localStorage,
        projectId,
        "FREQUENCY",
        "WORDSTAT",
        regionCode
      );
      onStarted(collection);
    } catch (requestError) {
      if (requestError instanceof BrowserApiError && requestError.code === "OPERATION_CANCELLED") return;
      setError(frequencyErrorMessage(requestError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <SemanticModal
      footer={(
        <div className="semantic-workflow-footer">
          <dl className="semantic-dialog-estimate semantic-workflow-footer-estimate">
            <div><Icon name="semantic" /><div><dt><UiText text="К сбору" /></dt><dd>{scopeCount === undefined ? <UiText text="Считаем…" /> : <UiText text="{0} запросов" values={[String(scopeCount)]} />}</dd></div></div>
            <div>
              <Icon name="operations" />
              <div><dt><UiText text="Обращений" /></dt><dd>{selectedSource?.provider === "ARSENKIN" ? Math.ceil((scopeCount ?? selections.length) / arsenkinWordstatKeywordLimit) : <UiText text="до {0}" values={[String((scopeCount ?? selections.length) * orderedTypes.length)]} />}</dd></div>
            </div>
            <div><Icon name="frequency" /><div><dt><UiText text="Расход провайдера" /></dt><dd><UiText text={providerUsage.usage} /></dd></div></div>
            <div><Icon name="checkDouble" /><div><dt><UiText text="Доступно сейчас" /></dt><dd><UiText text={providerUsage.available} /></dd></div></div>
          </dl>
          <div className="semantic-modal-actions">
            <button className="secondary-button" disabled={running} onClick={onClose} type="button"><UiText text="Отмена" /></button>
            <button className="primary-button" disabled={loadingSources || resolvingScope || running || !selectedSource || selections.length === 0 || orderedTypes.length === 0 || !seasonalityRangeReady} form={formId} type="submit">
              {resolvingScope ? <UiText text="Загружаем запросы…" /> : running ? <UiText text="Запускаем…" /> : <UiText text="Запустить сбор ({0})" values={[String(selections.length)]} />}
            </button>
          </div>
        </div>
      )}
      onClose={running ? () => undefined : onClose}
      presenceKey={seasonalityMode ? "semantic-modal:seasonality" : "semantic-modal:frequency"}
      size="large"
      title={uiText(seasonalityMode ? "Сбор сезонности" : "Сбор частотности")}
      {...(initialConfiguration ? { description: uiText("Новый сбор только для запросов с ошибками. Параметры можно изменить; стоимость системного источника нужно подтвердить заново.") } : {})}
    >
      <form className="semantic-frequency-dialog semantic-workflow-dialog" id={formId} onSubmit={(event) => void submit(event)}>
        <div className="semantic-workflow-grid semantic-frequency-workflow-grid">
          <section className="semantic-workflow-panel semantic-source-panel">
            <header className="semantic-workflow-panel-heading">
              <h3><UiText text="Источник данных" /></h3>
              <a className="semantic-dialog-link" href="/app/settings/integrations"><UiText text="Управлять" /></a>
              <p><UiText text={seasonalityMode ? "Сезонность Wordstat собирается через XMLStock или Arsenkin и сохраняется для каждого запроса." : "Выберите подключение, через которое будет выполнен сбор."} /></p>
            </header>
            {loadingSources ? (
              <div className="semantic-dialog-loading" role="status"><UiText text="Загружаем подключения…" /></div>
            ) : sources.length ? (
              <div className="semantic-provider-list" role="radiogroup" aria-label={uiText("Источник Wordstat")}>
                {sources.map((source) => (
                  <button
                    aria-checked={source.id === credentialId}
                    className={`semantic-provider-card ${source.id === credentialId ? "selected" : ""}`}
                    key={source.id}
                    onClick={() => {
                      setCredentialId(source.id);
                      if (seasonalityMode) {
                        setTypes(new Set(["BASE"]));
                      }
                    }}
                    role="radio"
                    type="button"
                  >
                    <ProviderLogo provider={source.provider} />
                    <span className="semantic-provider-card-copy">
                      <strong>{<UiText text={integrationProviderLabel(source.provider) ?? ""} />}</strong>
                      <small>{source.label} · Wordstat API</small>
                      <b><UiText text="Подключено" /></b>
                    </span>
                    <i aria-hidden="true" className="semantic-provider-radio" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-alert warning"><UiText text="Нет проверенного подключения с функцией Wordstat." /></div>
            )}
          </section>
          <section className="semantic-workflow-panel semantic-settings-panel">
            <header>
              <h3><UiText text="Настройки сбора" /></h3>
              <p><UiText text={seasonalityMode ? "Укажите период, детализацию, регион, устройство и виды частотности." : "Укажите регион, устройство и виды частотности."} /></p>
            </header>
            <div className="semantic-frequency-settings">
              {!seasonalityMode && <fieldset className="semantic-check-list">
              <legend><UiText text="Виды частотности" /></legend>
              <label><input checked={types.has("BASE")} onChange={() => toggleType("BASE")} type="checkbox" /> <UiText text="Базовая" before=" " /></label>
              <label><input checked={types.has("EXACT")} onChange={() => toggleType("EXACT")} type="checkbox" /> <UiText text="Фразовая" before=" " /></label>
              <label><input checked={types.has("FIXED")} onChange={() => toggleType("FIXED")} type="checkbox" /> <UiText text="Точная словоформа" before=" " /></label>
              </fieldset>}
              {seasonalityMode && <div className="inline-alert info"><UiText text="XMLStock и Arsenkin возвращают одну базовую сезонную серию." /></div>}
              {seasonalityMode && (
                <div className="semantic-seasonality-range">
                  <label className="semantic-workflow-field">
                    <span><UiText text="Детализация" /></span>
                    <CustomSelect
                      onChange={(event) => {
                        const next = event.target.value as FrequencySeasonalityGranularity;
                        setGranularity(next);
                        setSeasonalityRange(defaultSeasonalityRange(next));
                        setSeasonalityDatePickerOpen(false);
                      }}
                      value={granularity}
                    >
                      <option value="MONTH"><UiText text="По месяцам" /></option>
                      <option value="WEEK"><UiText text="По неделям" /></option>
                      <option value="DAY"><UiText text="По дням" /></option>
                    </CustomSelect>
                  </label>
                  <div className="semantic-workflow-field semantic-seasonality-date-field">
                    <span><UiText text="Период" /></span>
                    <CustomDateRangePicker
                      active
                      availableRange={seasonalityAvailableRange}
                      dialogLabel="Выбрать период сезонности"
                      modal
                      onApply={({ from, to }) => setSeasonalityRange({ from, through: to })}
                      onOpenChange={setSeasonalityDatePickerOpen}
                      onReset={() => setSeasonalityRange(defaultSeasonalityRange(granularity))}
                      open={seasonalityDatePickerOpen}
                      periodLabel="Период сезонности"
                      rangeLabel="Доступный период:"
                      resetLabel="Вернуть рекомендуемый период"
                      triggerLabel="Период"
                      value={{ from: seasonalityRange.from, to: seasonalityRange.through }}
                    />
                  </div>
                  <div className="semantic-seasonality-presets" aria-label={uiText("Готовые периоды сезонности")}>
                    {seasonalityPresets.map((preset) => (
                      <button
                        aria-pressed={sameSeasonalityRange(seasonalityRange, preset.range)}
                        className={sameSeasonalityRange(seasonalityRange, preset.range) ? "selected" : undefined}
                        key={preset.label}
                        onClick={() => setSeasonalityRange({
                          from: preset.range.from,
                          through: preset.range.to
                        })}
                        type="button"
                      >
                        <UiText text={preset.label} />
                      </button>
                    ))}
                  </div>
                  <small><UiText text={seasonalityHint(granularity)} /></small>
                  {!seasonalityRangeReady && <small className="semantic-seasonality-invalid"><UiText text="Выберите полный допустимый период для этой детализации." /></small>}
                </div>
              )}
              <label className="semantic-workflow-field">
                <span><UiText text="Регион Wordstat" /></span>
                <SearchableRegionSelect
                  allowAll
                  autoFocus
                  kind="WORDSTAT"
                  onChange={({ code }) => setRegionCode(code)}
                  value={regionCode}
                />
                <small>
                  <UiText text="Первый запуск — Россия; затем используется регион последнего успешного запуска." /></small>
              </label>
              <fieldset className="semantic-segmented-field">
                <legend><UiText text="Устройство" /></legend>
                <div
                  aria-label={uiText("Устройство Wordstat")}
                  className="semantic-segmented-control semantic-frequency-device-control"
                  role="radiogroup"
                >
                  {([
                    ["ALL", "Все"],
                    ["DESKTOP", "Десктоп"],
                    ["MOBILE", "Мобильные"],
                    ["PHONE_ONLY", "Телефоны"],
                    ["TABLET_ONLY", "Планшеты"]
                  ] as const).map(([value, label]) => (
                    <label className={device === value ? "selected" : undefined} key={value}>
                      <input checked={device === value} onChange={() => setDevice(value)} type="radio" />
                      <span><UiText text={label} /></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>
          <section className="semantic-workflow-panel semantic-frequency-scope-panel">
            <header>
              <h3><UiText text="Охват сбора" /></h3>
              <p><UiText text="Выберите все запросы, конкретные запросы или папки." /></p>
            </header>
            <SemanticOperationScope
              activeGroupId={activeGroupId}
              groups={groups}
              initialSelections={initialSelections}
              maxItems={keywordLimit}
              onChange={resolveScope}
              onCountChange={resolveScopeCount}
              projectId={projectId}
            />
          </section>
        </div>
        {(error || scopeError) && <div className="semantic-workflow-feedback">
          {error && (
            <div className="inline-alert danger" role="alert">
              <span>{<UiText text={error.message ?? ""} />}</span>{" "}
              {error.showRoutingLink && (
                <a href={`/app/projects/${encodeURIComponent(projectId)}/settings/integrations`}><UiText text="Настроить маршрут Wordstat" /></a>
              )}
            </div>
          )}
          {scopeError && <div className="inline-alert warning" role="alert">{<UiText text={scopeError ?? ""} />}</div>}
        </div>}
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

interface FrequencyDialogError {
  readonly message: string;
  readonly showRoutingLink: boolean;
}

function frequencyErrorMessage(error: unknown): FrequencyDialogError {
  if (error instanceof BrowserApiError) {
    if (error.code === "CONNECTOR_NOT_READY") {
      return {
        message: "Подключите XMLStock или Arsenkin, подтвердите ключ и назначьте проекту маршрут Wordstat.",
        showRoutingLink: true
      };
    }
    if (error.code === "FORBIDDEN") {
      return { message: "Недостаточно прав для запуска сборщика.", showRoutingLink: false };
    }
    if (error.code === "PAYMENT_REQUIRED") {
      return { message: "Workspace доступен только для чтения.", showRoutingLink: false };
    }
    return { message: error.message, showRoutingLink: false };
  }
  return {
    message: error instanceof Error ? error.message : "Не удалось запустить сбор частотности.",
    showRoutingLink: false
  };
}

function defaultSeasonalityRange(
  granularity: FrequencySeasonalityGranularity
): Readonly<{ from: string; through: string }> {
  const now = new Date();
  const today = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  if (granularity === "DAY") {
    const through = addDays(today, -1);
    return { from: dateOnly(addDays(through, -29)), through: dateOnly(through) };
  }
  if (granularity === "WEEK") {
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    const through = addDays(today, -mondayOffset - 1);
    return { from: dateOnly(addDays(through, -83)), through: dateOnly(through) };
  }
  const through = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const from = new Date(Date.UTC(through.getUTCFullYear(), through.getUTCMonth() - 11, 1));
  return { from: dateOnly(from), through: dateOnly(through) };
}

function availableSeasonalityRange(
  granularity: FrequencySeasonalityGranularity
): Readonly<{ from: string; to: string }> {
  const now = new Date();
  const today = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  if (granularity === "DAY") {
    const to = addDays(today, -1);
    return { from: dateOnly(addDays(to, -59)), to: dateOnly(to) };
  }
  if (granularity === "WEEK") {
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    const to = addDays(today, -mondayOffset - 1);
    return { from: dateOnly(addDays(to, -727)), to: dateOnly(to) };
  }
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const from = new Date(Date.UTC(2018, 0, 1));
  return { from: dateOnly(from), to: dateOnly(to) };
}

function seasonalityPresetOptions(
  granularity: FrequencySeasonalityGranularity,
  available: Readonly<{ from: string; to: string }>
): readonly Readonly<{
  label: string;
  range: Readonly<{ from: string; to: string }>;
}>[] {
  const through = new Date(`${available.to}T00:00:00.000Z`);
  if (granularity === "DAY") {
    return [
      { label: "Весь период", range: available },
      { label: "7 дней", range: { from: dateOnly(addDays(through, -6)), to: available.to } },
      { label: "30 дней", range: { from: dateOnly(addDays(through, -29)), to: available.to } }
    ];
  }
  if (granularity === "WEEK") {
    return [
      { label: "Весь период", range: available },
      { label: "3 месяца", range: { from: dateOnly(addDays(through, -12 * 7 + 1)), to: available.to } },
      { label: "1 год", range: { from: dateOnly(addDays(through, -52 * 7 + 1)), to: available.to } }
    ];
  }
  return [
    { label: "Весь период", range: available },
    { label: "1 год", range: monthRangeEndingAt(through, 12) },
    { label: "2 года", range: monthRangeEndingAt(through, 24) }
  ];
}

function monthRangeEndingAt(
  through: Date,
  months: number
): Readonly<{ from: string; to: string }> {
  return {
    from: dateOnly(new Date(Date.UTC(
      through.getUTCFullYear(),
      through.getUTCMonth() - months + 1,
      1
    ))),
    to: dateOnly(through)
  };
}

function sameSeasonalityRange(
  current: Readonly<{ from: string; through: string }>,
  candidate: Readonly<{ from: string; to: string }>
): boolean {
  return current.from === candidate.from && current.through === candidate.to;
}

function seasonalityHint(granularity: FrequencySeasonalityGranularity): string {
  if (granularity === "DAY") {
    return "По дням можно собрать до 60 дней. Пустые периоды сохраняются как отсутствие данных провайдера.";
  }
  if (granularity === "WEEK") {
    return "Период начинается в понедельник и заканчивается в воскресенье; минимум три полные недели.";
  }
  return "Период начинается первого числа и заканчивается последним числом месяца; минимум три полных месяца.";
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function validSeasonalityRange(value: unknown): boolean {
  try {
    parseFrequencySeasonalityRequest(value);
    return true;
  } catch {
    return false;
  }
}
