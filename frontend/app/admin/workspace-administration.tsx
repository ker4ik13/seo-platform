"use client";

import { CustomDateInput } from "../../components/custom-date-input";
import { CustomSelect } from "../../components/custom-select";
import { AdminDirectorySortControl } from "../../components/admin-directory-sort";
import { AdminStateAction } from "../../components/admin-state-action";
import { useAdminDirectorySort } from "../../lib/use-admin-directory-sort";
import { useAdminAutoRefresh } from "../../lib/use-admin-auto-refresh";

import { isPermanentFreeSubscription } from "../../lib/billing-subscription-period";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import type {
  AdminBillingPlanSummary,
  AdminWorkspaceSearchResult,
  AdminWorkspaceSubscriptionGrantSummary,
  AdminWorkspaceSummary
} from "@seo-platform/contracts";
import {
  adminApi,
  adminApiCollection
} from "../../lib/admin-browser-api";
import { UiText, useUiLocale } from "../../components/ui-locale";


interface StableAttempt {
  readonly fingerprint: string;
  readonly key: string;
}

export function WorkspaceAdministration({
  canControl = false,
  canManageBilling
}: Readonly<{ canManageBilling: boolean; canControl?: boolean }>) {
  const { sort, changeSort } = useAdminDirectorySort("workspace");
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [result, setResult] = useState<AdminWorkspaceSearchResult>();
  const [plans, setPlans] = useState<readonly AdminBillingPlanSummary[]>([]);
  const [selected, setSelected] = useState<AdminWorkspaceSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const latestRequest = useRef<AbortController | null>(null);

  const loadWorkspaces = useCallback(async (search: string, silent = false) => {
    latestRequest.current?.abort();
    const controller = new AbortController();
    latestRequest.current = controller;
    if (!silent) setLoading(true);
    setError(undefined);
    const response = await adminApi<AdminWorkspaceSearchResult>(
      `/api/workspaces?q=${encodeURIComponent(search.trim())}&sort=${sort}`,
      { signal: controller.signal }
    );
    if (controller.signal.aborted) return;
    setLoading(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResult(response.data);
    setSelected((current) =>
      current
        ? response.data.data.find((workspace) => workspace.id === current.id) ??
          current
        : undefined
    );
  }, [sort]);

  const loadPlans = useCallback(async () => {
    if (!canManageBilling) return;
    const response = await adminApiCollection<AdminBillingPlanSummary>(
      "/api/billing/plans"
    );
    if (response.ok) setPlans(response.data);
    else setError(response.message);
  }, [canManageBilling]);

  useEffect(() => {
    void loadWorkspaces(appliedQuery);
  }, [appliedQuery, loadWorkspaces]);
  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);
  useAdminAutoRefresh(() => loadWorkspaces(appliedQuery, true));
  useEffect(() => () => latestRequest.current?.abort(), []);

  const metrics = useMemo(() => {
    const workspaces = result?.data ?? [];
    return {
      workspaces: workspaces.length,
      activeSubscriptions: workspaces.filter(
        (workspace) => workspace.subscription?.status === "ACTIVE"
      ).length,
      withoutSubscription: workspaces.filter(
        (workspace) => !workspace.subscription
      ).length,
      projects: workspaces.reduce(
        (total, workspace) => total + workspace.projectCount,
        0
      )
    };
  }, [result]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(undefined);
    if (query.trim() === appliedQuery) void loadWorkspaces(appliedQuery);
    else setAppliedQuery(query.trim());
  }

  return (
    <div className="content workspace-admin">
      <form className="workspace-search" onSubmit={search}>
        <label>
          <span className="sr-only"><UiText text="Поиск рабочей области" /></span>
          <input
            maxLength={160}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={uiText("Название, slug, UUID, имя или email владельца")}
            value={query}
          />
        </label>
        <AdminDirectorySortControl value={sort} onChange={changeSort} />
        <button className="primary" disabled={loading} type="submit">
          {loading ? <UiText text="Ищем…" /> : <UiText text="Найти" />}
        </button>
      </form>
      {error && <div className="form-alert workspace-message" role="alert">{<UiText text={error ?? ""} />}</div>}
      {notice && <div className="form-success workspace-message" role="status">{<UiText text={notice ?? ""} />}</div>}
      <section className="metric-grid workspace-metrics">
        <WorkspaceMetric label={uiText("В выборке")} value={metrics.workspaces} />
        <WorkspaceMetric
          label={uiText("Активные подписки")}
          value={metrics.activeSubscriptions}
        />
        <WorkspaceMetric
          label={uiText("Без подписки")}
          value={metrics.withoutSubscription}
        />
        <WorkspaceMetric label={uiText("Проектов")} value={metrics.projects} />
      </section>
      <section className="panel workspace-panel">
        {result?.truncated && (
          <div className="workspace-hint">
            <UiText text="Найдено больше 50 записей. Уточните поисковый запрос." /></div>
        )}
        {loading ? (
          <div className="empty"><UiText text="Загружаем рабочие области…" /></div>
        ) : !result || result.data.length === 0 ? (
          <div className="empty">
            <strong><UiText text="Ничего не найдено" /></strong>
            <span><UiText text="Проверьте название, UUID или email владельца." /></span>
          </div>
        ) : (
          <div className="workspace-table">
            <div className="workspace-row workspace-head" aria-hidden="true">
              <span><UiText text="Рабочая область" /></span>
              <span><UiText text="Владелец" /></span>
              <span><UiText text="Использование" /></span>
              <span><UiText text="Подписка" /></span>
              <span />
            </div>
            {result.data.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                onOpen={() => setSelected(workspace)}
                workspace={workspace}
              />
            ))}
          </div>
        )}
      </section>
      {selected && (
        <WorkspaceDrawer
          canControl={canControl}
          onControlUpdated={() => void loadWorkspaces(query)}
          canManageBilling={canManageBilling}
          onClose={() => setSelected(undefined)}
          onUpdated={(grant) => {
            setNotice(
              `${grant.planName} выдан рабочей области до ${formatDate(grant.currentPeriodEnd, uiLocale)}.`
            );
            setSelected(undefined);
            void loadWorkspaces(appliedQuery);
          }}
          plans={plans}
          workspace={selected}
        />
      )}
    </div>
  );
}

