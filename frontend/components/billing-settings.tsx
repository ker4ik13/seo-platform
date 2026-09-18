"use client";
import { legalDocumentVersion } from "../lib/legal-versions";

import { useWorkspaceUsage } from "./workspace-usage-provider";
import { CustomSelect } from "./custom-select";
import { SemanticModal } from "./semantic-modal";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BillingProviderAvailability,
  BillingRefundEligibility,
  BillingRefundRequestSummary,
  OnlineBillingPaymentProvider,
  BillingBalanceSummary,
  BillingLedgerTransactionSummary,
  BillingOrderSummary,
  BillingPaymentMethodSummary,
  BillingPlanSummary,
  BillingSubscriptionSummary,
  NpdReceiptObligationSummary
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiCollectionRequest,
  browserApiRequest
} from "../lib/browser-api";
import {
  billingBuyerBusinessFields,
  billingDeliveryEmail,
  billingRublesToMinor,
  type BillingBuyerFormType
} from "../lib/billing-form";
import { browserIdempotencyKey } from "../lib/idempotency";
import { isPermanentFreeSubscription } from "../lib/billing-subscription-period";
import { UiText, useUiLocale } from "./ui-locale";


interface BillingSnapshot {
  readonly providers: readonly BillingProviderAvailability[];
  readonly plans: readonly BillingPlanSummary[];
  readonly subscription: BillingSubscriptionSummary | null;
  readonly balance: BillingBalanceSummary;
  readonly orders: readonly BillingOrderSummary[];
  readonly ledger: readonly BillingLedgerTransactionSummary[];
  readonly methods: readonly BillingPaymentMethodSummary[];
  readonly receipts: readonly NpdReceiptObligationSummary[];
  readonly refundRequests: readonly BillingRefundRequestSummary[];
}

const TERMS_VERSION = process.env.NEXT_PUBLIC_TERMS_VERSION ?? legalDocumentVersion;

function refundRequestLabel(status: BillingRefundRequestSummary["status"]): string {
  return { REQUESTED: "На рассмотрении", APPROVED: "Одобрено", PROCESSING: "Возврат обрабатывается", MANUAL_REQUIRED: "Владелец выполняет возврат", SUCCEEDED: "Возврат завершён", REJECTED: "Не одобрено", FAILED: "Возврат не выполнен, остаток восстановлен" }[status];
}

