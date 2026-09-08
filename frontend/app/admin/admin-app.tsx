"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import type {
  AdminNpdReceiptDetail,
  AdminNpdReceiptListPage,
  AdminNpdReceiptSummary,
  LoginResult,
  PlatformAdminProfile,
  PlatformRoleCode,
  PlatformStaffRoleAssignmentSummary
} from "@seo-platform/contracts";
import {
  adminApi,
  adminApiCollection
} from "../../lib/admin-browser-api";
import { OperationAdministration } from "./operation-administration";
import { ProjectAdministration } from "./project-administration";
import { WorkspaceAdministration } from "./workspace-administration";
import { RefundAdministration } from "./refund-administration";
import { ProviderAdministration } from "./provider-administration";
import { Overview } from "./overview";
import { UsageReview } from "./usage-review";
import { UiText, useUiLocale } from "../../components/ui-locale";


type Screen = "overview" | "workspaces" | "projects" | "operations" | "receipts" | "staff" | "refunds" | "providers" | "usage";

export function AdminApp() {
  const { t: uiText } = useUiLocale();
  const [profile, setProfile] = useState<PlatformAdminProfile>();
  const [authState, setAuthState] = useState<
    "loading" | "login" | "mfa" | "forbidden" | "ready"
  >("loading");
  const [challengeToken, setChallengeToken] = useState("");
  const [screen, setScreen] = useState<Screen>("overview");
  const [error, setError] = useState<string>();

  const loadProfile = useCallback(async () => {
    setError(undefined);
    const response = await adminApi<PlatformAdminProfile>("/api/me");
    if (response.ok) {
      setProfile(response.data);
      if (
        !response.data.roles.some((role) =>
          ["SUPER_ADMIN", "FINANCE", "SUPPORT", "OPERATIONS"].includes(role)
        )
      ) {
        setScreen("staff");
      }
      setAuthState("ready");
      return;
    }
    if (response.status === 401) {
      setAuthState("login");
      return;
    }
    if (response.status === 403) {
      setAuthState("forbidden");
      setError(adminAccessMessage(response.message));
      return;
    }
    setAuthState("login");
    setError(response.message);
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  if (authState === "loading") return <StatePage text="Проверяем защищённую сессию…" />;
  if (authState === "login") {
    return (
      <Login
        {...(error ? { error } : {})}
        onMfa={(token) => {
          setChallengeToken(token);
          setAuthState("mfa");
        }}
        onReady={() => void loadProfile()}
      />
    );
  }
  if (authState === "mfa") {
    return (
      <Mfa
        challengeToken={challengeToken}
        onBack={() => setAuthState("login")}
        onReady={() => void loadProfile()}
      />
    );
  }
  if (authState === "forbidden") {
    return (
      <StatePage
        action={
          <button
            className="primary"
            onClick={() => void logout("/admin")}
            type="button"
          >
            <UiText text="Войти заново" /></button>
        }
        text={
          error ??
          "Нужны активная platform role, подтверждённый email и вход с MFA."
        }
        title={uiText("Доступ в operations закрыт")}
      />
    );
  }
  if (!profile) return <StatePage text="Профиль администратора недоступен." />;

  const canManageStaff = profile.roles.includes("SUPER_ADMIN");
  const canViewWorkspaces = profile.roles.some((role) =>
    ["SUPER_ADMIN", "FINANCE", "SUPPORT", "OPERATIONS"].includes(role)
  );
  const canViewPlatformDirectory = profile.roles.some((role) =>
    ["SUPER_ADMIN", "SUPPORT", "OPERATIONS"].includes(role)
  );
  const canManageBilling = profile.roles.some((role) =>
    ["SUPER_ADMIN", "FINANCE"].includes(role)
  );
  const canViewReceipts = canManageBilling;
  const canViewRefunds = canManageBilling || profile.roles.includes("SUPPORT");
  const canViewProviders = canManageBilling || profile.roles.includes("OPERATIONS");
  const hasVisibleScreen =
    canViewWorkspaces || canViewPlatformDirectory || canViewReceipts || canManageStaff;
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <img alt="" aria-hidden="true" height={31} src="/brand/seonorita-mark.svg" width={31} />
          <div><strong><UiText text="SEOньорита" /></strong><small>Operations</small></div>
        </a>
        <nav aria-label={uiText("Разделы администрирования")}>
          {canViewWorkspaces && <button className={screen === "overview" ? "active" : undefined} onClick={() => setScreen("overview")} type="button"><i>00</i> <UiText text="Обзор" before=" " /></button>}
          {canViewWorkspaces && (
            <button
              className={screen === "workspaces" ? "active" : undefined}
              onClick={() => setScreen("workspaces")}
              type="button"
            >
              <i>01</i> <UiText text="Рабочие области" before=" " /></button>
          )}
          {canViewPlatformDirectory && (
            <button
              className={screen === "projects" ? "active" : undefined}
              onClick={() => setScreen("projects")}
              type="button"
            >
              <i>02</i> <UiText text="Проекты" before=" " /></button>
          )}
          {canViewPlatformDirectory && (
            <button
              className={screen === "operations" ? "active" : undefined}
              onClick={() => setScreen("operations")}
              type="button"
            >
              <i>03</i> <UiText text="Операции" before=" " /></button>
          )}
          {canViewReceipts && (
            <button
              className={screen === "receipts" ? "active" : undefined}
              onClick={() => setScreen("receipts")}
              type="button"
            >
              <i>04</i> <UiText text="Чеки НПД" before=" " /></button>
          )}
          {canViewRefunds && <button className={screen === "refunds" ? "active" : undefined} onClick={() => setScreen("refunds")} type="button"><i>05</i> <UiText text="Возвраты" before=" " /></button>}
          {canManageStaff && (
            <button
              className={screen === "staff" ? "active" : undefined}
              onClick={() => setScreen("staff")}
              type="button"
            >
              <i>05</i> Platform roles
            </button>
          )}
          {canManageBilling && <button className={screen === "usage" ? "active" : undefined} onClick={() => setScreen("usage")} type="button"><i>07</i> <UiText text="Расходы на проверке" /></button>}
          {canViewProviders && <button className={screen === "providers" ? "active" : undefined} onClick={() => setScreen("providers")} type="button"><i>06</i> <UiText text="Провайдеры" before=" " /></button>}
        </nav>
        <div className="operator">
          <span>{initials(profile.displayName)}</span>
          <div>
            <strong>{profile.displayName}</strong>
            <small>{profile.roles.join(", ")}</small>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <img alt="" aria-hidden="true" className="mobile-mark" height={28} src="/brand/seonorita-mark.svg" width={28} />
            <strong>Operations</strong>
            {hasVisibleScreen && (
              <select
                aria-label={uiText("Раздел администрирования")}
                className="mobile-navigation"
                onChange={(event) => setScreen(event.target.value as Screen)}
                value={screen}
              >
                {canViewWorkspaces && <option value="overview"><UiText text="Обзор" /></option>}
                {canViewWorkspaces && <option value="workspaces"><UiText text="Рабочие области" /></option>}
                {canViewPlatformDirectory && <option value="projects"><UiText text="Проекты" /></option>}
                {canViewPlatformDirectory && <option value="operations"><UiText text="Операции" /></option>}
                {canViewReceipts && <option value="receipts"><UiText text="Чеки НПД" /></option>}
                {canViewRefunds && <option value="refunds"><UiText text="Возвраты" /></option>}
                {canManageStaff && <option value="staff">Platform roles</option>}
                {canManageBilling && <option value="usage"><UiText text="Расходы на проверке" /></option>}
                {canViewProviders && <option value="providers"><UiText text="Провайдеры" /></option>}
              </select>
            )}
          </div>
          <div className="topbar-actions">
            <span className="system-state"><i /> MFA · recent auth</span>
            <button className="ghost" onClick={() => void logout()} type="button">
              <UiText text="Выйти" /></button>
          </div>
        </header>
        {!hasVisibleScreen ? (
          <StatePage
            text="Для этого аккаунта пока нет доступных operations-разделов. Нужна подходящая platform role."
            title={uiText("Нет доступных разделов")}
          />
        ) : screen === "overview" && canViewWorkspaces ? (
          <Overview onNavigate={setScreen} />
        ) : screen === "usage" && canManageBilling ? (
          <UsageReview />
        ) : screen === "workspaces" && canViewWorkspaces ? (
          <WorkspaceAdministration canManageBilling={canManageBilling} />
        ) : screen === "projects" && canViewPlatformDirectory ? (
          <ProjectAdministration />
        ) : screen === "operations" && canViewPlatformDirectory ? (
          <OperationAdministration />
        ) : screen === "receipts" && canViewReceipts ? (
          <Receipts />
        ) : screen === "staff" && canManageStaff ? (
          <StaffRoles />
        ) : screen === "refunds" && canViewRefunds ? (
          <RefundAdministration canDecide={canManageBilling} />
        ) : screen === "providers" && canViewProviders ? (
          <ProviderAdministration />
        ) : canViewWorkspaces ? (
          <WorkspaceAdministration canManageBilling={canManageBilling} />
        ) : (
          <Receipts />
        )}
      </main>
    </div>
  );
}

function Login({
  error,
  onMfa,
  onReady
}: Readonly<{
  error?: string;
  onMfa: (token: string) => void;
  onReady: () => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const data = new FormData(event.currentTarget);
    const response = await adminApi<LoginResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(data.get("email") ?? "").trim(),
        password: String(data.get("password") ?? "")
      })
    });
    setBusy(false);
    if (!response.ok) {
      setMessage(response.message);
      return;
    }
    if ("mfaRequired" in response.data) {
      onMfa(response.data.challengeToken);
      return;
    }
    setMessage(
      "Для operations-панели у аккаунта должен быть включён MFA."
    );
    onReady();
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo">SW</div>
        <p className="eyebrow"><UiText text="Внутренняя панель" /></p>
        <h1><UiText text="Вход в Operations" /></h1>
        <p><UiText text="Доступ только для platform staff. Второй фактор обязателен." /></p>
        <form onSubmit={submit}>
          {message && <div className="form-alert" role="alert">{<UiText text={message ?? ""} />}</div>}
          <label><span>Email</span><input autoComplete="username" name="email" required type="email" /></label>
          <label><span><UiText text="Пароль" /></span><input autoComplete="current-password" name="password" required type="password" /></label>
          <button className="primary" disabled={busy} type="submit">
            {busy ? <UiText text="Проверяем…" /> : <UiText text="Продолжить" />}
          </button>
        </form>
      </section>
    </main>
  );
}