function WorkspaceRow({
  onOpen,
  workspace
}: Readonly<{
  onOpen: () => void;
  workspace: AdminWorkspaceSummary;
}>) {
  const uiLocale = useUiLocale().locale;
  return (
    <article className="workspace-row">
      <div className="workspace-primary">
        <span className="workspace-avatar">{initials(workspace.name)}</span>
        <div>
          <strong>{workspace.name}</strong>
          <small>{workspace.slug} · {shortId(workspace.id)}</small>
          <WorkspaceStatus status={workspace.status} />
        </div>
      </div>
      <div className="workspace-owner" data-label="Владелец">
        <strong>{workspace.owner.displayName}</strong>
        <small>
          {workspace.owner.email || workspace.owner.userId} · {ownerStatus(workspace.owner.status)}
        </small>
      </div>
      <div className="workspace-counts" data-label="Использование">
        <span><strong>{workspace.projectCount}</strong><small><UiText text="проектов" /></small></span>
        <span><strong>{workspace.memberCount}</strong><small><UiText text="участников" /></small></span>
      </div>
      <div className="workspace-subscription" data-label="Подписка">
        {workspace.subscription ? (
          <>
            <strong>{workspace.subscription.planName}</strong>
            <small>
              {<UiText text={subscriptionStatus(workspace.subscription.status) ?? ""} />} · {isPermanentFreeSubscription(workspace.subscription) ? <UiText text="без ограничения срока" /> : <UiText text="до {0}" values={[String(formatDate(workspace.subscription.currentPeriodEnd, uiLocale))]} />}
            </small>
          </>
        ) : (
          <><strong><UiText text="Не оформлена" /></strong><small><UiText text="Нет активной записи" /></small></>
        )}
      </div>
      <button className="ghost workspace-open" onClick={onOpen} type="button">
        <UiText text="Открыть" /></button>
    </article>
  );
}