export function BillingSettings({
  workspaceId,
  defaultEmail,
  canManagePlan,
  canTopUp,
  canManagePaymentMethods,
  projectCount: _projectCount,
  readOnly
}: Readonly<{
  workspaceId: string;
  defaultEmail: string;
  canManagePlan: boolean;
  canTopUp: boolean;
  canManagePaymentMethods: boolean;
  projectCount: number;
  readOnly: boolean;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const usage = useWorkspaceUsage();
  const [snapshot, setSnapshot] = useState<BillingSnapshot>();
  const [error, setError] = useState<string>();
  const [checkoutError, setCheckoutError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [period, setPeriod] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [selectedPlan, setSelectedPlan] = useState<string>();
  const [selectedVersion, setSelectedVersion] = useState<number>();
  const [buyerType, setBuyerType] =
    useState<BillingBuyerFormType>("INDIVIDUAL");
  const [buyerName, setBuyerName] = useState("");
  const [buyerInn, setBuyerInn] = useState("");
  const [deliveryEmail, setDeliveryEmail] = useState(defaultEmail);
  const [paymentProvider, setPaymentProvider] = useState<OnlineBillingPaymentProvider>("YOOKASSA");
  const [savePaymentMethod, setSavePaymentMethod] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [topUpRubles, setTopUpRubles] = useState("1000");
  const [refundTarget, setRefundTarget] = useState<BillingOrderSummary>();
  const [refundRubles, setRefundRubles] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundEligibility, setRefundEligibility] = useState<BillingRefundEligibility>();
  const [refundNotice, setRefundNotice] = useState<string>();
  const refundLoad = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => refundLoad.current?.abort(), []);
  const basePath = `/app/api/workspaces/${encodeURIComponent(
    workspaceId
  )}/billing`;

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const [
        plans,
        subscription,
        balance,
        orders,
        ledger,
        methods,
        receipts,
        providers,
        refundRequests
      ] = await Promise.all([
        browserApiCollectionRequest<BillingPlanSummary>(
          "/app/api/billing/plans"
        ),
        browserApiRequest<BillingSubscriptionSummary | null>(
          `${basePath}/subscription`
        ),
        browserApiRequest<BillingBalanceSummary>(`${basePath}/balance`),
        browserApiCollectionRequest<BillingOrderSummary>(
          `${basePath}/orders`
        ),
        browserApiCollectionRequest<BillingLedgerTransactionSummary>(
          `${basePath}/ledger`
        ),
        canManagePaymentMethods
          ? browserApiCollectionRequest<BillingPaymentMethodSummary>(
              `${basePath}/payment-methods`
            )
          : Promise.resolve({ data: [], page: { hasNext: false } }),
        browserApiCollectionRequest<NpdReceiptObligationSummary>(
          `${basePath}/receipts`
        ),
        browserApiRequest<readonly BillingProviderAvailability[]>("/app/api/billing/providers"),
        browserApiRequest<readonly BillingRefundRequestSummary[]>(`${basePath}/refund-requests`)
      ]);
      const next: BillingSnapshot = {
        providers,
        refundRequests,
        plans: plans.data,
        subscription,
        balance,
        orders: orders.data,
        ledger: ledger.data,
        methods: methods.data,
        receipts: receipts.data
      };
      setSnapshot(next);
      setPaymentProvider(current => providers.some(provider => provider.provider === current && provider.available) ? current : providers.find(provider => provider.available)?.provider ?? current);
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      return undefined;
    }
  }, [basePath, canManagePaymentMethods]);

  useEffect(() => {
    void (async () => {
      const loaded = await load();
      if (
        loaded &&
        new URLSearchParams(window.location.search).get("checkout") ===
          "return"
      ) {
        const pending = loaded.orders.find((order) =>
          ["PENDING", "PROVIDER_PENDING"].includes(order.status)
        );
        if (pending) {
          try {
            await browserApiRequest(
              `${basePath}/orders/${encodeURIComponent(
                pending.id
              )}/refresh`,
              { method: "POST" }
            );
            await load();
          } catch (cause) {
            setError(errorMessage(cause));
          }
        }
        window.history.replaceState({}, "", "/app/settings/billing");
      }
    })();
  }, [basePath, load]);

  const selected = useMemo(
    () => {
      const retained = snapshot?.subscription?.plan;
      return retained && retained.code === selectedPlan && retained.version === selectedVersion
        ? retained
        : snapshot?.plans.find((plan) => plan.code === selectedPlan && (selectedVersion === undefined || plan.version === selectedVersion));
    },
    [selectedPlan, selectedVersion, snapshot?.plans, snapshot?.subscription]
  );
  const selectedPrice = selected?.prices.find(
    (price) => price.period === period
  );
  const selectedProvider = snapshot?.providers.find(
    ({ provider }) => provider === paymentProvider
  );
  const hasAnnualPlans = Boolean(
    snapshot?.plans.some((plan) =>
      plan.prices.some((price) => price.period === "ANNUAL")
    )
  );

  async function mutate(
    key: string,
    operation: () => Promise<void>,
    reload = true,
    errorPlacement: "page" | "checkout" = "page"
  ) {
    setBusy(key);
    if (errorPlacement === "checkout") setCheckoutError(undefined);
    else setError(undefined);
    try {
      await operation();
      if (reload) await load();
    } catch (cause) {
      const message = errorMessage(cause);
      if (errorPlacement === "checkout") setCheckoutError(message);
      else setError(message);
    } finally {
      setBusy(undefined);
    }
  }

  async function startTrial() {
    await mutate("trial", async () => {
      await browserApiRequest(`${basePath}/trial`, {
        method: "POST",
        idempotencyKey: browserIdempotencyKey("billing-trial")
      });
    });
  }

  async function cancelSubscription() {
    const subscription = snapshot?.subscription;
    if (!subscription) return;
    await mutate("cancel-subscription", async () => {
      await browserApiRequest(`${basePath}/subscription/cancel`, {
        method: "POST",
        ifMatch: subscription.version
      });
    });
  }

  function buyerPayload() {
    const email = billingDeliveryEmail(deliveryEmail);
    if ("error" in email) throw new Error(email.error);
    const business = billingBuyerBusinessFields(
      buyerType,
      buyerName,
      buyerInn
    );
    if ("error" in business) throw new Error(business.error);
    return {
      buyerType,
      ...business.value,
      deliveryEmail: email.value,
      savePaymentMethod:
        paymentProvider === "YOOKASSA" &&
        selectedProvider?.recurring === true &&
        savePaymentMethod,
      provider: paymentProvider,
      termsAccepted,
      termsVersion: TERMS_VERSION
    };
  }

  async function checkout() {
    if (!selected) return;
    if (!termsAccepted) {
      setCheckoutError("Примите условия оплаты.");
      return;
    }
    if (!selectedPrice) {
      setCheckoutError("Для выбранного тарифа этот период оплаты недоступен.");
      return;
    }
    await mutate(
      `plan-${selected.code}`,
      async () => {
        const order = await browserApiRequest<BillingOrderSummary>(
          `${basePath}/checkout`,
          {
            method: "POST",
            idempotencyKey: browserIdempotencyKey("billing-checkout"),
            body: {
              ...buyerPayload(),
              planCode: selected.code,
              planVersion: selected.version,
              period
            }
          }
        );
        if (!goToConfirmation(order)) await load();
      },
      false,
      "checkout"
    );
  }

  async function topUp() {
    const amountMinor = billingRublesToMinor(topUpRubles, 10_000);
    if (!termsAccepted || amountMinor === undefined) {
      setCheckoutError("Укажите сумму от 100 ₽ и примите условия оплаты.");
      return;
    }
    await mutate(
      "top-up",
      async () => {
        const order = await browserApiRequest<BillingOrderSummary>(
          `${basePath}/top-ups`,
          {
            method: "POST",
            idempotencyKey: browserIdempotencyKey("billing-top-up"),
            body: { ...buyerPayload(), amountMinor }
          }
        );
        if (!goToConfirmation(order)) await load();
      },
      false,
      "checkout"
    );
  }

  async function disableMethod(method: BillingPaymentMethodSummary) {
    await mutate(`method-${method.id}`, async () => {
      await browserApiRequest(
        `${basePath}/payment-methods/${encodeURIComponent(method.id)}`,
        { method: "DELETE", ifMatch: method.version }
      );
    });
  }

  async function openRefund(order: BillingOrderSummary) {
    refundLoad.current?.abort();
    const controller = new AbortController(); refundLoad.current = controller;
    setRefundTarget(order); setRefundEligibility(undefined); setRefundRubles(""); setRefundReason(""); setRefundNotice(undefined);
    try {
      const eligible = await browserApiRequest<BillingRefundEligibility>(`${basePath}/payments/${encodeURIComponent(order.payment.id)}/refund-eligibility`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setRefundEligibility(eligible); setRefundRubles(String(eligible.maximumAmountMinor / 100));
    } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
  }
  function closeRefund() { refundLoad.current?.abort(); setRefundTarget(undefined); }

  async function refund() {
    if (!refundTarget) return;
    const amountMinor = billingRublesToMinor(refundRubles, 1);
    if (amountMinor === undefined || !refundEligibility || amountMinor > refundEligibility.maximumAmountMinor || refundReason.trim().length < 3) {
      setError("Укажите корректную сумму и причину возврата.");
      return;
    }
    await mutate(`refund-${refundTarget.id}`, async () => {
      await browserApiRequest(
        `${basePath}/payments/${encodeURIComponent(
          refundTarget.payment.id
        )}/refunds`,
        {
          method: "POST",
          idempotencyKey: browserIdempotencyKey("billing-refund"),
          body: { amountMinor, reason: refundReason.trim() }
        }
      );
      setRefundTarget(undefined);
      setRefundNotice("Заявка отправлена владельцу сервиса. Решение появится в разделе возвратов.");
      setRefundReason("");
      setRefundRubles("");
    });
  }

  if (!snapshot && !error) {
    return (
      <section className="panel billing-loading" aria-live="polite">
        <span className="billing-spinner" />
        <div>
          <strong><UiText text="Загружаем биллинг" /></strong>
          <p><UiText text="Проверяем тариф, баланс и последние платежи." /></p>
        </div>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="panel panel-empty compact" role="alert">
        <strong><UiText text="Биллинг временно недоступен" /></strong>
        <p>{<UiText text={error ?? ""} />}</p>
        <button className="secondary-button" onClick={() => void load()}>
          <UiText text="Повторить" /></button>
      </section>
    );
  }

  const currentPlan = usage.data?.plan ?? (snapshot.subscription
    ? snapshot.plans.find(
        ({ code, version }) =>
          code === snapshot.subscription?.planCode &&
          version === snapshot.subscription.planVersion
      )
    : undefined);
  const loadedLedgerSpend = snapshot.ledger.reduce(
    (sum, transaction) =>
      sum +
      transaction.entries
        .filter(
          ({ accountType, direction }) =>
            direction === "DEBIT" &&
            [
              "CUSTOMER_PREPAID_LIABILITY",
              "PROMOTIONAL_LIABILITY"
            ].includes(accountType)
        )
        .reduce((entrySum, entry) => entrySum + entry.amountMinor, 0),
    0
  );
  const activePaymentMethod = canManagePaymentMethods
    ? snapshot.methods.find(({ status }) => status === "ACTIVE")
    : undefined;

  return (
    <div className="billing-stack">
      {error && (
        <div className="billing-alert" role="alert">
          <div>
            <strong><UiText text="Операция не выполнена" /></strong>
            <span>{<UiText text={error ?? ""} />}</span>
          </div>
          <button
            aria-label={uiText("Закрыть ошибку")}
            onClick={() => setError(undefined)}
          >
            ×
          </button>
        </div>
      )}
      {readOnly && (
        <div className="status-banner">
          <span className="status-dot" />
          <div>
            <strong><UiText text="Workspace работает в режиме только для чтения" /></strong>
            <p>
              <UiText text="Просмотр данных доступен. Оплата тарифа или пополнение баланса восстановят платные операции." /></p>
          </div>
        </div>
      )}

      <section className="billing-overview">
        <article className="panel billing-current-plan">
          <span className="billing-label"><UiText text="Текущий тариф" /></span>
          {snapshot.subscription ? (
            <>
              <h2>{uiLocale === "en" ? snapshot.subscription.plan?.nameEn ?? uiText(snapshot.subscription.planName) : snapshot.subscription.planName}</h2>
              <span
                className={`billing-status ${snapshot.subscription.status.toLowerCase()}`}
              >
                {<UiText text={subscriptionStatus(snapshot.subscription.status) ?? ""} />}
              </span>
              <p>
                {isPermanentFreeSubscription(snapshot.subscription)
                  ? <UiText text="Без ограничения срока" />
                  : <UiText text="До {0}" values={[String(dateLabel(snapshot.subscription.currentPeriodEnd, uiLocale))]} />}
                {snapshot.subscription.cancelAtPeriodEnd
                  ? <UiText text="· продление отключено" before=" " />
                  : snapshot.subscription.autopayEnabled
                  ? <UiText text="· автоплатёж включён" before=" " />
                  : <UiText text="· без автоплатежа" before=" " />}
              </p>
              {snapshot.subscription.plan && snapshot.subscription.planCode !== "TRIAL" && canManagePlan && <button className="secondary-button" type="button" onClick={() => { setSelectedPlan(snapshot.subscription!.planCode); setSelectedVersion(snapshot.subscription!.planVersion); setPeriod(snapshot.subscription!.period); }}><UiText text="Продлить на моих условиях" /></button>}
              {snapshot.subscription.unusedServiceValueMinor !== undefined && snapshot.subscription.unusedServiceValueMinor > 0 && <p><UiText text="Неиспользованная стоимость:" after=" " />{money(snapshot.subscription.unusedServiceValueMinor, uiLocale)}<UiText text=". При смене тарифа она переносится в дополнительные дни." /></p>}
              {canManagePlan &&
                !isPermanentFreeSubscription(snapshot.subscription) &&
                !snapshot.subscription.cancelAtPeriodEnd &&
                ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"].includes(
                  snapshot.subscription.status
                ) && (
                  <button
                    className="text-button billing-cancel-subscription"
                    disabled={Boolean(busy)}
                    onClick={() => void cancelSubscription()}
                  >
                    {busy === "cancel-subscription"
                      ? <UiText text="Отключаем продление…" />
                      : <UiText text="Отключить продление" />}
                  </button>
                )}
            </>
          ) : (
            <>
              <h2><UiText text="Подписки нет" /></h2>
              <p><UiText text="Выберите платный тариф или активируйте бесплатный без карты." /></p>
              {canManagePlan && (
                <button
                  className="secondary-button"
                  disabled={Boolean(busy)}
                  onClick={() => void startTrial()}
                >
                  {busy === "trial" ? <UiText text="Активируем…" /> : <UiText text="Активировать бесплатно" />}
                </button>
              )}
            </>
          )}
        </article>
        <article className="panel billing-balance-card">
          <span className="billing-label"><UiText text="Внутренние токены" /></span>
          <h2>{money(snapshot.balance.availableMinor, uiLocale)}</h2>
          <p>
            {money(snapshot.balance.includedCreditsMinor, uiLocale)} <UiText text="включено ·" before=" " />{" "}
            {money(snapshot.balance.prepaidMinor, uiLocale)} <UiText text="пополнено" before=" " /></p>
          <span className="billing-balance-note">
            <UiText text="Системные проверки списывают токены по подтверждённой цене. BYOK не расходует внутренний баланс платформы." /></span>
        </article>
        <article className="panel billing-payment-card">
          <span className="billing-label"><UiText text="Способ оплаты" /></span>
          <h2>
            {canManagePaymentMethods
              ? activePaymentMethod?.title ?? <UiText text="Не привязан" />
              : <UiText text="Скрыт правами" />}
          </h2>
          <p>
            {!canManagePaymentMethods
              ? <UiText text="Способ оплаты доступен владельцу и участникам с правом управления биллингом." />
              : activePaymentMethod
              ? <UiText text="Используется только для подтверждённых автоплатежей." />
              : <UiText text="Карта сохраняется YooKassa только после вашего согласия." />}
          </p>
          {canManagePaymentMethods ? (
            <a className="secondary-button" href="#billing-checkout">
              {activePaymentMethod ? <UiText text="Управлять" /> : <UiText text="Добавить при оплате" />}
            </a>
          ) : (
            <span className="billing-balance-note"><UiText text="Без раскрытия платёжных реквизитов" /></span>
          )}
        </article>
        <article className="panel billing-action-card">
          <span className="billing-label"><UiText text="Действия" /></span>
          <button
            className="primary-button"
            disabled={!canManagePlan}
            onClick={() =>
              document
                .getElementById("billing-plans")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <UiText text="Изменить тариф" /></button>
          <button
            className="secondary-button"
            disabled={!canTopUp}
            onClick={() => {
              setSelectedPlan(undefined);
              document
                .getElementById("billing-checkout")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <UiText text="Пополнить баланс" /></button>
        </article>
      </section>

      <section className="panel billing-usage-panel">
        <div className="billing-section-heading">
          <div>
            <span className="billing-label"><UiText text="Использование" /></span>
            <h2><UiText text="Лимиты текущего периода" /></h2>
          </div>
          <small>
            {snapshot.subscription
              ? isPermanentFreeSubscription(snapshot.subscription)
                ? <UiText text="Бесплатный тариф без ограничения срока" />
                : `${dateLabel(snapshot.subscription.currentPeriodStart, uiLocale)} — ${dateLabel(snapshot.subscription.currentPeriodEnd, uiLocale)}`
              : <UiText text="Подписка не активна" />}
          </small>
        </div>
        <div className="billing-usage-grid">
          <BillingUsageMeter
            label={uiText("Активные проекты")}
            {...(currentPlan
              ? { limit: currentPlan.features.projects }
              : {})}
            unit="проектов"
            {...(usage.data?.resources.projects.used != null ? { value: usage.data.resources.projects.used } : {})}
          />
          <BillingUsageMeter
            label={uiText("Доступные токены")}
            unit="₽"
            value={snapshot.balance.availableMinor / 100}
          />
          <BillingUsageMeter
            label={uiText("Списания в загруженном журнале")}
            unit="₽"
            value={loadedLedgerSpend / 100}
          />
          <BillingUsageMeter
            label={uiText("Хранимые запросы")}
            {...(currentPlan && currentPlan.features.storedKeywords > 0
              ? { limit: currentPlan.features.storedKeywords }
              : {})}
            unit="запросов"
            {...(usage.data?.resources.keywords.used != null ? { value: usage.data.resources.keywords.used } : {})}
          />
          <BillingUsageMeter
            label={uiText("Активные операции")}
            {...(currentPlan ? { limit: currentPlan.features.concurrentJobs } : {})}
            unit="задач"
            {...(usage.data?.resources.concurrentJobs.used != null ? { value: usage.data.resources.concurrentJobs.used } : {})}
          />
          <BillingUsageMeter
            label={uiText("Автоматизации")}
            {...(currentPlan
              ? { limit: currentPlan.features.scheduledAutomations }
              : {})}
            unit="правил"
            {...(usage.data?.resources.automations.used != null ? { value: usage.data.resources.automations.used } : {})}
          />
          <BillingUsageMeter
            label={uiText("Участники")}
            {...(currentPlan
              ? { limit: currentPlan.features.seats }
              : {})}
            unit="мест"
            {...(usage.data?.resources.seats.used != null ? { value: usage.data.resources.seats.used } : {})}
          />
          <BillingUsageMeter
            label={uiText("Хранилище")}
            {...(currentPlan
              ? { limit: currentPlan.features.storageBytes / (1024 ** 3) }
              : {})}
            unit="ГБ"
            {...(usage.data?.resources.storageBytes.used != null ? { value: Math.round(usage.data.resources.storageBytes.used / (1024 ** 3) * 100) / 100 } : {})}
          />
        </div>
        <p className="billing-usage-note">
          <UiText text="Лимиты общие для всех участников рабочей области. Приглашения резервируют места до принятия или истечения срока. Баланс данных расходуется только на системные проверки; со своим ключом вы платите провайдеру напрямую. Сохранённые данные остаются доступны при снижении тарифа." />{usage.unavailable || usage.data?.degraded ? <UiText text="Часть показателей временно недоступна — повторите обновление позже." before=" " /> : ""}
        </p>
      </section>

      {currentPlan && (
        <section className="panel billing-entitlements-panel">
          <div className="billing-section-heading">
            <div>
              <span className="billing-label"><UiText text="Возможности плана" /></span>
              <h2><UiText text="Что доступно на" after=" " /><UiText text={currentPlan.name} /></h2>
            </div>
            <span className="billing-server-check"><UiText text="Проверяется сервером" /></span>
          </div>
          <div className="billing-entitlements-grid">
            <BillingEntitlement
              label={uiText("Запросов в проекте")}
              value={currentPlan.features.keywordsPerProject === 0
                ? "Без ограничений"
                : number(currentPlan.features.keywordsPerProject, uiLocale)}
            />
            <BillingEntitlement label={uiText("Одновременных задач")} value={number(currentPlan.features.concurrentJobs, uiLocale)} />
            <BillingEntitlement label={uiText("Участников рабочей области")} value={number(currentPlan.features.seats, uiLocale)} />
            <BillingEntitlement label={uiText("Хранение SERP")} value={`${number(currentPlan.features.rawSerpRetentionDays, uiLocale)} дней`} />
            <BillingEntitlement label={uiText("Гостевые отчёты")} value={number(currentPlan.features.guestReports, uiLocale)} />
            <BillingEntitlement label={uiText("API-доступ")} value={currentPlan.features.publicApi === "BASIC" ? "Базовый" : "Песочница"} />
            <BillingEntitlement label={uiText("Собственные API-ключи")} value={currentPlan.features.byok ? "Доступны" : "Недоступны"} />
            <BillingEntitlement label={uiText("Клиентская роль")} value={currentPlan.features.clientRole ? "Доступна" : "Недоступна"} />
            <BillingEntitlement label="White label" value={currentPlan.features.whiteLabel ? "Доступен" : "Недоступен"} />
            <BillingEntitlement label={uiText("Приоритет очереди")} value={queuePriorityLabel(currentPlan.features.queuePriority)} />
          </div>
        </section>
      )}

      <section className="panel" id="billing-plans">
        <div className="billing-section-heading">
          <div>
            <span className="billing-label"><UiText text="Подписка" /></span>
            <h2><UiText text="Выберите тариф" /></h2>
          </div>
          {hasAnnualPlans && (
            <div
              className="billing-period"
              role="group"
              aria-label={uiText("Период оплаты")}
            >
              <button
                className={period === "MONTHLY" ? "active" : undefined}
                onClick={() => setPeriod("MONTHLY")}
              >
                <UiText text="Месяц" /></button>
              <button
                className={period === "ANNUAL" ? "active" : undefined}
                onClick={() => setPeriod("ANNUAL")}
              >
                <UiText text="Год" /></button>
            </div>
          )}
        </div>
        <div className="billing-plans">
          {snapshot.plans.map((plan) => (
              <PlanCard
                canManage={canManagePlan}
                current={snapshot.subscription?.planCode === plan.code && (plan.code === "TRIAL" || snapshot.subscription.planVersion === plan.version)}
                key={plan.code}
                onSelect={() => {
                  if (plan.code === "TRIAL") {
                    void startTrial();
                    return;
                  }
                  setSelectedPlan(plan.code);
                  setSelectedVersion(plan.version);
                }}
                period={period}
                plan={plan}
                selected={selectedPlan === plan.code && (selectedVersion === undefined || selectedVersion === plan.version)}
              />
            ))}
        </div>
      </section>

      {(selected || canTopUp) && (
        <section className="panel billing-checkout" id="billing-checkout">
          <div>
            <span className="billing-label"><UiText text="Защищённая оплата" /></span>
            <h2>
              {selected
                ? <UiText text="Оплата тарифа {0}" values={[String(selected.name)]} />
                : <UiText text="Пополнение баланса данных" />}
            </h2>
            <p>
              <UiText text="Оплата проходит на защищённой странице выбранного сервиса. Платформа не получает реквизиты карты или ключи криптокошелька." /></p>
          </div>
          <div className="billing-provider-options" aria-label={uiText("Способ оплаты")}>
            {snapshot.providers.map(provider => <label key={provider.provider} className={paymentProvider === provider.provider ? "selected" : undefined}>
              <input type="radio" name="payment-provider" value={provider.provider} checked={paymentProvider === provider.provider} disabled={!provider.available || Boolean(busy)} onChange={() => { setPaymentProvider(provider.provider); setCheckoutError(undefined); }} />
              <span><strong>{provider.provider === "YOOKASSA" ? <UiText text="Карта или СБП" /> : "Crypto Pay"}</strong><small>{!provider.available ? <UiText text="Скоро" /> : provider.mode === "TEST" ? <UiText text="Тестовый режим" /> : provider.recurring ? <UiText text="Доступно автопродление" /> : <UiText text="Разовая оплата без автосписания" />}</small></span>
            </label>)}
          </div>
          {snapshot.providers.find(provider => provider.provider === paymentProvider)?.mode === "TEST" && <div className="inline-alert info"><UiText text="Тестовая оплата проверяет подключение. Она не пополняет баланс и не активирует платную подписку." /></div>}
          <div className="billing-form-grid">
            <label>
              <UiText text="Тип плательщика" /><CustomSelect
                value={buyerType}
                onChange={(event) =>
                  setBuyerType(event.target.value as BillingBuyerFormType)
                }
              >
                <option value="INDIVIDUAL"><UiText text="Физическое лицо" /></option>
                <option value="INDIVIDUAL_ENTREPRENEUR"><UiText text="ИП" /></option>
                <option value="LEGAL_ENTITY"><UiText text="Юридическое лицо" /></option>
              </CustomSelect>
            </label>
            <label>
              <UiText text="Email для чека" /><input
                autoComplete="email"
                onChange={(event) => setDeliveryEmail(event.target.value)}
                type="email"
                value={deliveryEmail}
              />
            </label>
            {buyerType !== "INDIVIDUAL" && (
              <>
                <label>
                  <UiText text="Наименование плательщика" /><input
                    onChange={(event) => setBuyerName(event.target.value)}
                    value={buyerName}
                  />
                </label>
                <label>
                  <UiText text="ИНН" /><input
                    inputMode="numeric"
                    onChange={(event) => setBuyerInn(event.target.value)}
                    value={buyerInn}
                  />
                </label>
              </>
            )}
            {!selected && canTopUp && (
              <label>
                <UiText text="Сумма пополнения, ₽" /><input
                  inputMode="decimal"
                  onChange={(event) => { setTopUpRubles(event.target.value); setCheckoutError(undefined); }}
                  type="text"
                  value={topUpRubles}
                />
              </label>
            )}
          </div>
          {paymentProvider === "YOOKASSA" && selectedProvider?.recurring && <label className="billing-checkbox">
            <input
              checked={savePaymentMethod}
              onChange={(event) =>
                setSavePaymentMethod(event.target.checked)
              }
              type="checkbox"
            />
            {selected ? <UiText text="Сохранить способ оплаты и включить автопродление подписки" /> : <UiText text="Сохранить способ оплаты для следующих платежей" />}
          </label>}
          <label className="billing-checkbox">
            <input
              checked={termsAccepted}
              onChange={(event) => { setTermsAccepted(event.target.checked); setCheckoutError(undefined); }}
              type="checkbox"
            />
            <UiText text="Принимаю условия сервиса и подтверждаю параметры заказа" /></label>
          {checkoutError && <div className="inline-error" role="alert"><UiText text={checkoutError} /></div>}
          <div className="billing-checkout-actions">
            {selected ? (
              <>
                <button
                  className="primary-button"
                  disabled={
                    Boolean(busy) || !selectedPrice || !snapshot.providers.some(provider => provider.provider === paymentProvider && provider.available)
                  }
                  onClick={() => void checkout()}
                  type="button"
                >
                  {!selectedPrice
                    ? <UiText text="Период недоступен" />
                    : busy?.startsWith("plan-")
                    ? <UiText text="Создаём платёж…" />
                    : <UiText text="Перейти к оплате · {0}" values={[String(money(
                        selectedPrice.amountMinor, uiLocale
                      ))]} />}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setSelectedPlan(undefined)}
                  type="button"
                >
                  <UiText text="Пополнить баланс вместо подписки" /></button>
              </>
            ) : (
              <button
                className="primary-button"
                disabled={Boolean(busy) || !snapshot.providers.some(provider => provider.provider === paymentProvider && provider.available)}
                onClick={() => void topUp()}
                type="button"
              >
                {busy === "top-up" ? <UiText text="Создаём платёж…" /> : <UiText text="Пополнить баланс" />}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="billing-history-grid">
        <article className="panel">
          <span className="billing-label"><UiText text="История" /></span>
          <h2><UiText text="Платежи" /></h2>
          {snapshot.orders.length === 0 ? (
            <div className="billing-empty">
              <UiText text="Платежей пока нет. Созданные заказы появятся здесь." /></div>
          ) : (
            <div className="billing-rows">
              {snapshot.orders.map((order) => (
                <div className="billing-row" key={order.id}>
                  <div>
                    <strong>{order.description}</strong>
                    <span>
                      {dateLabel(order.createdAt, uiLocale)} ·{" "}
                      {order.payment.test ? <UiText text="Тестовый платёж" /> : paymentStatus(order.status)}
                    </span>
                  </div>
                  <div>
                    <strong>{money(order.amountMinor, uiLocale)}</strong>
                    {canManagePlan &&
                      !order.payment.test &&
                      ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(
                        order.status
                      ) && (
                        <button
                          onClick={() => void openRefund(order)}
                        >
                          <UiText text="Запросить возврат" /></button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="panel">
          <span className="billing-label"><UiText text="Документы" /></span>
          <h2><UiText text="Чеки НПД" /></h2>
          {snapshot.receipts.length === 0 ? (
            <div className="billing-empty">
              <UiText text="После оплаты здесь появится чек или статус его подготовки." /></div>
          ) : (
            <div className="billing-rows">
              {snapshot.receipts.map((receipt) => (
                <div className="billing-row" key={receipt.id}>
                  <div>
                    <strong>{receipt.serviceDescription}</strong>
                    <span>
                      {dateLabel(receipt.paidAt, uiLocale)} ·{" "}
                      {<UiText text={receiptStatus(receipt.status) ?? ""} />}
                    </span>
                  </div>
                  <strong>{money(receipt.grossAmountMinor, uiLocale)}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {refundTarget && (
        <SemanticModal title={uiText("Заявка на возврат")} size="small" onClose={closeRefund}><div className="billing-refund">
          <div>
            <span className="billing-label"><UiText text="Заявка на возврат" /></span>
            <h2>{refundTarget.description}</h2>
            <p>
              <UiText text="Владелец сервиса рассматривает возврат неиспользованного баланса данных и оплаченных дней. Одобренный возврат подписки сокращает оплаченный период и отключает автопродление." /></p>
            <p>{refundEligibility ? <UiText text="Сейчас доступно к возврату: {0}" values={[String(money(refundEligibility.maximumAmountMinor, uiLocale))]} /> : <UiText text="Рассчитываем неиспользованный остаток…" />}</p>
          </div>
          <label>
            <UiText text="Сумма, ₽" /><input
              min="0.01"
              max={refundEligibility ? refundEligibility.maximumAmountMinor / 100 : undefined}
              onChange={(event) => setRefundRubles(event.target.value)}
              step="0.01"
              type="number"
              value={refundRubles}
            />
          </label>
          <label>
            <UiText text="Причина" /><input
              onChange={(event) => setRefundReason(event.target.value)}
              value={refundReason}
            />
          </label>
          <div className="billing-checkout-actions">
            <button
              className="primary-button"
              disabled={Boolean(busy) || !refundEligibility || refundEligibility.maximumAmountMinor < 1}
              onClick={() => void refund()}
            >
              {busy?.startsWith("refund-")
                ? <UiText text="Отправляем…" />
                : <UiText text="Отправить заявку" />}
            </button>
            <button
              className="secondary-button"
              onClick={closeRefund}
            >
              <UiText text="Отмена" /></button>
          </div>
        </div></SemanticModal>
      )}

      {refundNotice && <p className="success-message" role="status">{<UiText text={refundNotice ?? ""} />}</p>}
      {snapshot.refundRequests.length > 0 && <section className="panel"><span className="billing-label"><UiText text="Обращения" /></span><h2><UiText text="Возвраты" /></h2><div className="billing-rows">{snapshot.refundRequests.map(request => <div className="billing-row" key={request.id}><div><strong>{<UiText text={refundRequestLabel(request.status) ?? ""} />}</strong><span>{dateLabel(request.createdAt, uiLocale)} · {request.reason}</span>{request.decisionReason && <span>{request.decisionReason}</span>}</div><strong>{money(request.approvedAmountMinor ?? request.requestedAmountMinor, uiLocale)}</strong></div>)}</div><button className="secondary-button" type="button" onClick={() => void load()}><UiText text="Обновить статусы" /></button></section>}

      <section className="billing-history-grid">
        <article className="panel">
          <span className="billing-label"><UiText text="Автоплатёж" /></span>
          <h2><UiText text="Способы оплаты" /></h2>
          {!canManagePaymentMethods ? (
            <div className="billing-empty">
              <UiText text="Управление доступно владельцу workspace." /></div>
          ) : snapshot.methods.length === 0 ? (
            <div className="billing-empty">
              <UiText text="Сохранённых способов нет. Для привязки включите согласие при следующей оплате." /></div>
          ) : (
            <div className="billing-rows">
              {snapshot.methods.map((method) => (
                <div className="billing-row" key={method.id}>
                  <div>
                    <strong>{method.title ?? method.type}</strong>
                    <span>
                      {method.status === "ACTIVE" ? <UiText text="Активен" /> : <UiText text="Отключён" />}
                    </span>
                  </div>
                  {method.status === "ACTIVE" && (
                    <button
                      disabled={Boolean(busy)}
                      onClick={() => void disableMethod(method)}
                    >
                      <UiText text="Отключить" /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="panel">
          <span className="billing-label"><UiText text="История баланса" /></span>
          <h2><UiText text="Последние операции" /></h2>
          {snapshot.ledger.length === 0 ? (
            <div className="billing-empty"><UiText text="Операций по балансу пока нет." /></div>
          ) : (
            <div className="billing-rows">
              {snapshot.ledger.slice(0, 12).map((transaction) => (
                <div className="billing-row" key={transaction.id}>
                  <div>
                    <strong>{transaction.description}</strong>
                    <span>
                      {dateLabel(transaction.occurredAt, uiLocale)} ·{" "}
                      {transaction.type}
                    </span>
                  </div>
                  <strong>
                    {money(
                      transaction.entries.find(
                        (entry) => entry.direction === "DEBIT"
                      )?.amountMinor ?? 0, uiLocale
                    )}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  period,
  selected,
  current,
  canManage,
  onSelect
}: Readonly<{
  plan: BillingPlanSummary;
  period: "MONTHLY" | "ANNUAL";
  selected: boolean;
  current: boolean;
  canManage: boolean;
  onSelect: () => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const price = plan.prices.find((item) => item.period === period);
  return (
    <article className={selected ? "billing-plan selected" : "billing-plan"}>
      <div>
        <strong>{uiLocale === "en" ? plan.nameEn ?? plan.name : plan.name}</strong>
        <p>{uiLocale === "en" ? plan.descriptionEn ?? plan.description : plan.description}</p>
      </div>
      <h3>
        {price ? money(price.amountMinor, uiLocale) : <UiText text="По запросу" />}
        <small>/{period === "MONTHLY" ? <UiText text="мес." /> : <UiText text="год" />}</small>
      </h3>
      <ul>
        <li>{number(plan.features.seats, uiLocale)} <UiText text="пользователей" before=" " /></li>
        <li>{number(plan.features.projects, uiLocale)} <UiText text="проектов" before=" " /></li>
        <li>
          {plan.features.keywordsPerProject === 0
            ? <UiText text="Без лимита ключей" />
            : <UiText text="{0} ключей на проект" values={[String(number(plan.features.keywordsPerProject, uiLocale))]} />}
        </li>
        <li>{number(plan.features.concurrentJobs, uiLocale)} <UiText text="одновременных задач" before=" " /></li>
        {plan.includedDataCreditsMinor > 0 && (
          <li>{money(plan.includedDataCreditsMinor, uiLocale)} <UiText text="внутренних токенов" before=" " /></li>
        )}
      </ul>
      {canManage && price && (
        <button
          className="secondary-button"
          disabled={current && price.amountMinor === 0}
          onClick={onSelect}
        >
          {current
            ? price.amountMinor === 0
              ? <UiText text="Текущий тариф" />
              : <UiText text="Продлить" />
            : price.amountMinor === 0
            ? <UiText text="Активировать" />
            : <UiText text="Выбрать" />}
        </button>
      )}
    </article>
  );
}

function BillingEntitlement({
  label,
  value
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="billing-entitlement">
      <span aria-hidden="true">✓</span>
      <div>
        <small>{label}</small>
        <strong><UiText text={value} /></strong>
      </div>
    </div>
  );
}

function BillingUsageMeter({
  label,
  limit,
  unit,
  value
}: Readonly<{
  label: string;
  limit?: number;
  unit: string;
  value?: number;
}>) {
  const { t: uiText, locale: uiLocale } = useUiLocale();
  const ratio =
    value !== undefined && limit !== undefined && limit > 0
      ? Math.min(100, Math.round((value / limit) * 100))
      : undefined;
  return (
    <article className="billing-usage-meter">
      <span>{label}</span>
      <strong>
        {value === undefined ? "—" : number(value, uiLocale)}
        {limit === undefined || limit === 0 ? ` ${uiText(unit)}` : <UiText text="из {0} {1}" values={[String(number(limit, uiLocale)), String(uiText(unit))]} before=" " />}
      </strong>
      {ratio !== undefined && (
        <div aria-hidden="true"><i style={{ width: `${ratio}%` }} /></div>
      )}
      <small>
        {ratio === undefined
          ? value === undefined
            ? <UiText text="Данные об использовании пока недоступны" />
            : limit === 0 ? <UiText text="Без лимита" /> : <UiText text="Текущее значение" />
          : <UiText text="{0}% лимита" values={[String(ratio)]} />}
      </small>
    </article>
  );
}

function goToConfirmation(order: BillingOrderSummary): boolean {
  const target = order.payment.confirmationUrl;
  if (!target) {
    if (order.status === "SUCCEEDED") return false;
    throw new Error(
      "Платёжный сервис ещё не вернул ссылку на оплату"
    );
  }
  const url = new URL(target);
  if (url.protocol !== "https:") {
    throw new Error("Получена небезопасная ссылка на оплату");
  }
  window.location.assign(url);
  return true;
}

function money(minor: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale, {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2
  }).format(minor / 100);
}

function queuePriorityLabel(
  priority: BillingPlanSummary["features"]["queuePriority"]
): string {
  const labels: Readonly<
    Record<BillingPlanSummary["features"]["queuePriority"], string>
  > = {
    TRIAL: "Пробный",
    NORMAL: "Обычный",
    NORMAL_PLUS: "Повышенный",
    HIGH: "Высокий",
    HIGHEST_FAIR_USE: "Максимальный fair use"
  };
  return labels[priority];
}

function number(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}

function dateLabel(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function subscriptionStatus(value: string): string {
  return (
    {
      TRIALING: "Пробный период",
      ACTIVE: "Активен",
      PAST_DUE: "Оплата просрочена",
      GRACE: "Льготный период",
      PAUSED: "Приостановлен",
      CANCELLING: "Отменяется",
      CANCELLED: "Отменён",
      SUSPENDED: "Заблокирован"
    }[value] ?? value
  );
}

function paymentStatus(value: string): string {
  return (
    {
      PENDING: "создаётся",
      PROVIDER_PENDING: "ожидает оплаты",
      SUCCEEDED: "оплачен",
      FAILED: "ошибка",
      CANCELLED: "отменён",
      PARTIALLY_REFUNDED: "частично возвращён",
      REFUNDED: "возвращён"
    }[value] ?? value
  );
}

function receiptStatus(value: string): string {
  return (
    {
      AWAITING_MANUAL_REGISTRATION: "ожидает регистрации в «Мой налог»",
      REGISTERED: "зарегистрирован",
      DELIVERY_PENDING: "ожидает отправки",
      DELIVERED: "доставлен",
      CANCELLATION_PENDING: "требуется аннулирование",
      CANCELLED: "аннулирован",
      REPLACEMENT_REQUIRED: "требуется корректирующий чек"
    }[value] ?? value
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    const request = error.requestId ? ` Код запроса: ${error.requestId}.` : "";
    return `${error.message}.${request}`;
  }
  return error instanceof Error
    ? error.message
    : "Неизвестная ошибка биллинга.";
}
