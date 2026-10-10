"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  parseSemanticRankColumnKey,
  parseProjectOnboardingSettings,
  projectOnboardingDimensions,
  type CreateProjectInput,
  type ProjectCollectionCapabilities,
  type ProjectOnboardingEngine,
  type SemanticSavedViewColumnKey,
} from "@seo-platform/contracts";
import type { AppProject, AppWorkspace } from "../lib/app-types";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { projectCreationErrorMessage } from "../lib/project-creation-error";
import {
  newProjectOnboardingDraft,
  onboardingColumnSelection,
  projectOnboardingDraftKey,
  projectOnboardingFields,
  projectOnboardingSettings,
  readProjectOnboardingDraft,
  type ProjectOnboardingDraft,
} from "../lib/project-onboarding";
import { rankColumnLabel } from "../lib/rank-dimension-presentation";
import { SemanticModal } from "./semantic-modal";
import { SemanticRankTargets } from "./semantic-rank-targets";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticColumnHeader } from "./semantic-column-header";
import { ConfirmationActions } from "./confirmation-actions";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";

const columnNames: Readonly<Record<string, string>> = {
  query: "Запрос",
  frequency: "Частотность · базовая",
  frequencyExact: "Частотность · фразовая",
  frequencyFixed: "Частотность · точная",
  wordCount: "WS · количество слов",
  group: "Группа",
  tags: "Теги",
  source: "Источник",
  cluster: "Кластер",
  targetUrl: "Целевой URL",
  intent: "Интент",
  priority: "Приоритет",
  visibility: "Видимость",
  updatedAt: "Дата изменения",
};
const creationPrefix = "project-onboarding:";