function WorkspaceDrawer({
  canControl,
  onControlUpdated,
  canManageBilling,
  onClose,
  onUpdated,
  plans,
  workspace
}: Readonly<{
  canManageBilling: boolean;
  canControl: boolean;
  onControlUpdated: () => void;
  onClose: () => void;
  onUpdated: (grant: AdminWorkspaceSubscriptionGrantSummary) => void;
  plans: readonly AdminBillingPlanSummary[];
  workspace: AdminWorkspaceSummary;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const defaultPlan = useMemo(
    () =>
      plans.find(
        (plan) =>
          plan.code === workspace.subscription?.planCode &&
          plan.version === workspace.subscription.planVersion
      ) ??
      plans.find((plan) => plan.code === "AGENCY") ??
      plans[0],
    [plans, workspace.subscription]
  );
  const [planKey, setPlanKey] = useState("");
  const [periodEnd, setPeriodEnd] = useState(() =>
    dateTimeLocal(addYears(new Date(), 1))
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const attempt = useRef<StableAttempt | undefined>(undefined);

  useEffect(() => {
    if (defaultPlan && !planKey) setPlanKey(planValue(defaultPlan));
  }, [defaultPlan, planKey]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const chosenPlan = plans.find((plan) => planValue(plan) === planKey);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosenPlan || !confirmed) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsedEnd = new Date(periodEnd);
    if (Number.isNaN(parsedEnd.getTime())) {
      setError("Укажите корректную дату окончания подписки.");
      return;
    }
    const body = {
      planCode: chosenPlan.code,
      planVersion: chosenPlan.version,
      currentPeriodEnd: parsedEnd.toISOString(),
      confirmWorkspaceId: workspace.id,
      confirmed: true as const,
      reason: String(data.get("reason") ?? "").trim()
    };
    const precondition = workspace.subscription
      ? `v${workspace.subscription.version}`
      : "*";
    const fingerprint = JSON.stringify({ body, precondition });
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = {
        fingerprint,
        key: `admin-subscription:${workspace.id}:${crypto.randomUUID()}`
      };
    }
    setBusy(true);
    setError(undefined);
    const response = await adminApi<AdminWorkspaceSubscriptionGrantSummary>(
      `/api/workspaces/${workspace.id}/subscription-grants`,
      {
        method: "POST",
        headers: workspace.subscription
          ? {
              "Idempotency-Key": attempt.current.key,
              "If-Match": precondition
            }
          : {
              "Idempotency-Key": attempt.current.key,
              "If-None-Match": precondition
            },
        body: JSON.stringify(body)
      }
    );
    setBusy(false);
    if (response.ok) {
      attempt.current = undefined;
      onUpdated(response.data);
      return;
    }
    if (response.status === 409 && response.code === "VERSION_CONFLICT") {
      setError(
        "Подписка уже изменилась в другом запросе. Закройте карточку, обновите поиск и повторите действие."
      );
      return;
    }
    setError(response.message);
  }

  return (
    <div className="drawer-backdrop" onMouseDown={busy ? undefined : onClose}>
      <aside
        aria-label={uiText("Рабочая область {0}", [String(workspace.name)])}
        aria-modal="true"
        className="drawer workspace-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div><p><UiText text="Рабочая область" /></p><h2>{workspace.name}</h2></div>
          <button aria-label={uiText("Закрыть")} disabled={busy} onClick={onClose} type="button">×</button>
        </header>
        <div className="snapshot">
          <Snapshot label="Workspace ID" value={workspace.id} />
          <Snapshot label={uiText("Статус")} value={workspaceStatus(workspace.status)} />
          <Snapshot label={uiText("Владелец")} value={workspace.owner.displayName} />
          <Snapshot label="Email" value={workspace.owner.email || "Нет данных"} />
          <Snapshot label={uiText("Статус владельца")} value={ownerStatus(workspace.owner.status)} />
          <Snapshot label={uiText("Проекты")} value={String(workspace.projectCount)} />
          <Snapshot label={uiText("Участники")} value={String(workspace.memberCount)} />
          <Snapshot
            label={uiText("Текущий тариф")}
            value={workspace.subscription?.planName ?? "Не оформлен"}
          />
          <Snapshot
            label={uiText("Текущий срок")}
            value={workspace.subscription
              ? isPermanentFreeSubscription(workspace.subscription)
                ? "без ограничения срока"
                : `до ${formatDate(workspace.subscription.currentPeriodEnd, uiLocale)}`
              : "—"}
          />
        </div>
        {canControl && <section className="admin-control-panel"><h3>Управление доступом</h3><p>Изменения требуют подтверждения и записываются в аудит.</p><div className="admin-control-actions">
          <AdminStateAction kind="WORKSPACE" id={workspace.id} name={workspace.name} version={workspace.version} status={workspace.status} onUpdated={onControlUpdated} />
          <AdminStateAction kind="USER" id={workspace.owner.userId} name={workspace.owner.displayName} status={workspace.owner.status} {...(workspace.owner.version ? { version: workspace.owner.version } : {})} onUpdated={onControlUpdated} />
        </div></section>}
        {!canManageBilling ? (
          <div className="empty workspace-readonly">
            <strong><UiText text="Режим просмотра" /></strong>
            <span><UiText text="Для изменения подписки нужна роль FINANCE или SUPER_ADMIN." /></span>
          </div>
        ) : plans.length === 0 ? (
          <div className="empty workspace-readonly">
            <strong><UiText text="Каталог тарифов недоступен" /></strong>
            <span><UiText text="Повторно откройте раздел или проверьте Platform API." /></span>
          </div>
        ) : (
          <form className="operation-form" onSubmit={submit}>
            <div>
              <h3><UiText text="Ручная подписка" /></h3>
              <p className="form-description">
                <UiText text="Новый период начнётся сейчас. Платёжная привязка и автоплатёж будут сброшены, денежная операция не создаётся." /></p>
            </div>
            {error && <div className="form-alert" role="alert">{<UiText text={error ?? ""} />}</div>}
            <label>
              <span><UiText text="Тариф и версия" /></span>
              <CustomSelect
                onChange={(event) => setPlanKey(event.target.value)}
                required
                value={planKey}
              >
                {plans.map((plan) => (
                  <option key={planValue(plan)} value={planValue(plan)}>
                    {plan.name} · {plan.code} v{plan.version}
                  </option>
                ))}
              </CustomSelect>
            </label>
            {chosenPlan && (
              <div className="plan-preview">
                <strong>{chosenPlan.name}</strong>
                <span>
                  {chosenPlan.features.projects} <UiText text="проектов ·" before=" " after=" " />{chosenPlan.features.seats} <UiText text="участников ·" before=" " after=" " />{chosenPlan.features.concurrentJobs} <UiText text="параллельных операций" before=" " /></span>
              </div>
            )}
            <label>
              <span><UiText text="Действует до" /></span>
              <CustomDateInput
                max={dateTimeLocal(addYears(new Date(), 5))}
                min={dateTimeLocal(addMinutes(new Date(), 1))}
                onChange={(event) => setPeriodEnd(event.target.value)}
                required
                type="datetime-local"
                value={periodEnd}
              />
            </label>
            <div className="period-presets" aria-label={uiText("Быстрый выбор срока")}>
              <button onClick={() => setPeriodEnd(dateTimeLocal(addMonths(new Date(), 1)))} type="button"><UiText text="1 месяц" /></button>
              <button onClick={() => setPeriodEnd(dateTimeLocal(addYears(new Date(), 1)))} type="button"><UiText text="1 год" /></button>
              <button onClick={() => setPeriodEnd(dateTimeLocal(addYears(new Date(), 5)))} type="button"><UiText text="5 лет" /></button>
            </div>
            <label>
              <span><UiText text="Причина / комментарий аудита" /></span>
              <textarea
                maxLength={500}
                minLength={8}
                name="reason"
                placeholder={uiText("Например: партнёрская подписка по договорённости")}
                required
                rows={3}
              />
            </label>
            <label className="check confirmation-check">
              <input
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                <UiText text="Подтверждаю изменение подписки именно для" after=" " /><strong>{workspace.name}</strong> ({workspace.id})
              </span>
            </label>
            <button className="primary" disabled={busy || !confirmed || !chosenPlan} type="submit">
              {busy ? <UiText text="Применяем…" /> : <UiText text="Выдать подписку" />}
            </button>
          </form>
        )}
      </aside>
    </div>
  );
}