function Mfa({
  challengeToken,
  onBack,
  onReady
}: Readonly<{
  challengeToken: string;
  onBack: () => void;
  onReady: () => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const response = await adminApi("/api/auth/mfa/challenge/verify", {
      method: "POST",
      body: JSON.stringify({
        challengeToken,
        code: String(data.get("code") ?? "").trim()
      })
    });
    setBusy(false);
    if (!response.ok) {
      setMessage(response.message);
      return;
    }
    onReady();
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo">2FA</div>
        <p className="eyebrow">Step-up authentication</p>
        <h1><UiText text="Подтвердите второй фактор" /></h1>
        <p><UiText text="Введите TOTP-код или одноразовый recovery code." /></p>
        <form onSubmit={submit}>
          {message && <div className="form-alert" role="alert">{<UiText text={message ?? ""} />}</div>}
          <label><span><UiText text="Код" /></span><input autoComplete="one-time-code" inputMode="numeric" name="code" required /></label>
          <button className="primary" disabled={busy} type="submit">
            {busy ? <UiText text="Проверяем…" /> : <UiText text="Войти" />}
          </button>
          <button className="link-button" onClick={onBack} type="button"><UiText text="Назад" /></button>
        </form>
      </section>
    </main>
  );
}

function Receipts() {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [page, setPage] = useState<AdminNpdReceiptListPage>();
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<AdminNpdReceiptDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    const response = await adminApi<AdminNpdReceiptListPage>(
      `/api/billing/npd-receipts${query}`
    );
    setLoading(false);
    if (response.ok) setPage(response.data);
    else setError(response.message);
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const receipts = page?.data ?? [];
    return {
      waiting: receipts.filter((item) =>
        ["AWAITING_MANUAL_REGISTRATION", "PENDING"].includes(item.status)
      ).length,
      delivery: receipts.filter((item) => item.status === "DELIVERY_PENDING")
        .length,
      refund: receipts.filter((item) =>
        ["CANCELLATION_PENDING", "REPLACEMENT_REQUIRED"].includes(item.status)
      ).length,
      overdue: receipts.filter(
        (item) =>
          item.ageSeconds > 3_600 &&
          !["DELIVERED", "CANCELLED"].includes(item.status)
      ).length
    };
  }, [page]);

  async function open(receipt: AdminNpdReceiptSummary) {
    setError(undefined);
    const response = await adminApi<AdminNpdReceiptDetail>(
      `/api/billing/npd-receipts/${receipt.id}`
    );
    if (response.ok) setSelected(response.data);
    else setError(response.message);
  }

  return (
    <div className="content">
      <section className="heading">
        <div><p>Billing operations</p><h1><UiText text="Чеки НПД" /></h1></div>
        <a className="external" href="https://lknpd.nalog.ru/" rel="noreferrer" target="_blank">
          <UiText text="Открыть «Мой налог» ↗" /></a>
      </section>
      <aside className="warning">
        <strong><UiText text="Ручной официальный workflow." /></strong>
        <span><UiText text="Сверьте сумму и покупателя с snapshot, создайте чек в «Мой налог», затем сохраните официальный ID и print URL." /></span>
      </aside>
      <section className="metric-grid">
        <Metric label={uiText("Ждут регистрации")} value={counts.waiting} />
        <Metric label={uiText("Ждут доставки")} value={counts.delivery} />
        <Metric label={uiText("Возврат / замена")} value={counts.refund} />
        <Metric danger={counts.overdue > 0} label={uiText("Старше 1 часа")} value={counts.overdue} />
      </section>
      <section className="panel">
        <header className="panel-header">
          <div><h2><UiText text="Обязательства" /></h2><p><UiText text="Не более 100 последних записей, новые сверху" /></p></div>
          <div className="filters">
            <select onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value=""><UiText text="Все статусы" /></option>
              {receiptStatuses.map((item) => <option key={item} value={item}>{<UiText text={statusLabel(item) ?? ""} />}</option>)}
            </select>
            <button className="ghost" onClick={() => void load()} type="button"><UiText text="Обновить" /></button>
          </div>
        </header>
        {error && <div className="form-alert" role="alert">{<UiText text={error ?? ""} />}</div>}
        {loading ? (
          <div className="empty"><UiText text="Загружаем обязательства…" /></div>
        ) : !page || page.data.length === 0 ? (
          <div className="empty"><strong><UiText text="Очередь пуста" /></strong><span><UiText text="Новых обязательств по чекам нет." /></span></div>
        ) : (
          <div className="receipt-table">
            <div className="receipt-row receipt-head">
              <span><UiText text="Оплата" /></span><span><UiText text="Сумма" /></span><span><UiText text="Возраст" /></span><span><UiText text="Статус" /></span><span />
            </div>
            {page.data.map((receipt) => (
              <button className="receipt-row" key={receipt.id} onClick={() => void open(receipt)} type="button">
                <span><strong>{shortId(receipt.yookassaPaymentId)}</strong><small>#{receipt.sequence} · {formatDate(receipt.paidAt, uiLocale)}</small></span>
                <span>{money(receipt.grossAmountMinor, uiLocale)}</span>
                <span>{age(receipt.ageSeconds)}</span>
                <span><Status value={receipt.status} /></span>
                <span><UiText text="Открыть →" /></span>
              </button>
            ))}
          </div>
        )}
      </section>
      {selected && (
        <ReceiptDrawer
          receipt={selected}
          onClose={() => setSelected(undefined)}
          onUpdated={() => {
            setSelected(undefined);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ReceiptDrawer({
  receipt,
  onClose,
  onUpdated
}: Readonly<{
  receipt: AdminNpdReceiptDetail;
  onClose: () => void;
  onUpdated: () => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const action =
    !receipt.officialReceiptId &&
    [
      "AWAITING_MANUAL_REGISTRATION",
      "PENDING",
      "FAILED_RETRYABLE",
      "CANCELLATION_PENDING",
      "REPLACEMENT_REQUIRED"
    ].includes(receipt.status)
      ? "register"
      : receipt.status === "CANCELLATION_PENDING"
        ? "cancel"
        : receipt.status === "REPLACEMENT_REQUIRED"
          ? "replace"
          : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    setBusy(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      reason: String(data.get("reason") ?? "").trim()
    };
    if (action !== "cancel") {
      body.officialReceiptId = String(data.get("officialReceiptId") ?? "").trim();
      body.officialReceiptUrl = String(data.get("officialReceiptUrl") ?? "").trim();
      body.registeredAt = localDateToIso(data.get("registeredAt"));
      body.amountChecked = data.get("amountChecked") === "on";
      body.buyerChecked = data.get("buyerChecked") === "on";
    }
    if (action !== "register") {
      body.cancellationOfficialReference = String(
        data.get("cancellationOfficialReference") ?? ""
      ).trim();
      body.cancelledAt = localDateToIso(data.get("cancelledAt"));
    }
    const endpoint =
      action === "register"
        ? "register-manual"
        : action === "cancel"
          ? "cancel-manual"
          : "replace-manual";
    const response = await adminApi(
      `/api/billing/npd-receipts/${receipt.id}/${endpoint}`,
      {
        method: "POST",
        headers: { "If-Match": `v${receipt.version}` },
        body: JSON.stringify(body)
      }
    );
    setBusy(false);
    if (response.ok) onUpdated();
    else setError(response.message);
  }

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p><UiText text="Платёж" after=" " />{shortId(receipt.yookassaPaymentId)}</p><h2><UiText text="Обязательство по чеку" /></h2></div><button aria-label={uiText("Закрыть")} onClick={onClose} type="button">×</button></header>
        <div className="snapshot">
          <Snapshot label={uiText("Gross-сумма")} value={money(receipt.grossAmountMinor, uiLocale)} />
          <Snapshot label={uiText("Дата оплаты")} value={formatDate(receipt.paidAt, uiLocale)} />
          <Snapshot label={uiText("Покупатель")} value={buyerLabel(receipt)} />
          <Snapshot label={uiText("ИНН")} value={receipt.buyerInn ?? "Не требуется"} />
          <Snapshot label={uiText("Email доставки")} value={receipt.deliveryEmail} />
          <Snapshot label={uiText("Услуга")} value={receipt.serviceDescription} />
          <Snapshot label={uiText("Возвращено")} value={money(receipt.refundedAmountMinor, uiLocale)} />
          <Snapshot label={uiText("Статус")} value={statusLabel(receipt.status)} />
        </div>
        {receipt.officialReceiptUrl && (
          <a className="receipt-link" href={receipt.officialReceiptUrl} rel="noreferrer" target="_blank">
            <UiText text="Открыть официальный чек ↗" /></a>
        )}
        {action ? (
          <form className="operation-form" onSubmit={submit}>
            <h3>{actionTitle(action)}</h3>
            {error && <div className="form-alert" role="alert">{<UiText text={error ?? ""} />}</div>}
            {action !== "register" && (
              <>
                <label><span><UiText text="Подтверждение аннулирования" /></span><input name="cancellationOfficialReference" placeholder={uiText("Официальный ID/номер операции")} required /></label>
                <label><span><UiText text="Дата аннулирования" /></span><input defaultValue={localNow()} name="cancelledAt" required type="datetime-local" /></label>
              </>
            )}
            {action !== "cancel" && (
              <>
                <label><span><UiText text="ID нового чека" /></span><input name="officialReceiptId" placeholder={uiText("Например, 205ldfqqhc")} required /></label>
                <label><span><UiText text="Официальный print URL" /></span><input name="officialReceiptUrl" placeholder="https://lknpd.nalog.ru/api/v1/receipt/…/…/print" required type="url" /></label>
                <label><span><UiText text="Дата регистрации" /></span><input defaultValue={localNow()} name="registeredAt" required type="datetime-local" /></label>
                <label className="check"><input name="amountChecked" required type="checkbox" /><span><UiText text="Сумма чека в «Мой налог» совпадает:" after=" " /><strong>{money(action === "replace" ? receipt.grossAmountMinor - receipt.refundedAmountMinor : receipt.grossAmountMinor, uiLocale)}</strong></span></label>
                <label className="check"><input name="buyerChecked" required type="checkbox" /><span><UiText text="Тип и данные покупателя сверены со snapshot" /></span></label>
              </>
            )}
            <label><span><UiText text="Причина / комментарий аудита" /></span><textarea minLength={8} name="reason" required rows={3} /></label>
            <button className="primary" disabled={busy} type="submit">
              {busy ? <UiText text="Сохраняем…" /> : actionButton(action)}
            </button>
          </form>
        ) : (
          <div className="empty"><strong><UiText text="Ручных действий сейчас нет" /></strong><span><UiText text="Следующий переход выполняется системой или появляется после подтверждённого refund." /></span></div>
        )}
      </aside>
    </div>
  );
}

function StaffRoles() {
  const uiLocale = useUiLocale().locale;
  const [roles, setRoles] = useState<readonly PlatformStaffRoleAssignmentSummary[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const response = await adminApiCollection<PlatformStaffRoleAssignmentSummary>(
      "/api/staff/roles"
    );
    setLoading(false);
    if (response.ok) setRoles(response.data);
    else setError(response.message);
  }, []);
  useEffect(() => void load(), [load]);
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await adminApi("/api/staff/roles", {
      method: "POST",
      body: JSON.stringify({
        userId: String(data.get("userId") ?? "").trim(),
        roleCode: String(data.get("roleCode") ?? ""),
        reason: String(data.get("reason") ?? "").trim()
      })
    });
    if (!response.ok) setError(response.message);
    else {
      form.reset();
      void load();
    }
  }
  async function revoke(role: PlatformStaffRoleAssignmentSummary) {
    const reason = window.prompt(
      `Причина отзыва роли ${role.roleCode} у ${role.email}:`
    )?.trim();
    if (!reason) return;
    const response = await adminApi(`/api/staff/roles/${role.id}/revoke`, {
      method: "POST",
      headers: { "If-Match": `v${role.version}` },
      body: JSON.stringify({ reason })
    });
    if (!response.ok) setError(response.message);
    else void load();
  }
  return (
    <div className="content">
      <section className="heading"><div><p>Security</p><h1>Platform roles</h1></div></section>
      <aside className="warning"><strong><UiText text="Высокорисковое действие." /></strong><span><UiText text="Назначайте минимальную роль; аккаунт обязан иметь подтверждённый email и активный MFA." /></span></aside>
      <section className="grid roles-grid">
        <article className="panel">
          <header><div><h2><UiText text="Назначения" /></h2><p><UiText text="Активные и отозванные записи сохраняются для аудита" /></p></div></header>
          {error && <div className="form-alert">{<UiText text={error ?? ""} />}</div>}
          {loading ? <div className="empty"><UiText text="Загрузка…" /></div> : roles.length === 0 ? <div className="empty"><UiText text="Назначений нет." /></div> : (
            <div className="role-list">{roles.map((role) => <div className="role-row" key={role.id}><div><strong>{role.displayName}</strong><small>{role.email}</small></div><Status value={role.revokedAt ? "REVOKED" : role.roleCode} /><small>{formatDate(role.assignedAt, uiLocale)}</small>{!role.revokedAt && <button className="danger-button" onClick={() => void revoke(role)} type="button"><UiText text="Отозвать" /></button>}</div>)}</div>
          )}
        </article>
        <article className="panel">
          <header><div><h2><UiText text="Назначить роль" /></h2><p><UiText text="Изменение требует недавнего MFA-входа и попадает в audit" /></p></div></header>
          <form className="operation-form" onSubmit={assign}>
            <label><span>User UUID</span><input name="userId" required /></label>
            <label><span><UiText text="Роль" /></span><select name="roleCode">{platformRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
            <label><span><UiText text="Обоснование" /></span><textarea minLength={8} name="reason" required rows={3} /></label>
            <button className="primary" type="submit"><UiText text="Назначить" /></button>
          </form>
        </article>
      </section>
    </div>
  );
}

function Metric({ danger = false, label, value }: Readonly<{ danger?: boolean; label: string; value: number }>) {
  return <article><span>{label}</span><strong>{value}</strong><small className={danger ? "danger-text" : undefined}>{danger ? <UiText text="Требует внимания" /> : <UiText text="Текущая выборка" />}</small></article>;
}
function Status({ value }: Readonly<{ value: string }>) {
  return <b className={`status status-${value.toLowerCase().replaceAll("_", "-")}`}>{<UiText text={statusLabel(value) ?? ""} />}</b>;
}
function Snapshot({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
function StatePage({ action, text, title = "Operations" }: Readonly<{ action?: ReactNode; text: string; title?: string }>) {
  return <main className="state-page"><div className="auth-logo">SW</div><h1><UiText text={title} /></h1><p><UiText text={text} /></p>{action}</main>;
}

async function logout(returnTo = "/") {
  await adminApi("/api/auth/logout", { method: "POST" });
  window.location.assign(returnTo);
}

function adminAccessMessage(message: string): string {
  if (message === "The required platform role is not assigned") {
    return "Для аккаунта не назначена platform role. Выполните первичный bootstrap и войдите заново.";
  }
  if (
    message ===
    "Platform administration requires an active verified account and MFA-authenticated session"
  ) {
    return "Для operations нужен активный подтверждённый аккаунт и новый вход с MFA.";
  }
  return message;
}

const receiptStatuses = [
  "PENDING", "AWAITING_MANUAL_REGISTRATION", "REGISTERING", "REGISTERED",
  "DELIVERY_PENDING", "DELIVERED", "FAILED_RETRYABLE", "FAILED_FINAL",
  "CANCELLATION_PENDING", "CANCELLED", "REPLACEMENT_REQUIRED"
] as const;
const platformRoles: readonly PlatformRoleCode[] = [
  "SUPER_ADMIN", "OPERATIONS", "SUPPORT", "FINANCE", "CONTENT",
  "SECURITY_AUDITOR", "ANALYST"
];

function statusLabel(value: string): string {
  return ({
    PENDING: "Ожидает", AWAITING_MANUAL_REGISTRATION: "Создать чек",
    REGISTERING: "Регистрируется", REGISTERED: "Зарегистрирован",
    DELIVERY_PENDING: "Доставка", DELIVERED: "Доставлен",
    FAILED_RETRYABLE: "Повторить", FAILED_FINAL: "Ошибка",
    CANCELLATION_PENDING: "Аннулировать", CANCELLED: "Аннулирован",
    REPLACEMENT_REQUIRED: "Заменить", REVOKED: "Отозвана"
  } as Record<string, string>)[value] ?? value;
}
function money(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale, { style: "currency", currency: "RUB" }).format(value / 100);
}
function formatDate(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
function age(seconds: number): string {
  if (seconds < 60) return `${seconds} сек`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} мин`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} ч`;
  return `${Math.floor(seconds / 86_400)} д`;
}
function buyerLabel(receipt: AdminNpdReceiptDetail): string {
  const type = receipt.buyerType === "INDIVIDUAL" ? "Физлицо" : receipt.buyerType === "INDIVIDUAL_ENTREPRENEUR" ? "ИП" : "Юрлицо";
  return receipt.buyerName ? `${type} · ${receipt.buyerName}` : type;
}
function shortId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-5)}`;
}
function initials(value: string): string {
  return value.split(/\s+/u).slice(0, 2).map((item) => item[0] ?? "").join("").toUpperCase();
}
function localNow(): string {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return now.toISOString().slice(0, 16);
}
function localDateToIso(value: FormDataEntryValue | null): string {
  return new Date(String(value ?? "")).toISOString();
}
function actionTitle(action: "register" | "cancel" | "replace"): string {
  return action === "register" ? "Зафиксировать созданный чек" : action === "cancel" ? "Зафиксировать аннулирование" : "Аннулировать и заменить чек";
}
function actionButton(action: "register" | "cancel" | "replace"): string {
  return action === "register" ? "Сохранить и поставить на доставку" : action === "cancel" ? "Подтвердить аннулирование" : "Сохранить замену";
}