export function ProjectCreationWizard({
  workspace,
  currentUserId,
  capabilities,
  onClose,
  onOpenProject,
}: Readonly<{
  workspace: AppWorkspace;
  currentUserId: string;
  capabilities?: ProjectCollectionCapabilities;
  onClose: (createdProjectId?: string) => void;
  onOpenProject: (projectId: string) => void;
}>) {
  const { t, locale } = useUiLocale();
  const storageKey = projectOnboardingDraftKey(currentUserId, workspace.id);
  const formId = useId();
  const [draft, setDraft] = useState<ProjectOnboardingDraft>(
    newProjectOnboardingDraft,
  );
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string>();
  const [storageError, setStorageError] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    ReturnType<typeof projectOnboardingFields>
  >({});
  const [confirmClose, setConfirmClose] = useState(false);
  const [created, setCreated] = useState<AppProject>();
  const [dragged, setDragged] = useState<SemanticSavedViewColumnKey>();
  const nameRef = useRef<HTMLInputElement>(null),
    domainRef = useRef<HTMLInputElement>(null);
  const request = useRef<ProjectOnboardingDraft["pending"]>(undefined);
  const step = draft.step ?? 1;
  const locked = busy || Boolean(draft.pending);
  const canCreate = capabilities?.creation.allowed === true;
  const dimensions = useMemo(
    () =>
      projectOnboardingDimensions({
        engines: draft.engines.filter(
          (engine) => engine.positions || engine.ai,
        ),
      }),
    [draft.engines],
  );
  const selection = useMemo(() => onboardingColumnSelection(draft), [draft]);
  const targetCount = draft.engines
    .filter((engine) => engine.positions || engine.ai)
    .reduce((total, engine) => total + engine.targets.length, 0);
  const aiEnabled = draft.engines.some((engine) => engine.ai);
  const restriction = !capabilities
    ? "Не удалось проверить доступность создания проекта. Обновите страницу."
    : capabilities.creation.reason === "LIMIT_REACHED"
      ? "Лимит проектов исчерпан: " +
        capabilities.creation.used +
        " из " +
        capabilities.creation.limit
      : capabilities.creation.reason === "WORKSPACE_READ_ONLY"
        ? "Рабочая область доступна только для чтения."
        : !canCreate
          ? "Недостаточно прав для создания проекта в этой рабочей области."
          : undefined;

  useEffect(() => {
    try {
      const saved = readProjectOnboardingDraft(
        window.localStorage,
        currentUserId,
        workspace.id,
      );
      if (saved) {
        setDraft(saved);
        request.current = saved.pending;
      }
    } catch {
      setStorageError(true);
    }
    setReady(true);
  }, [currentUserId, workspace.id]);
  useEffect(() => {
    if (!ready || created) return;
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(draft));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [created, draft, ready, storageKey]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  function changeEngine(
    searchEngine: ProjectOnboardingEngine["searchEngine"],
    patch: Partial<ProjectOnboardingEngine>,
  ) {
    if (locked) return;
    setDraft((current) => ({
      ...current,
      engines: current.engines.map((engine) =>
        engine.searchEngine === searchEngine ? { ...engine, ...patch } : engine,
      ),
    }));
    setError(undefined);
  }
  function close() {
    if (busy) return;
    if (created) {
      onClose(created.id);
      return;
    }
    if (!draft.name && !draft.domain && !draft.pending) {
      onClose();
      return;
    }
    setConfirmClose(true);
  }
  function saveAndClose() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
      onClose();
    } catch {
      setStorageError(true);
      setConfirmClose(false);
    }
  }
  function moveColumn(
    key: SemanticSavedViewColumnKey,
    target: SemanticSavedViewColumnKey,
  ) {
    if (locked || key === "query" || target === "query" || key === target)
      return;
    const next = selection.columnOrder.filter((value) => value !== key);
    next.splice(next.indexOf(target), 0, key);
    setDraft((current) => ({ ...current, columnOrder: next }));
  }
  function moveBy(key: SemanticSavedViewColumnKey, direction: -1 | 1) {
    if (locked) return;
    const order = [...selection.columnOrder],
      index = order.indexOf(key),
      next = index + direction;
    if (index > 0 && next > 0 && next < order.length) {
      [order[index], order[next]] = [order[next]!, order[index]!];
      setDraft((current) => ({ ...current, columnOrder: order }));
    }
  }
  function columnLabel(key: SemanticSavedViewColumnKey): string {
    return columnNames[key]
      ? t(columnNames[key])
      : (rankColumnLabel(key, dimensions, locale) ?? key);
  }
  function nextStep(next: 1 | 2 | 3) {
    if (busy || draft.pending) return;
    const issues = projectOnboardingFields(draft);
    setFieldErrors(issues);
    if (next > 1 && (issues.name || issues.domain)) {
      setDraft((current) => ({ ...current, step: 1 }));
      requestAnimationFrame(() =>
        issues.name ? nameRef.current?.focus() : domainRef.current?.focus(),
      );
      return;
    }
    if (duplicate && !draft.confirmDuplicateDomain) return;
    if (next === 3 && targetCount > 64) {
      setError(
        t(
          "Можно выбрать не более 64 сочетаний поисковика, города и устройства.",
        ),
      );
      return;
    }
    setError(undefined);
    setDraft((current) => ({ ...current, step: next }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (step < 3) {
      nextStep((step + 1) as 2 | 3);
      return;
    }
    if (!online || !canCreate) return;
    let command = request.current;
    if (!command) {
      let body: CreateProjectInput;
      try {
        body = {
          name: draft.name.trim(),
          domain: draft.domain.trim(),
          confirmDuplicateDomain: draft.confirmDuplicateDomain,
          onboarding: projectOnboardingSettings(draft),
        };
      } catch {
        setError(
          t(
            "Проверьте срезы и состав колонок. Максимум — 64 среза и 128 видимых колонок.",
          ),
        );
        return;
      }
      command = { key: creationPrefix + crypto.randomUUID(), body };
      request.current = command;
    }
    const frozen = { ...draft, step: 3 as const, pending: command };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(frozen));
    } catch {
      setStorageError(true);
    }
    setDraft(frozen);
    setBusy(true);
    setError(undefined);
    try {
      const project = await browserApiRequest<AppProject>(
        "/app/api/workspaces/" + encodeURIComponent(workspace.id) + "/projects",
        {
          method: "POST",
          idempotencyKey: command.key,
          body: command.body,
        },
      );
      if (
        !/^[0-9a-f-]{36}$/iu.test(project.id) ||
        project.workspaceId !== workspace.id ||
        !project.onboarding
      )
        throw new Error("Invalid project initialization response");
      setCreated({
        ...project,
        onboarding: parseProjectOnboardingSettings(project.onboarding),
      });
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        setStorageError(true);
      }
    } catch (failure) {
      const safelyEditable =
        failure instanceof BrowserApiError &&
        [
          "DUPLICATE",
          "VALIDATION_FAILED",
          "VALIDATION_ERROR",
          "INVALID_INPUT",
          "INVALID_ONBOARDING",
        ].includes(failure.code);
      if (safelyEditable) {
        request.current = undefined;
        const { pending: _pending, ...editable } = frozen;
        setDraft({ ...editable, step: 1 });
      }
      if (failure instanceof BrowserApiError && failure.code === "DUPLICATE") {
        setDuplicate(true);
        setError(
          t(
            "Такой домен уже используется. Подтвердите создание отдельного проекта.",
          ),
        );
      } else
        setError(
          draft.pending || !safelyEditable
            ? t(
                "Не удалось завершить настройку. Параметры сохранены: нажмите «Повторить», чтобы продолжить без второго проекта.",
              )
            : projectCreationErrorMessage(failure),
        );
    } finally {
      setBusy(false);
    }
  }
  function columnRow(key: SemanticSavedViewColumnKey) {
    const checked = selection.columns.includes(key),
      metric = parseSemanticRankColumnKey(key);
    const index = selection.columnOrder.indexOf(key);
    return (
      <div
        className={"project-setup-column" + (checked ? "" : " is-hidden")}
        key={key}
        draggable={key !== "query" && !locked}
        onDragStart={() => setDragged(key)}
        onDragEnd={() => setDragged(undefined)}
        onDragOver={(event) => {
          if (dragged && key !== "query") event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dragged) moveColumn(dragged, key);
          setDragged(undefined);
        }}
        onKeyDown={(event) => {
          if (
            event.altKey &&
            (event.key === "ArrowUp" || event.key === "ArrowDown")
          ) {
            event.preventDefault();
            moveBy(key, event.key === "ArrowUp" ? -1 : 1);
          }
        }}
      >
        <Icon name={key === "query" ? "positions" : "gripVertical"} />
        <label>
          <input
            type="checkbox"
            checked={checked}
            disabled={
              key === "query" ||
              locked ||
              (!checked && selection.columns.length >= 128)
            }
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                visibility: {
                  ...current.visibility,
                  [key]: event.target.checked,
                },
              }))
            }
          />
          {metric && (
            <span aria-hidden="true">
              <SearchEngineLogo
                engine={metric.dimension.searchEngine}
                size="compact"
              />
            </span>
          )}
          <span>
            {columnLabel(key)}
            {key === "query" && (
              <small>
                <UiText text="Закреплённая колонка" />
              </small>
            )}
          </span>
        </label>
        {key !== "query" && (
          <div className="project-setup-column-moves">
            <button
              type="button"
              aria-label={t("Выше: {0}", [columnLabel(key)])}
              disabled={locked || index <= 1}
              onClick={() => moveBy(key, -1)}
            >
              <Icon name="arrowUp" />
            </button>
            <button
              type="button"
              aria-label={t("Ниже: {0}", [columnLabel(key)])}
              disabled={locked || index === selection.columnOrder.length - 1}
              onClick={() => moveBy(key, 1)}
            >
              <Icon name="arrowDown" />
            </button>
          </div>
        )}
      </div>
    );
  }

  function isMainColumn(key: SemanticSavedViewColumnKey): boolean {
    if (
      ["query", "frequency", "frequencyExact", "frequencyFixed"].includes(
        key,
      ) ||
      selection.columns.includes(key)
    )
      return true;
    const metric = parseSemanticRankColumnKey(key)?.metric;
    return metric === "position" || metric === "aiPosition";
  }
  return (
    <>
      <SemanticModal
        title={created ? "Проект настроен" : "Новый проект"}
        description={
          created
            ? workspace.name
            : workspace.name + " · " + t("Шаг {0} из 3", [String(step)])
        }
        className="project-creation-wizard"
        closeDisabled={busy}
        onClose={close}
        footer={
          created ? (
            <>
              <button
                className="primary-button"
                onClick={() => onOpenProject(created.id)}
                type="button"
              >
                <UiText text="Открыть семантику" />
              </button>
            </>
          ) : (
            <>
              {step === 2 && !locked && (
                <span className="project-setup-footer-note">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        step: 3,
                        engines: current.engines.map((engine) => ({
                          ...engine,
                          positions: false,
                          ai: false,
                        })),
                      }))
                    }
                  >
                    <UiText text="Настроить съём позже" />
                  </button>
                </span>
              )}
              <div className="project-setup-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    step > 1 && !draft.pending
                      ? nextStep((step - 1) as 1 | 2)
                      : close()
                  }
                  type="button"
                >
                  <UiText
                    text={step > 1 && !draft.pending ? "Назад" : "Отмена"}
                  />
                </button>
                <button
                  className="primary-button"
                  form={formId}
                  disabled={
                    !ready ||
                    busy ||
                    !canCreate ||
                    (step === 3 &&
                      (!online || selection.columns.length > 128)) ||
                    (duplicate && !draft.confirmDuplicateDomain)
                  }
                  type="submit"
                >
                  <UiText
                    text={
                      busy
                        ? "Создаём…"
                        : draft.pending
                          ? "Повторить"
                          : step === 3
                            ? "Создать проект"
                            : "Продолжить"
                    }
                  />
                </button>
              </div>
            </>
          )
        }
      >
        {created ? (
          <div className="project-setup-success">
            <Icon name="check" />
            <h3>{created.name}</h3>
            <p>{created.domain}</p>
          </div>
        ) : (
          <>
            <nav
              className="project-setup-steps"
              aria-label={t("Шаги создания проекта")}
            >
              {(["Проект", "Поиск и ИИ", "Колонки"] as const).map(
                (label, index) => (
                  <button
                    type="button"
                    key={label}
                    aria-current={step === index + 1 ? "step" : undefined}
                    disabled={locked || !ready}
                    onClick={() => nextStep((index + 1) as 1 | 2 | 3)}
                  >
                    <span>{index + 1}</span>
                    <UiText text={label} />
                  </button>
                ),
              )}
            </nav>
            <form
              id={formId}
              className="project-setup-body"
              onSubmit={(event) => void submit(event)}
            >
              {restriction && (
                <div className="inline-alert warning" role="alert">
                  <UiText text={restriction} />
                </div>
              )}
              {storageError && (
                <div className="inline-alert warning" role="status">
                  <UiText text="Не удалось сохранить черновик в браузере. Не закрывайте окно до завершения создания." />
                </div>
              )}
              {!online && (
                <div className="inline-alert warning" role="status">
                  <UiText text="Нет соединения. Настройки доступны, создание продолжится после восстановления сети." />
                </div>
              )}
              {error && (
                <div className="inline-alert danger" role="alert">
                  <UiText text={error} />
                </div>
              )}
              {step === 1 && (
                <>
                  <div className="project-setup-step-heading">
                    <h3>
                      <UiText text="Начнём с сайта" />
                    </h3>
                  </div>
                  <div className="project-setup-fields">
                    <label className="form-field">
                      <span>
                        <UiText text="Название проекта" />
                      </span>
                      <input
                        ref={nameRef}
                        autoFocus
                        maxLength={160}
                        aria-invalid={Boolean(fieldErrors.name)}
                        disabled={locked || !canCreate}
                        value={draft.name}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                      />
                      {fieldErrors.name && (
                        <small className="field-error">
                          <UiText text={fieldErrors.name} />
                        </small>
                      )}
                    </label>
                    <label className="form-field">
                      <span>
                        <UiText text="Домен" />
                      </span>
                      <input
                        ref={domainRef}
                        autoCapitalize="none"
                        autoCorrect="off"
                        maxLength={255}
                        aria-invalid={Boolean(fieldErrors.domain)}
                        disabled={locked || !canCreate}
                        value={draft.domain}
                        placeholder="example.ru"
                        onChange={(event) => {
                          setDraft((current) => ({
                            ...current,
                            domain: event.target.value,
                            confirmDuplicateDomain: false,
                          }));
                          setDuplicate(false);
                          setError(undefined);
                        }}
                      />
                      <small>
                        <UiText
                          text={
                            fieldErrors.domain ?? "Без протокола, пути и порта"
                          }
                        />
                      </small>
                    </label>
                  </div>
                  {duplicate && (
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={draft.confirmDuplicateDomain}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            confirmDuplicateDomain: event.target.checked,
                          }))
                        }
                      />
                      <span>
                        <UiText text="Создать отдельный проект с тем же доменом" />
                      </span>
                    </label>
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <div className="project-setup-step-heading">
                    <h3>
                      <UiText text="Где будете отслеживать сайт?" />
                    </h3>
                  </div>
                  {draft.engines.map((engine) => (
                    <section
                      className="project-setup-engine"
                      key={engine.searchEngine}
                      data-expanded={engine.positions || engine.ai}
                    >
                      <header>
                        <label>
                          <input
                            type="checkbox"
                            checked={engine.positions}
                            disabled={locked}
                            aria-label={t("Снимать позиции: {0}", [
                              engine.searchEngine === "YANDEX"
                                ? "Яндекс"
                                : "Google",
                            ])}
                            onChange={(event) =>
                              changeEngine(engine.searchEngine, {
                                positions: event.target.checked,
                              })
                            }
                          />
                          <span aria-hidden="true">
                            <SearchEngineLogo engine={engine.searchEngine} />
                          </span>
                          <strong>
                            {engine.searchEngine === "YANDEX"
                              ? t("Яндекс")
                              : "Google"}
                          </strong>
                        </label>
                        <small>
                          {engine.positions || engine.ai
                            ? (engine.ai && !engine.positions
                                ? t("Только ИИ") + " · "
                                : "") +
                              engine.targets.length +
                              " " +
                              t("срезов")
                            : t("Не отслеживаем")}
                        </small>
                      </header>
                      {(engine.positions || engine.ai) && (
                        <div className="project-setup-engine-body">
                          {engine.positions && (
                            <label className="project-setup-depth">
                              <span>
                                <UiText text="Глубина съёма" />
                              </span>
                              <CustomSelect
                                aria-label={t("Глубина: {0}", [
                                  engine.searchEngine === "YANDEX"
                                    ? "Яндекс"
                                    : "Google",
                                ])}
                                value={engine.depth}
                                disabled={locked}
                                onChange={(event) =>
                                  changeEngine(engine.searchEngine, {
                                    depth: Number(
                                      event.target.value,
                                    ) as ProjectOnboardingEngine["depth"],
                                  })
                                }
                              >
                                {[10, 30, 50, 100].map((depth) => (
                                  <option key={depth} value={depth}>
                                    Топ-{depth}
                                  </option>
                                ))}
                              </CustomSelect>
                            </label>
                          )}
                          <SemanticRankTargets
                            engine={engine.searchEngine}
                            targets={engine.targets}
                            disabled={locked}
                            onChange={(targets) =>
                              changeEngine(engine.searchEngine, { targets })
                            }
                          />
                        </div>
                      )}
                    </section>
                  ))}
                  {targetCount === 0 && (
                    <div className="inline-alert" role="status">
                      <UiText text="Пока только семантика. Съём можно настроить позже." />
                    </div>
                  )}
                  <section className="project-setup-ai">
                    <div>
                      <Icon name="ai" />
                      <h3>
                        <UiText text="Отслеживать сайт в ИИ-ответах" />
                      </h3>
                      <label className="project-setup-switch">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={t("Отслеживать сайт в ИИ-ответах")}
                          checked={aiEnabled}
                          disabled={locked}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              engines: current.engines.map((engine, index) => ({
                                ...engine,
                                ai:
                                  event.target.checked &&
                                  (engine.positions ||
                                    (index === 0 &&
                                      !current.engines.some(
                                        (value) => value.positions,
                                      ))),
                              })),
                            }))
                          }
                        />
                      </label>
                    </div>
                    {aiEnabled && (
                      <>
                        <div className="project-setup-ai-engines">
                          {draft.engines.map((engine) => (
                            <label key={engine.searchEngine}>
                              <input
                                type="checkbox"
                                aria-label={t("ИИ-ответы: {0}", [
                                  engine.searchEngine === "YANDEX"
                                    ? "Яндекс"
                                    : "Google",
                                ])}
                                checked={engine.ai}
                                disabled={locked}
                                onChange={(event) =>
                                  changeEngine(engine.searchEngine, {
                                    ai: event.target.checked,
                                  })
                                }
                              />
                              <span aria-hidden="true">
                                <SearchEngineLogo
                                  engine={engine.searchEngine}
                                  size="compact"
                                />
                              </span>
                              {engine.searchEngine === "YANDEX"
                                ? t("Яндекс")
                                : "Google"}
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </section>
                </>
              )}
              {step === 3 && (
                <>
                  <div className="project-setup-step-heading">
                    <h3>
                      <UiText text="Какие колонки нужны в семантике?" />
                    </h3>
                  </div>
                  <div className="project-setup-column-caption">
                    <span>
                      {selection.columns.length}{" "}
                      <UiText text="видимых колонок из 128" />
                    </span>
                    <span>
                      <UiText text="Перетаскивание или стрелки" />
                    </span>
                  </div>
                  {selection.columns.length > 128 && (
                    <div className="inline-alert warning" role="alert">
                      <UiText text="Отключите часть колонок: максимум 128 видимых." />
                    </div>
                  )}
                  <div className="project-setup-column-list">
                    {selection.columnOrder.filter(isMainColumn).map(columnRow)}
                  </div>
                  <details className="project-setup-extra">
                    <summary>
                      <Icon name="settings" />
                      <span>
                        <UiText text="URL, даты и другие колонки" />
                      </span>
                      <Icon name="chevronDown" />
                    </summary>
                    <div className="project-setup-extra-switches">
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.urls}
                          disabled={locked}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              urls: event.target.checked,
                            }))
                          }
                        />
                        <UiText text="Найденный URL по каждому срезу" />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.dates}
                          disabled={locked}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              dates: event.target.checked,
                            }))
                          }
                        />
                        <UiText text="Дата съёма по каждому срезу" />
                      </label>
                    </div>
                    <div className="project-setup-column-list">
                      {selection.columnOrder
                        .filter((key) => !isMainColumn(key))
                        .map(columnRow)}
                    </div>
                  </details>
                  <details className="project-setup-preview">
                    <summary>
                      <Icon name="list" />
                      <span>
                        <UiText text="Предпросмотр таблицы" />
                      </span>
                      <Icon name="chevronDown" />
                    </summary>
                    <div
                      className="project-setup-preview-scroll"
                      role="region"
                      aria-label={t("Предпросмотр таблицы")}
                      tabIndex={0}
                    >
                      <table>
                        <thead>
                          <tr>
                            {selection.columns.map((key) => (
                              <th key={key} data-column-key={key}>
                                <SemanticColumnHeader
                                  column={key}
                                  rankDimensions={dimensions}
                                />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            {selection.columns.map((key) => (
                              <td key={key}>
                                {key === "query" ? t("Пример запроса") : "—"}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </form>
          </>
        )}
      </SemanticModal>
      {confirmClose && (
        <SemanticModal
          size="small"
          title="Закрыть настройку?"
          onClose={() => setConfirmClose(false)}
          footer={
            <ConfirmationActions>
              <button
                className="secondary-button"
                type="button"
                onClick={saveAndClose}
              >
                <UiText text="Сохранить и закрыть" />
              </button>
              <button
                className="primary-button"
                autoFocus
                type="button"
                onClick={() => setConfirmClose(false)}
              >
                <UiText text="Продолжить настройку" />
              </button>
            </ConfirmationActions>
          }
        >
          <p>
            <UiText text="Сохранить черновик?" />
          </p>
        </SemanticModal>
      )}
    </>
  );
}