function WorkspaceMetric({
  label,
  value
}: Readonly<{ label: string; value: number }>) {
  return <article><span>{label}</span><strong>{value}</strong><small><UiText text="Текущая выборка" /></small></article>;
}

function WorkspaceStatus({ status }: Readonly<{ status: string }>) {
  return (
    <b className={`status status-${status.toLowerCase().replaceAll("_", "-")}`}>
      {workspaceStatus(status)}
    </b>
  );
}

function Snapshot({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function workspaceStatus(value: string): string {
  return ({
    ACTIVE: "Активна",
    READ_ONLY: "Только чтение",
    SUSPENDED: "Приостановлена",
    DELETING: "Удаляется",
    DELETED: "Удалена"
  } as Record<string, string>)[value] ?? value;
}

function subscriptionStatus(value: string): string {
  return ({
    TRIALING: "Пробный период",
    ACTIVE: "Активна",
    PAST_DUE: "Просрочена",
    GRACE: "Льготный период",
    PAUSED: "Приостановлена",
    CANCELLING: "Отменяется",
    CANCELLED: "Отменена",
    SUSPENDED: "Заблокирована"
  } as Record<string, string>)[value] ?? value;
}

function ownerStatus(value: string): string {
  return ({
    PENDING_VERIFICATION: "Email не подтверждён",
    ACTIVE: "Активен",
    SUSPENDED: "Приостановлен",
    DELETED: "Удалён"
  } as Record<string, string>)[value] ?? value;
}

function initials(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("") || "WS";
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function formatDate(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(uiLocale, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}

function planValue(plan: AdminBillingPlanSummary): string {
  return `${plan.code}:${plan.version}`;
}

function addMinutes(value: Date, minutes: number): Date {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

function addMonths(value: Date, months: number): Date {
  const date = new Date(value);
  date.setMonth(date.getMonth() + months);
  return date;
}

function addYears(value: Date, years: number): Date {
  const date = new Date(value);
  date.setFullYear(date.getFullYear() + years);
  return date;
}

function dateTimeLocal(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
