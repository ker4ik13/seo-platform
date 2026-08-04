"use client";

import type {
  BillingBalanceSummary,
  BillingPlanSummary,
  BillingSubscriptionSummary,
  IntegrationCredentialSummary,
  MfaOverview,
  NotificationPreferencesSummary,
  WorkspaceInviteSummary,
  WorkspaceMemberSummary
} from "@seo-platform/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  canViewWorkspaceBilling,
  canViewWorkspaceIntegrations,
  canViewWorkspaceTeam
} from "../lib/app-permissions";
import type { ProtectedAppContext } from "../lib/app-types";
import {
  browserApiCollectionRequest,
  browserApiRequest
} from "../lib/browser-api";
import { workspaceTeamListPath } from "../lib/team-management";
import { Icon, type IconName } from "./icon";
import { ProviderLogo } from "./provider-logo";

interface OverviewLiveData {
  readonly balance?: BillingBalanceSummary;
  readonly credentials?: readonly IntegrationCredentialSummary[];
  readonly invites?: readonly WorkspaceInviteSummary[];
  readonly members?: readonly WorkspaceMemberSummary[];
  readonly membersTruncated?: boolean;
  readonly mfa?: MfaOverview;
  readonly notifications?: NotificationPreferencesSummary;
  readonly plans?: readonly BillingPlanSummary[];
  readonly invitesTruncated?: boolean;
  readonly subscription?: BillingSubscriptionSummary | null;
  readonly partialErrors: readonly string[];
}

const ACTIVE_CREDENTIAL_STATUSES = new Set(["ACTIVE"]);
const ATTENTION_CREDENTIAL_STATUSES = new Set([
  "DEGRADED",
  "RATE_LIMITED",
  "LOW_BALANCE",
  "EXPIRED",
  "INVALID"
]);

