"use client";

import { CustomSelect } from "./custom-select";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
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
import { browserIdempotencyKey } from "../lib/idempotency";

interface BillingSnapshot {
  readonly plans: readonly BillingPlanSummary[];
  readonly subscription: BillingSubscriptionSummary | null;
  readonly balance: BillingBalanceSummary;
  readonly orders: readonly BillingOrderSummary[];
  readonly ledger: readonly BillingLedgerTransactionSummary[];
  readonly methods: readonly BillingPaymentMethodSummary[];
  readonly receipts: readonly NpdReceiptObligationSummary[];
}

type BuyerType =
  | "INDIVIDUAL"
  | "INDIVIDUAL_ENTREPRENEUR"
  | "LEGAL_ENTITY";

const TERMS_VERSION = "terms-2026-07-01";

export function BillingSettings({
  workspaceId,
  defaultEmail,
  canManagePlan,
  canTopUp,
  canManagePaymentMethods,
  projectCount,
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
  const [snapshot, setSnapshot] = useState<BillingSnapshot>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [period, setPeriod] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [selectedPlan, setSelectedPlan] = useState<string>();
  const [buyerType, setBuyerType] = useState<BuyerType>("INDIVIDUAL");
  const [buyerName, setBuyerName] = useState("");
  const [buyerInn, setBuyerInn] = useState("");
  const [deliveryEmail, setDeliveryEmail] = useState(defaultEmail);
  const [savePaymentMethod, setSavePaymentMethod] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [topUpRubles, setTopUpRubles] = useState("1000");
  const [refundTarget, setRefundTarget] = useState<BillingOrderSummary>();
  const [refundRubles, setRefundRubles] = useState("");
  const [refundReason, setRefundReason] = useState("");
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
        receipts
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
        )
      ]);
      const next: BillingSnapshot = {
        plans: plans.data,
        subscription,
        balance,
        orders: orders.data,
        ledger: ledger.data,
        methods: methods.data,
        receipts: receipts.data
      };
      setSnapshot(next);
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
    () => snapshot?.plans.find((plan) => plan.code === selectedPlan),
    [selectedPlan, snapshot?.plans]
  );
  const hasAnnualPlans = Boolean(
    snapshot?.plans.some((plan) =>
      plan.prices.some((price) => price.period === "ANNUAL")
    )
  );

  async function mutate(
    key: string,
    operation: () => Promise<void>,
    reload = true
  ) {
    setBusy(key);
    setError(undefined);
    try {
      await operation();
      if (reload) await load();
    } catch (cause) {
      setError(errorMessage(cause));
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
    return {
      buyerType,
      ...(buyerName.trim() ? { buyerName: buyerName.trim() } : {}),
      ...(buyerInn.trim() ? { buyerInn: buyerInn.trim() } : {}),
      deliveryEmail,
      savePaymentMethod,
      termsAccepted,
      termsVersion: TERMS_VERSION
    };
  }

  async function checkout() {
    if (!selected || !termsAccepted) return;
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
              period
            }
          }
        );
        if (!goToConfirmation(order)) await load();
      },
      false
    );
  }

  async function topUp() {
    const amountMinor = rublesToMinor(topUpRubles);
    if (!termsAccepted || amountMinor === undefined || amountMinor < 10_000) {
      setError("Укажите сумму от 100 ₽ и примите условия оплаты.");
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
      false
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

  async function refund() {
    if (!refundTarget) return;
    const amountMinor = rublesToMinor(refundRubles);
    if (amountMinor === undefined || refundReason.trim().length < 3) {
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
      setRefundReason("");
      setRefundRubles("");
    });
  }

  if (!snapshot && !error) {
    return (
      <section className="panel billing-loading" aria-live="polite">
        <span className="billing-spinner" />
        <div>
          <strong>Загружаем биллинг</strong>
          <p>Проверяем тариф, баланс и последние платежи.</p>
        </div>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="panel panel-empty compact" role="alert">
        <strong>Биллинг временно недоступен</strong>
        <p>{error}</p>
        <button className="secondary-button" onClick={() => void load()}>
          Повторить
        </button>
      </section>
    );
  }

  const currentPlan = snapshot.subscription
    ? snapshot.plans.find(
        ({ code, version }) =>
          code === snapshot.subscription?.planCode &&
          version === snapshot.subscription.planVersion
      )
    : undefined;
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
            <strong>Операция не выполнена</strong>
            <span>{error}</span>
          </div>
          <button
            aria-label="Закрыть ошибку"
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
            <strong>Workspace работает в режиме только для чтения</strong>
            <p>
              Просмотр данных доступен. Оплата тарифа или пополнение баланса
              восстановят платные операции.
            </p>
          </div>
        </div>
      )}

      <section className="billing-overview">
        <article className="panel billing-current-plan">
          <span className="billing-label">Текущий тариф</span>
          {snapshot.subscription ? (
            <>
              <h2>{snapshot.subscription.planName}</h2>
              <span
                className={`billing-status ${snapshot.subscription.status.toLowerCase()}`}
              >
                {subscriptionStatus(snapshot.subscription.status)}
              </span>
              <p>
                До {dateLabel(snapshot.subscription.currentPeriodEnd)}
                {snapshot.subscription.cancelAtPeriodEnd
                  ? " · продление отключено"
                  : snapshot.subscription.autopayEnabled
                  ? " · автоплатёж включён"
                  : " · без автоплатежа"}
              </p>
              {canManagePlan &&
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
                      ? "Отключаем продление…"
                      : "Отключить продление"}
                  </button>
                )}
            </>
          ) : (
            <>
              <h2>Подписки нет</h2>
              <p>Выберите платный тариф или активируйте бесплатный без карты.</p>
              {canManagePlan && (
                <button
                  className="secondary-button"
                  disabled={Boolean(busy)}
                  onClick={() => void startTrial()}
                >
                  {busy === "trial" ? "Активируем…" : "Активировать бесплатно"}
                </button>
              )}
            </>
          )}
        </article>
        <article className="panel billing-balance-card">
          <span className="billing-label">Кредиты платформы</span>
          <h2>{money(snapshot.balance.availableMinor)}</h2>
          <p>
            {money(snapshot.balance.includedCreditsMinor)} включено ·{" "}
            {money(snapshot.balance.prepaidMinor)} пополнено
          </p>
          <span className="billing-balance-note">
            Системные съёмы списываются по фактическому использованию. BYOK
            не расходует provider balance платформы.
          </span>
        </article>
        <article className="panel billing-payment-card">
          <span className="billing-label">Способ оплаты</span>
          <h2>
            {canManagePaymentMethods
              ? activePaymentMethod?.title ?? "Не привязан"
              : "Скрыт правами"}
          </h2>
          <p>
            {!canManagePaymentMethods
              ? "Способ оплаты доступен владельцу и участникам с правом управления биллингом."
              : activePaymentMethod
              ? "Используется только для подтверждённых автоплатежей."
              : "Карта сохраняется YooKassa только после вашего согласия."}
          </p>
          {canManagePaymentMethods ? (
            <a className="secondary-button" href="#billing-checkout">
              {activePaymentMethod ? "Управлять" : "Добавить при оплате"}
            </a>
          ) : (
            <span className="billing-balance-note">Без раскрытия платёжных реквизитов</span>
          )}
        </article>
        <article className="panel billing-action-card">
          <span className="billing-label">Действия</span>
          <button
            className="primary-button"
            disabled={!canManagePlan}
            onClick={() =>
              document
                .getElementById("billing-plans")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            Изменить тариф
          </button>
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
            Пополнить баланс
          </button>
        </article>
      </section>

      <section className="panel billing-usage-panel">
        <div className="billing-section-heading">
          <div>
            <span className="billing-label">Использование</span>
            <h2>Лимиты текущего периода</h2>
          </div>
          <small>
            {snapshot.subscription
              ? `${dateLabel(snapshot.subscription.currentPeriodStart)} — ${dateLabel(snapshot.subscription.currentPeriodEnd)}`
              : "Подписка не активна"}
          </small>
        </div>
        <div className="billing-usage-grid">
          <BillingUsageMeter
            label="Активные проекты"
            {...(currentPlan
              ? { limit: currentPlan.features.projects }
              : {})}
            unit="проектов"
            value={projectCount}
          />
          <BillingUsageMeter
            label="Доступные кредиты"
            unit="₽"
            value={snapshot.balance.availableMinor / 100}
          />
          <BillingUsageMeter
            label="Списания в загруженном журнале"
            unit="₽"
            value={loadedLedgerSpend / 100}
          />
          <BillingUsageMeter
            label="Хранимые запросы"
            {...(currentPlan
              ? { limit: currentPlan.features.storedKeywords }
              : {})}
            unit="запросов"
          />
          <BillingUsageMeter
            label="Поисковые контексты"
            {...(currentPlan
              ? { limit: currentPlan.features.trackedContextPairs }
              : {})}
            unit="пар"
          />
          <BillingUsageMeter
            label="Автоматизации"
            {...(currentPlan
              ? { limit: currentPlan.features.scheduledAutomations }
              : {})}
            unit="правил"
          />
          <BillingUsageMeter
            label="Участники"
            {...(currentPlan
              ? { limit: currentPlan.features.seats }
              : {})}
            unit="мест"
          />
          <BillingUsageMeter
            label="Хранилище"
            {...(currentPlan
              ? { limit: currentPlan.features.storageBytes }
              : {})}
            unit="байт"
          />
        </div>
        <p className="billing-usage-note">
          Тариф принадлежит рабочей области, а не отдельному пользователю.
          Все приглашённые участники получают возможности тарифа только в
          рамках этой рабочей области. Лимиты применяются сервером атомарно
          при создании проекта, папки, приглашении участника, импорте
          запросов и запуске фоновой задачи. Значение «—» означает, что
          сервис-владелец ещё не отдал агрегированный расход; лимит при этом
          всё равно проверяется.
        </p>
      </section>

      {currentPlan && (
        <section className="panel billing-entitlements-panel">
          <div className="billing-section-heading">
            <div>
              <span className="billing-label">Возможности плана</span>
              <h2>Что доступно на {currentPlan.name}</h2>
            </div>
            <span className="billing-server-check">Проверяется сервером</span>
          </div>
          <div className="billing-entitlements-grid">
            <BillingEntitlement label="Запросов в проекте" value={number(currentPlan.features.keywordsPerProject)} />
            <BillingEntitlement
              label="Папок в проекте"
              value={currentPlan.features.foldersPerProject === 0
                ? "Без ограничений"
                : number(currentPlan.features.foldersPerProject)}
            />
            <BillingEntitlement label="Одновременных задач" value={number(currentPlan.features.concurrentJobs)} />
            <BillingEntitlement label="Участников рабочей области" value={number(currentPlan.features.seats)} />
            <BillingEntitlement label="Хранение SERP" value={`${number(currentPlan.features.rawSerpRetentionDays)} дней`} />
            <BillingEntitlement label="Гостевые отчёты" value={number(currentPlan.features.guestReports)} />
            <BillingEntitlement label="API-доступ" value={currentPlan.features.publicApi === "BASIC" ? "Базовый" : "Песочница"} />
            <BillingEntitlement label="Собственные API-ключи" value={currentPlan.features.byok ? "Доступны" : "Недоступны"} />
            <BillingEntitlement label="Клиентская роль" value={currentPlan.features.clientRole ? "Доступна" : "Недоступна"} />
            <BillingEntitlement label="White label" value={currentPlan.features.whiteLabel ? "Доступен" : "Недоступен"} />
            <BillingEntitlement label="Приоритет очереди" value={queuePriorityLabel(currentPlan.features.queuePriority)} />
          </div>
        </section>
      )}

      <section className="panel" id="billing-plans">
        <div className="billing-section-heading">
          <div>
            <span className="billing-label">Подписка</span>
            <h2>Выберите тариф</h2>
          </div>
          {hasAnnualPlans && (
            <div
              className="billing-period"
              role="group"
              aria-label="Период оплаты"
            >
              <button
                className={period === "MONTHLY" ? "active" : undefined}
                onClick={() => setPeriod("MONTHLY")}
              >
                Месяц
              </button>
              <button
                className={period === "ANNUAL" ? "active" : undefined}
                onClick={() => setPeriod("ANNUAL")}
              >
                Год
              </button>
            </div>
          )}
        </div>
        <div className="billing-plans">
          {snapshot.plans.map((plan) => (
              <PlanCard
                canManage={canManagePlan}
                current={snapshot.subscription?.planCode === plan.code}
                key={plan.code}
                onSelect={() => {
                  if (plan.code === "TRIAL") {
                    void startTrial();
                    return;
                  }
                  setSelectedPlan(plan.code);
                }}
                period={period}
                plan={plan}
                selected={selectedPlan === plan.code}
              />
            ))}
        </div>
      </section>

      {(selected || canTopUp) && (
        <section className="panel billing-checkout" id="billing-checkout">
          <div>
            <span className="billing-label">Hosted checkout YooKassa</span>
            <h2>
              {selected
                ? `Оплата тарифа ${selected.name}`
                : "Пополнение data balance"}
            </h2>
            <p>
              Реквизиты карты вводятся только на защищённой странице
              YooKassa. Платформа не получает карточные данные.
            </p>
          </div>
          <div className="billing-form-grid">
            <label>
              Тип плательщика
              <CustomSelect
                value={buyerType}
                onChange={(event) =>
                  setBuyerType(event.target.value as BuyerType)
                }
              >
                <option value="INDIVIDUAL">Физическое лицо</option>
                <option value="INDIVIDUAL_ENTREPRENEUR">ИП</option>
                <option value="LEGAL_ENTITY">Юридическое лицо</option>
              </CustomSelect>
            </label>
            <label>
              Email для чека
              <input
                autoComplete="email"
                onChange={(event) => setDeliveryEmail(event.target.value)}
                type="email"
                value={deliveryEmail}
              />
            </label>
            {buyerType !== "INDIVIDUAL" && (
              <>
                <label>
                  Наименование плательщика
                  <input
                    onChange={(event) => setBuyerName(event.target.value)}
                    value={buyerName}
                  />
                </label>
                <label>
                  ИНН
                  <input
                    inputMode="numeric"
                    onChange={(event) => setBuyerInn(event.target.value)}
                    value={buyerInn}
                  />
                </label>
              </>
            )}
            {!selected && canTopUp && (
              <label>
                Сумма пополнения, ₽
                <input
                  inputMode="decimal"
                  min="100"
                  onChange={(event) => setTopUpRubles(event.target.value)}
                  step="1"
                  type="number"
                  value={topUpRubles}
                />
              </label>
            )}
          </div>
          <label className="billing-checkbox">
            <input
              checked={savePaymentMethod}
              onChange={(event) =>
                setSavePaymentMethod(event.target.checked)
              }
              type="checkbox"
            />
            Сохранить способ оплаты для будущих автоплатежей
          </label>
          <label className="billing-checkbox">
            <input
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              type="checkbox"
            />
            Принимаю условия сервиса и подтверждаю параметры заказа
          </label>
          <div className="billing-checkout-actions">
            {selected ? (
              <>
                <button
                  className="primary-button"
                  disabled={Boolean(busy) || !termsAccepted}
                  onClick={() => void checkout()}
                >
                  {busy?.startsWith("plan-")
                    ? "Создаём платёж…"
                    : `Перейти к оплате · ${money(
                        selected.prices.find(
                          (item) => item.period === period
                        )?.amountMinor ?? 0
                      )}`}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setSelectedPlan(undefined)}
                >
                  Пополнить баланс вместо подписки
                </button>
              </>
            ) : (
              <button
                className="primary-button"
                disabled={Boolean(busy) || !termsAccepted}
                onClick={() => void topUp()}
              >
                {busy === "top-up" ? "Создаём платёж…" : "Пополнить баланс"}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="billing-history-grid">
        <article className="panel">
          <span className="billing-label">История</span>
          <h2>Платежи</h2>
          {snapshot.orders.length === 0 ? (
            <div className="billing-empty">
              Платежей пока нет. Созданные заказы появятся здесь.
            </div>
          ) : (
            <div className="billing-rows">
              {snapshot.orders.map((order) => (
                <div className="billing-row" key={order.id}>
                  <div>
                    <strong>{order.description}</strong>
                    <span>
                      {dateLabel(order.createdAt)} ·{" "}
                      {paymentStatus(order.status)}
                    </span>
                  </div>
                  <div>
                    <strong>{money(order.amountMinor)}</strong>
                    {canManagePlan &&
                      ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(
                        order.status
                      ) && (
                        <button
                          onClick={() => {
                            setRefundTarget(order);
                            setRefundRubles(
                              String(
                                (order.amountMinor -
                                  order.payment.refundedAmountMinor) /
                                  100
                              )
                            );
                          }}
                        >
                          Возврат
                        </button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="panel">
          <span className="billing-label">Документы</span>
          <h2>Чеки НПД</h2>
          {snapshot.receipts.length === 0 ? (
            <div className="billing-empty">
              После подтверждённой оплаты здесь появится обязательство по
              чеку.
            </div>
          ) : (
            <div className="billing-rows">
              {snapshot.receipts.map((receipt) => (
                <div className="billing-row" key={receipt.id}>
                  <div>
                    <strong>{receipt.serviceDescription}</strong>
                    <span>
                      {dateLabel(receipt.paidAt)} ·{" "}
                      {receiptStatus(receipt.status)}
                    </span>
                  </div>
                  <strong>{money(receipt.grossAmountMinor)}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {refundTarget && (
        <section className="panel billing-refund">
          <div>
            <span className="billing-label">Возврат YooKassa</span>
            <h2>{refundTarget.description}</h2>
            <p>
              Возврат идёт на исходный способ оплаты. Для пополнения можно
              вернуть только неиспользованный prepaid balance.
            </p>
          </div>
          <label>
            Сумма, ₽
            <input
              min="1"
              onChange={(event) => setRefundRubles(event.target.value)}
              step="0.01"
              type="number"
              value={refundRubles}
            />
          </label>
          <label>
            Причина
            <input
              onChange={(event) => setRefundReason(event.target.value)}
              value={refundReason}
            />
          </label>
          <div className="billing-checkout-actions">
            <button
              className="primary-button"
              disabled={Boolean(busy)}
              onClick={() => void refund()}
            >
              {busy?.startsWith("refund-")
                ? "Отправляем…"
                : "Подтвердить возврат"}
            </button>
            <button
              className="secondary-button"
              onClick={() => setRefundTarget(undefined)}
            >
              Отмена
            </button>
          </div>
        </section>
      )}

      <section className="billing-history-grid">
        <article className="panel">
          <span className="billing-label">Автоплатёж</span>
          <h2>Способы оплаты</h2>
          {!canManagePaymentMethods ? (
            <div className="billing-empty">
              Управление доступно владельцу workspace.
            </div>
          ) : snapshot.methods.length === 0 ? (
            <div className="billing-empty">
              Сохранённых способов нет. Для привязки включите согласие при
              следующей оплате.
            </div>
          ) : (
            <div className="billing-rows">
              {snapshot.methods.map((method) => (
                <div className="billing-row" key={method.id}>
                  <div>
                    <strong>{method.title ?? method.type}</strong>
                    <span>
                      {method.status === "ACTIVE" ? "Активен" : "Отключён"}
                    </span>
                  </div>
                  {method.status === "ACTIVE" && (
                    <button
                      disabled={Boolean(busy)}
                      onClick={() => void disableMethod(method)}
                    >
                      Отключить
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="panel">
          <span className="billing-label">Double-entry ledger</span>
          <h2>Последние операции</h2>
          {snapshot.ledger.length === 0 ? (
            <div className="billing-empty">Финансовых проводок пока нет.</div>
          ) : (
            <div className="billing-rows">
              {snapshot.ledger.slice(0, 12).map((transaction) => (
                <div className="billing-row" key={transaction.id}>
                  <div>
                    <strong>{transaction.description}</strong>
                    <span>
                      {dateLabel(transaction.occurredAt)} ·{" "}
                      {transaction.type}
                    </span>
                  </div>
                  <strong>
                    {money(
                      transaction.entries.find(
                        (entry) => entry.direction === "DEBIT"
                      )?.amountMinor ?? 0
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
  const price = plan.prices.find((item) => item.period === period);
  return (
    <article className={selected ? "billing-plan selected" : "billing-plan"}>
      <div>
        <strong>{plan.name}</strong>
        <p>{plan.description}</p>
      </div>
      <h3>
        {price ? money(price.amountMinor) : "По запросу"}
        <small>/{period === "MONTHLY" ? "мес." : "год"}</small>
      </h3>
      <ul>
        <li>{number(plan.features.seats)} пользователей</li>
        <li>{number(plan.features.projects)} проектов</li>
        <li>
          {plan.features.foldersPerProject === 0
            ? "Без лимита папок"
            : `${number(plan.features.foldersPerProject)} папок на проект`}
        </li>
        <li>{number(plan.features.keywordsPerProject)} ключей на проект</li>
        <li>{number(plan.features.concurrentJobs)} одновременных задач</li>
        <li>{money(plan.includedDataCreditsMinor)} data credits</li>
      </ul>
      {canManage && price && (
        <button
          className="secondary-button"
          disabled={current && price.amountMinor === 0}
          onClick={onSelect}
        >
          {current
            ? price.amountMinor === 0
              ? "Текущий тариф"
              : "Продлить"
            : price.amountMinor === 0
            ? "Активировать"
            : "Выбрать"}
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
        <strong>{value}</strong>
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
  const ratio =
    value !== undefined && limit !== undefined && limit > 0
      ? Math.min(100, Math.round((value / limit) * 100))
      : undefined;
  return (
    <article className="billing-usage-meter">
      <span>{label}</span>
      <strong>
        {value === undefined ? "—" : number(value)}
        {limit === undefined ? ` ${unit}` : ` из ${number(limit)} ${unit}`}
      </strong>
      <div aria-hidden="true">
        <i style={{ width: `${ratio ?? (value === undefined ? 0 : 100)}%` }} />
      </div>
      <small>
        {ratio === undefined
          ? value === undefined
            ? "Метрика появится после подключения агрегатора использования"
            : "Текущее значение"
          : `${ratio}% лимита`}
      </small>
    </article>
  );
}

function goToConfirmation(order: BillingOrderSummary): boolean {
  const target = order.payment.confirmationUrl;
  if (!target) {
    if (order.status === "SUCCEEDED") return false;
    throw new Error(
      "YooKassa не вернула ссылку на оплату"
    );
  }
  const url = new URL(target);
  if (url.protocol !== "https:") {
    throw new Error("Получена небезопасная ссылка на оплату");
  }
  window.location.assign(url);
  return true;
}

function rublesToMinor(value: string): number | undefined {
  if (!/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/u.test(value)) {
    return undefined;
  }
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

function money(minor: number): string {
  return new Intl.NumberFormat("ru-RU", {
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

function number(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
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