export function SettingsOverview({
  context
}: Readonly<{ context: ProtectedAppContext }>) {
  const workspace = context.workspace;
  const workspaceId = workspace?.id;
  const project = context.project;
  const [live, setLive] = useState<OverviewLiveData>({ partialErrors: [] });
  const [loading, setLoading] = useState(true);
  const canViewBilling = canViewWorkspaceBilling(workspace?.roleCode);
  const canViewIntegrations = canViewWorkspaceIntegrations(
    workspace?.roleCode
  );
  const canViewTeam = canViewWorkspaceTeam(workspace?.roleCode);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);

    void loadOverviewData({
      signal: controller.signal,
      ...(workspaceId ? { workspaceId } : {}),
      canViewBilling,
      canViewIntegrations,
      canViewTeam
    }).then((result) => {
      if (!active) return;
      setLive(result);
      setLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [canViewBilling, canViewIntegrations, canViewTeam, workspaceId]);

  const currentPlan = useMemo(
    () =>
      live.subscription
        ? live.plans?.find(
            ({ code, version }) =>
              code === live.subscription?.planCode &&
              version === live.subscription.planVersion
          )
        : undefined,
    [live.plans, live.subscription]
  );
  const activeProjects = context.projects.filter(
    ({ status }) => status === "ACTIVE"
  ).length;
  const activeCredentials =
    live.credentials?.filter(({ status }) =>
      ACTIVE_CREDENTIAL_STATUSES.has(status)
    ).length ?? 0;
  const attentionCredentials =
    live.credentials?.filter(({ status }) =>
      ATTENTION_CREDENTIAL_STATUSES.has(status)
    ).length ?? 0;

  return (
    <div className="settings-overview settings-overview-dashboard">
      <SettingsContextNavigation context={context} />

      {live.partialErrors.length > 0 && !loading && (
        <div className="settings-overview-degraded" role="status">
          <Icon name="warning" />
          <div>
            <strong>Часть показателей временно недоступна</strong>
            <span>
              Доступные данные показаны без подстановки демонстрационных
              значений. Откройте нужный раздел, чтобы повторить загрузку.
            </span>
          </div>
        </div>
      )}

      <section className="settings-overview-health-grid" aria-label="Состояние настроек">
        <OverviewHealthCard
          action="Проверить безопасность"
          href="/app/settings/security"
          icon="settings"
          title="Безопасность"
          tone={live.mfa?.totp && context.user.emailVerified ? "success" : "warning"}
        >
          <div className="settings-security-score">
            <span className="settings-health-orb"><Icon name="settings" /></span>
            <div>
              <strong>
                {loading
                  ? "Проверяем защиту…"
                  : live.mfa?.totp && context.user.emailVerified
                    ? "Хорошая защита"
                    : "Требует внимания"}
              </strong>
              <small>
                {live.mfa?.totp
                  ? `2FA включена · ${live.mfa.remainingRecoveryCodes} резервных кодов`
                  : "Включите двухфакторную аутентификацию"}
              </small>
            </div>
          </div>
          <OverviewFact
            label="Email"
            value={context.user.emailVerified ? "Подтверждён" : "Не подтверждён"}
          />
        </OverviewHealthCard>

        {canViewBilling && workspace ? (
          <OverviewHealthCard
            action="Управлять тарифом"
            href="/app/settings/billing"
            icon="tasks"
            title="Тариф и использование"
            tone={live.balance && live.balance.availableMinor > 0 ? "success" : "warning"}
          >
            <div className="settings-plan-summary">
              <span className="settings-plan-mark">
                {live.subscription?.planName?.slice(0, 2) ?? "—"}
              </span>
              <div>
                <small>Текущий тариф</small>
                <strong>{loading ? "Загрузка…" : live.subscription?.planName ?? "Нет подписки"}</strong>
              </div>
            </div>
            <OverviewFact
              label="Доступно кредитов"
              value={live.balance ? money(live.balance.availableMinor) : "—"}
            />
            <OverviewLimit
              label="Проекты"
              {...(currentPlan ? { limit: currentPlan.features.projects } : {})}
              value={activeProjects}
            />
          </OverviewHealthCard>
        ) : (
          <OverviewHealthCard
            action="Открыть рабочую область"
            href="/app/settings/workspace"
            icon="dashboard"
            title="Рабочая область"
          >
            <OverviewFact label="Статус" value={workspace ? workspaceStatusLabel(workspace.status) : "Не создана"} />
            <OverviewFact label="Роль" value={roleLabel(workspace?.roleCode)} />
            <OverviewFact label="Проекты" value={String(activeProjects)} />
          </OverviewHealthCard>
        )}

        <OverviewHealthCard
          action="Участники и права"
          href="/app/settings/team"
          icon="competitors"
          title="Команда"
        >
          <div className="settings-team-counts">
            <div><strong>{loading || !canViewTeam ? "—" : boundedCount(live.members?.length ?? 0, live.membersTruncated)}</strong><small>Участников</small></div>
            <div><strong>{loading || !canViewTeam ? "—" : boundedCount(live.invites?.length ?? 0, live.invitesTruncated)}</strong><small>Приглашений</small></div>
          </div>
          <OverviewFact label="Ваша роль" value={roleLabel(workspace?.roleCode)} />
          {!canViewTeam && <small className="settings-card-note">Счётчики скрыты вашими правами</small>}
        </OverviewHealthCard>

        <OverviewHealthCard
          action="Управление интеграциями"
          href="/app/settings/integrations"
          icon="tools"
          title="Интеграции"
          tone={attentionCredentials > 0 ? "warning" : activeCredentials > 0 ? "success" : "neutral"}
        >
          {canViewIntegrations ? (
            <>
              <div className="settings-integration-summary">
                {(live.credentials ?? []).slice(0, 3).map((credential) => (
                  <div key={credential.id}>
                    <ProviderLogo provider={credential.provider} />
                    <span>
                      <strong>{credential.label}</strong>
                      <small>
                        {credentialStatusLabel(credential.status)} · {credentialQuotaCompact(credential)}
                      </small>
                    </span>
                    <b className={ATTENTION_CREDENTIAL_STATUSES.has(credential.status) ? "warning" : "success"} />
                  </div>
                ))}
                {!loading && (live.credentials?.length ?? 0) === 0 && (
                  <p className="settings-card-empty">Подключений пока нет</p>
                )}
              </div>
              <OverviewFact label="Активны" value={String(activeCredentials)} />
              <OverviewFact label="Требуют внимания" value={String(attentionCredentials)} />
            </>
          ) : (
            <p className="settings-card-empty">Доступ к подключениям ограничен вашей ролью.</p>
          )}
        </OverviewHealthCard>

        <OverviewHealthCard
          action="Настроить уведомления"
          href="/app/settings/notifications"
          icon="bell"
          title="Уведомления"
          tone={live.notifications?.channels.inApp ? "success" : "warning"}
        >
          <OverviewChannel label="Внутри приложения" value={live.notifications?.channels.inApp} />
          <OverviewChannel label="По электронной почте" value={live.notifications?.channels.email} />
          <OverviewChannel label="В браузере" value={live.notifications?.channels.webPush} />
          <OverviewFact
            label="Тихие часы"
            value={live.notifications?.quietHours
              ? `${live.notifications.quietHours.start}–${live.notifications.quietHours.end}`
              : "Не настроены"}
          />
        </OverviewHealthCard>

        <OverviewHealthCard
          action="Настройки проекта"
          href={project ? `/app/projects/${encodeURIComponent(project.id)}/settings/general` : "/app/settings/projects"}
          icon="projects"
          title={project ? `Текущий проект — ${project.name}` : "Текущий проект"}
        >
          {project ? (
            <>
              <OverviewFact label="Домен" value={project.domain} />
              <OverviewFact label="Часовой пояс" value={project.timezone} />
              <OverviewFact label="Статус" value={projectStatusLabel(project.status)} />
            </>
          ) : (
            <p className="settings-card-empty">Выберите или создайте проект.</p>
          )}
        </OverviewHealthCard>
      </section>

      <section className="settings-attention-panel">
        <header>
          <h2>Требует внимания</h2>
          <span>{attentionCount(context, live)}</span>
        </header>
        <div>
          {!context.user.emailVerified && (
            <SettingsAttentionRow
              description="Без подтверждения email недоступно восстановление части настроек безопасности."
              href="/app/settings/security"
              label="Email не подтверждён"
            />
          )}
          {attentionCredentials > 0 && (
            <SettingsAttentionRow
              description={`${attentionCredentials} подключений имеют ошибку, ограничение или низкий баланс.`}
              href="/app/settings/integrations"
              label="Проверьте подключения API"
            />
          )}
          {live.balance && live.balance.availableMinor <= 0 && (
            <SettingsAttentionRow
              description="Платные системные задания будут заблокированы до пополнения или обновления тарифа."
              href="/app/settings/billing"
              label="Кредиты закончились"
            />
          )}
          {attentionCount(context, live) === 0 && (
            <p className="settings-card-empty">Критичных действий сейчас нет.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function SettingsContextNavigation({ context }: Readonly<{ context: ProtectedAppContext }>) {
  const projectId = context.project?.id;
  return (
    <section className="settings-context-navigation" aria-label="Контексты настроек">
      <SettingsContextGroup title="Мой аккаунт" links={[
        ["Профиль", "/app/settings/security", "settings"],
        ["Безопасность", "/app/settings/security", "settings"],
        ["Уведомления", "/app/settings/notifications", "bell"]
      ]} />
      <SettingsContextGroup title="Рабочая область" links={[
        ["Основные настройки", "/app/settings/workspace", "dashboard"],
        ["Участники", "/app/settings/team", "competitors"],
        ["Роли и права", "/app/settings/roles", "settings"],
        ["Биллинг", "/app/settings/billing", "tasks"]
      ]} />
      <SettingsContextGroup title="Текущий проект" links={[
        ["Общие настройки", projectId ? `/app/projects/${encodeURIComponent(projectId)}/settings/general` : "/app/settings/projects", "projects"],
        ["Интеграции", projectId ? `/app/projects/${encodeURIComponent(projectId)}/settings/integrations` : "/app/settings/integrations", "tools"],
        ["Уведомления", projectId ? `/app/projects/${encodeURIComponent(projectId)}/settings/notifications` : "/app/settings/notifications", "bell"]
      ]} />
    </section>
  );
}

function SettingsContextGroup({ title, links }: Readonly<{
  title: string;
  links: readonly (readonly [string, string, IconName])[];
}>) {
  return (
    <div>
      <small>{title}</small>
      <nav>
        {links.map(([label, href, icon]) => (
          <a href={href} key={`${title}-${label}`}><Icon name={icon} /><span>{label}</span></a>
        ))}
      </nav>
    </div>
  );
}

function OverviewHealthCard({ action, children, href, icon, title, tone = "neutral" }: Readonly<{
  action: string;
  children: ReactNode;
  href: string;
  icon: IconName;
  title: string;
  tone?: "neutral" | "success" | "warning";
}>) {
  return (
    <article className={`settings-health-card ${tone}`}>
      <header><span><Icon name={icon} /></span><h2>{title}</h2><a aria-label={`Открыть: ${title}`} href={href}>›</a></header>
      <div className="settings-health-card-body">{children}</div>
      <a className="settings-card-action" href={href}>{action}</a>
    </article>
  );
}

function OverviewFact({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div className="settings-overview-fact"><span>{label}</span><strong>{value}</strong></div>;
}

function OverviewChannel({ label, value }: Readonly<{ label: string; value: boolean | undefined }>) {
  return <OverviewFact label={label} value={value === undefined ? "—" : value ? "Включено" : "Выключено"} />;
}

function OverviewLimit({ label, limit, value }: Readonly<{ label: string; limit?: number; value: number }>) {
  const ratio = limit && limit > 0 ? Math.min(100, Math.round(value / limit * 100)) : 0;
  return (
    <div className="settings-overview-limit">
      <OverviewFact label={label} value={limit === undefined ? `${value} · лимит не загружен` : `${value} / ${limit}`} />
      <div aria-label={`${ratio}% лимита`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio}><i style={{ width: `${ratio}%` }} /></div>
    </div>
  );
}

function SettingsAttentionRow({ description, href, label }: Readonly<{ description: string; href: string; label: string }>) {
  return <a className="settings-attention-row" href={href}><Icon name="warning" /><span><strong>{label}</strong><small>{description}</small></span><b>Перейти</b><i>›</i></a>;
}

async function loadOverviewData(input: Readonly<{
  signal: AbortSignal;
  workspaceId?: string;
  canViewBilling: boolean;
  canViewIntegrations: boolean;
  canViewTeam: boolean;
}>): Promise<OverviewLiveData> {
  const errors: string[] = [];
  const result: {
    balance?: BillingBalanceSummary;
    credentials?: readonly IntegrationCredentialSummary[];
    invites?: readonly WorkspaceInviteSummary[];
    members?: readonly WorkspaceMemberSummary[];
    membersTruncated?: boolean;
    mfa?: MfaOverview;
    notifications?: NotificationPreferencesSummary;
    plans?: readonly BillingPlanSummary[];
    invitesTruncated?: boolean;
    subscription?: BillingSubscriptionSummary | null;
  } = {};

  const requests: Promise<void>[] = [
    browserApiRequest<MfaOverview>("/app/api/auth/mfa", { signal: input.signal })
      .then((value) => { result.mfa = value; })
      .catch(() => { errors.push("security"); }),
    browserApiRequest<NotificationPreferencesSummary>("/app/api/me/notification-preferences", { signal: input.signal })
      .then((value) => { result.notifications = value; })
      .catch(() => { errors.push("notifications"); })
  ];

  if (input.workspaceId && input.canViewBilling) {
    const billingPath = `/app/api/workspaces/${encodeURIComponent(input.workspaceId)}/billing`;
    requests.push(
      Promise.all([
        browserApiCollectionRequest<BillingPlanSummary>("/app/api/billing/plans", { signal: input.signal }),
        browserApiRequest<BillingSubscriptionSummary | null>(`${billingPath}/subscription`, { signal: input.signal }),
        browserApiRequest<BillingBalanceSummary>(`${billingPath}/balance`, { signal: input.signal })
      ]).then(([plans, subscription, balance]) => {
        result.plans = plans.data;
        result.subscription = subscription;
        result.balance = balance;
      }).catch(() => { errors.push("billing"); })
    );
  }
  if (input.workspaceId && input.canViewIntegrations) {
    requests.push(
      browserApiCollectionRequest<IntegrationCredentialSummary>(
        `/app/api/workspaces/${encodeURIComponent(input.workspaceId)}/integrations/credentials`,
        { signal: input.signal }
      ).then((value) => { result.credentials = value.data; })
        .catch(() => { errors.push("integrations"); })
    );
  }
  if (input.workspaceId && input.canViewTeam) {
    requests.push(
      Promise.all([
        browserApiCollectionRequest<WorkspaceMemberSummary>(workspaceTeamListPath(input.workspaceId, "members"), { signal: input.signal }),
        browserApiCollectionRequest<WorkspaceInviteSummary>(workspaceTeamListPath(input.workspaceId, "invites"), { signal: input.signal })
      ]).then(([members, invites]) => {
        result.members = members.data;
        result.membersTruncated = members.page.hasNext;
        result.invites = invites.data;
        result.invitesTruncated = invites.page.hasNext;
      }).catch(() => { errors.push("team"); })
    );
  }
  await Promise.all(requests);
  return { ...result, partialErrors: errors };
}

function attentionCount(context: ProtectedAppContext, live: OverviewLiveData): number {
  return Number(!context.user.emailVerified) +
    (live.credentials?.filter(({ status }) => ATTENTION_CREDENTIAL_STATUSES.has(status)).length ?? 0) +
    Number(Boolean(live.balance && live.balance.availableMinor <= 0));
}

function credentialStatusLabel(status: IntegrationCredentialSummary["status"]): string {
  const labels: Readonly<Record<IntegrationCredentialSummary["status"], string>> = {
    PENDING_VERIFICATION: "Проверяется",
    ACTIVE: "Активно",
    DEGRADED: "С ошибками",
    RATE_LIMITED: "Rate limit",
    LOW_BALANCE: "Низкий баланс",
    EXPIRED: "Истёк ключ",
    REVOKED: "Отозвано",
    INVALID: "Неверный ключ",
    DISABLED: "Отключено"
  };
  return labels[status];
}

function credentialQuotaCompact(
  credential: IntegrationCredentialSummary
): string {
  if (credential.quota.status === "NOT_AVAILABLE") {
    return credential.verifiedAt ? "квота не раскрыта" : "нужна проверка";
  }
  if (credential.quota.unit === "XMLSTOCK_REQUESTS") {
    const balance = credential.quota.balance;
    return balance
      ? `${new Intl.NumberFormat("ru-RU", {
          style: "currency",
          currency: balance.currency,
          maximumFractionDigits: 2
        }).format(Number(balance.amount))} · ${number(credential.quota.remaining)} запросов`
      : `${number(credential.quota.remaining)} запросов`;
  }
  return credential.quota.unit === "ARSENKIN_LIMITS"
    ? `${number(credential.quota.remaining)} лимитов`
    : `${number(credential.quota.remaining)} API-запросов`;
}

function roleLabel(roleCode: string | undefined): string {
  const labels: Readonly<Record<string, string>> = {
    OWNER: "Владелец", ADMIN: "Администратор", SEO_LEAD: "SEO Lead",
    SEO_SPECIALIST: "SEO-специалист", ANALYST: "Аналитик",
    CONTENT_EDITOR: "Контент-редактор", CLIENT: "Клиент", VIEWER: "Наблюдатель"
  };
  return roleCode ? labels[roleCode] ?? roleCode : "Нет роли";
}

function workspaceStatusLabel(status: "ACTIVE" | "READ_ONLY" | "SUSPENDED"): string {
  if (status === "ACTIVE") return "Активна";
  if (status === "READ_ONLY") return "Только чтение";
  return "Приостановлена";
}

function projectStatusLabel(status: "DRAFT" | "ACTIVE" | "ARCHIVED"): string {
  if (status === "ACTIVE") return "Активен";
  if (status === "ARCHIVED") return "В архиве";
  return "Черновик";
}

function money(minor: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(minor / 100);
}

function number(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function boundedCount(value: number, truncated: boolean | undefined): string {
  return `${value}${truncated ? "+" : ""}`;
}
