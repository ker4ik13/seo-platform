"use client";

import type {
  WebPushBrowser,
  WebPushDeviceStatus,
  WebPushDeviceStatusReason,
  WebPushDeviceSummary,
  WebPushPlatform,
  WebPushSubscriptionsState
} from "@seo-platform/contracts";
import { useEffect, useMemo, useState } from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import {
  currentBrowserPushSubscription,
  enableBrowserPushSubscription,
  unsubscribeCurrentBrowserPush
} from "../lib/browser-push";
import {
  loadOrCreatePushInstallation,
  markPushReconciliation,
  PushInstallationStorageError,
  type PushInstallationRecord,
  rotatePushInstallationOwner
} from "../lib/push-installation";
import {
  currentWebPushDeviceReady,
  deriveBrowserPushViewState,
  detectWebPushFeatureSupport,
  type WebPushFeatureSupport,
  type WebPushUnsupportedReason,
  parseWebPushDeviceSummary,
  parseWebPushRevokeResult,
  parseWebPushSubscriptionsState,
  serializeWebPushRegistration,
  serializeWebPushRename,
  webPushDeviceNeedsReconciliation
} from "../lib/push-notifications";

const PUSH_SUBSCRIPTIONS_PATH = "/app/api/me/push-subscriptions";
const INITIAL_FEATURE_SUPPORT: WebPushFeatureSupport = {
  supported: false,
  reason: "NOT_IN_BROWSER"
};

type PushOperation =
  | { readonly kind: "registering" }
  | { readonly kind: "resetting" }
  | { readonly kind: "renaming"; readonly installationId: string }
  | { readonly kind: "revoking"; readonly installationId: string };

export function BrowserPushSettings({
  userId,
  webPushEnabled
}: Readonly<{
  userId: string;
  webPushEnabled: boolean;
}>) {
  const [state, setState] = useState<WebPushSubscriptionsState>();
  const [installation, setInstallation] =
    useState<PushInstallationRecord>();
  const [featureSupport, setFeatureSupport] =
    useState<WebPushFeatureSupport>(INITIAL_FEATURE_SUPPORT);
  const [ownerConflict, setOwnerConflict] = useState(false);
  const [localSubscription, setLocalSubscription] = useState(false);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<PushOperation>();
  const [error, setError] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);
  const [editingId, setEditingId] = useState<string>();
  const [labelDraft, setLabelDraft] = useState("");

  useEffect(() => {
    const updateNetworkState = () => setOnline(navigator.onLine);
    updateNetworkState();
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const support = detectWebPushFeatureSupport();
    setFeatureSupport(support);
    setLoading(true);
    setError(undefined);

    const loadServer = browserApiRequest<unknown>(
      PUSH_SUBSCRIPTIONS_PATH,
      { signal: controller.signal }
    ).then((value) => parseWebPushSubscriptionsState(value));
    const loadBrowser = support.supported
      ? Promise.all([
          loadOrCreatePushInstallation(userId),
          currentBrowserPushSubscription()
        ])
      : Promise.resolve(undefined);

    void Promise.allSettled([loadServer, loadBrowser]).then(
      ([serverResult, browserResult]) => {
        if (controller.signal.aborted) return;
        if (serverResult.status === "fulfilled") {
          setState(serverResult.value);
        } else {
          setError(pushErrorMessage(serverResult.reason));
        }
        if (browserResult.status === "fulfilled" && browserResult.value) {
          const [binding, subscription] = browserResult.value;
          setInstallation(binding.record);
          setOwnerConflict(binding.ownerConflict);
          setLocalSubscription(Boolean(subscription));
        } else if (browserResult.status === "rejected") {
          setError(pushErrorMessage(browserResult.reason));
        }
        setLoading(false);
      }
    );
    return () => controller.abort();
  }, [retryVersion, userId]);

  useEffect(() => {
    if (!featureSupport.supported) return;
    const onServiceWorkerMessage = (event: MessageEvent<unknown>) => {
      if (!isPushReconciliationMessage(event.data)) return;
      setInstallation((current) =>
        current ? { ...current, reconcileRequired: true } : current
      );
    };
    navigator.serviceWorker.addEventListener(
      "message",
      onServiceWorkerMessage
    );
    return () =>
      navigator.serviceWorker.removeEventListener(
        "message",
        onServiceWorkerMessage
      );
  }, [featureSupport.supported]);

  const currentDevice = useMemo(
    () =>
      installation
        ? state?.devices.find(
            (device) =>
              device.installationId === installation.installationId &&
              device.status === "ACTIVE"
          )
        : undefined,
    [installation, state?.devices]
  );
  const currentDeviceActive = currentWebPushDeviceReady(
    currentDevice,
    state?.registration,
    localSubscription,
    featureSupport.supported
      ? featureSupport.permission
      : undefined
  );
  const currentDeviceNeedsReconciliation = webPushDeviceNeedsReconciliation(
    currentDevice,
    state?.registration,
    installation?.reconcileRequired ?? false
  );
  const viewState = deriveBrowserPushViewState({
    loading,
    ...(state
      ? { registrationStatus: state.registration.status }
      : {}),
    featureSupport,
    ownerConflict,
    registering: operation?.kind === "registering",
    active: currentDeviceActive,
    online,
    hasError: Boolean(error)
  });

  async function registerCurrentBrowser(): Promise<void> {
    if (
      !state ||
      state.registration.status !== "AVAILABLE" ||
      !installation ||
      ownerConflict ||
      operation ||
      !online ||
      !featureSupport.supported
    ) {
      return;
    }
    setOperation({ kind: "registering" });
    setError(undefined);
    try {
      let permission = featureSupport.permission;
      if (permission === "default") {
        permission = await window.Notification.requestPermission();
        setFeatureSupport(detectWebPushFeatureSupport());
      }
      if (permission !== "granted") return;

      let targetInstallation = installation;
      const storedDevice = state.devices.find(
        ({ installationId }) =>
          installationId === installation.installationId
      );
      if (storedDevice && storedDevice.status !== "ACTIVE") {
        if (!(await unsubscribeCurrentBrowserPush())) {
          throw new Error(
            "Браузер не подтвердил обновление истёкшей подписки"
          );
        }
        targetInstallation = await rotatePushInstallationOwner(userId);
        setInstallation(targetInstallation);
        setLocalSubscription(false);
      }
      const subscription = await enableBrowserPushSubscription(
        state.registration.applicationServerKey
      );
      setLocalSubscription(true);
      const pending = await markPushReconciliation(
        userId,
        targetInstallation.installationId,
        true
      );
      setInstallation(pending);
      const rawDevice = await browserApiRequest<unknown>(
        `${PUSH_SUBSCRIPTIONS_PATH}/${encodeURIComponent(targetInstallation.installationId)}`,
        {
          method: "PUT",
          body: serializeWebPushRegistration({
            label: storedDevice?.label ?? "Этот браузер",
            intent:
              storedDevice?.status === "ACTIVE" ? "RECONCILE" : "ENABLE",
            applicationServerKeyVersion:
              state.registration.applicationServerKeyVersion,
            subscription
          })
        }
      );
      const device = parseWebPushDeviceSummary(rawDevice);
      setState((current) =>
        current ? withPushDevice(current, device) : current
      );
      setInstallation(
        await markPushReconciliation(
          userId,
          targetInstallation.installationId,
          false
        )
      );
    } catch (requestError) {
      if (
        requestError instanceof BrowserApiError &&
        requestError.code === "PUSH_SUBSCRIPTION_ALREADY_BOUND"
      ) {
        setOwnerConflict(true);
      }
      setError(pushErrorMessage(requestError));
    } finally {
      setOperation(undefined);
      setFeatureSupport(detectWebPushFeatureSupport());
    }
  }

  async function resetBrowserOwner(): Promise<void> {
    if (operation || !featureSupport.supported) return;
    if (
      !window.confirm(
        "Локальная push-подписка прежнего аккаунта будет удалена из этого браузера. Продолжить?"
      )
    ) {
      return;
    }
    setOperation({ kind: "resetting" });
    setError(undefined);
    try {
      if (!(await unsubscribeCurrentBrowserPush())) {
        throw new Error("Браузер не подтвердил удаление локальной подписки");
      }
      const record = await rotatePushInstallationOwner(userId);
      setInstallation(record);
      setOwnerConflict(false);
      setLocalSubscription(false);
    } catch (requestError) {
      setError(pushErrorMessage(requestError));
    } finally {
      setOperation(undefined);
    }
  }

  async function renameDevice(device: WebPushDeviceSummary): Promise<void> {
    if (operation) return;
    setOperation({ kind: "renaming", installationId: device.installationId });
    setError(undefined);
    try {
      const rawDevice = await browserApiRequest<unknown>(
        `${PUSH_SUBSCRIPTIONS_PATH}/${encodeURIComponent(device.installationId)}`,
        {
          method: "PATCH",
          ifMatch: device.version,
          body: serializeWebPushRename(labelDraft)
        }
      );
      const renamed = parseWebPushDeviceSummary(rawDevice);
      setState((current) =>
        current ? withPushDevice(current, renamed) : current
      );
      setEditingId(undefined);
      setLabelDraft("");
    } catch (requestError) {
      setError(pushErrorMessage(requestError));
      if (
        requestError instanceof BrowserApiError &&
        requestError.code === "VERSION_CONFLICT"
      ) {
        setRetryVersion((value) => value + 1);
      }
    } finally {
      setOperation(undefined);
    }
  }

  async function revokeDevice(device: WebPushDeviceSummary): Promise<void> {
    if (
      operation ||
      !window.confirm(`Отозвать устройство «${device.label}»?`)
    ) {
      return;
    }
    setOperation({ kind: "revoking", installationId: device.installationId });
    setError(undefined);
    const isCurrent =
      installation?.installationId === device.installationId;
    try {
      const rawResult = await browserApiRequest<unknown>(
        `${PUSH_SUBSCRIPTIONS_PATH}/${encodeURIComponent(device.installationId)}`,
        { method: "DELETE" }
      );
      parseWebPushRevokeResult(rawResult);

      const warnings: string[] = [];
      if (isCurrent && featureSupport.supported) {
        try {
          if (await unsubscribeCurrentBrowserPush()) {
            setLocalSubscription(false);
          } else {
            warnings.push(
              "Серверная подписка отозвана, но браузер не подтвердил локальное удаление."
            );
          }
        } catch {
          warnings.push(
            "Серверная подписка отозвана, но локальное удаление нужно повторить."
          );
        }
        try {
          const record = await rotatePushInstallationOwner(userId);
          setInstallation(record);
          setOwnerConflict(false);
        } catch {
          warnings.push(
            "Не удалось обновить локальный идентификатор; серверная подписка уже отозвана."
          );
        }
      }
      try {
        const refreshed = parseWebPushSubscriptionsState(
          await browserApiRequest<unknown>(PUSH_SUBSCRIPTIONS_PATH)
        );
        setState(refreshed);
      } catch {
        warnings.push(
          "Устройство отозвано, но список не обновился. Перезагрузите его повторно."
        );
      }
      setError(warnings.length ? warnings.join(" ") : undefined);
    } catch (requestError) {
      setError(pushErrorMessage(requestError));
    } finally {
      setOperation(undefined);
    }
  }

  if (!state && loading) {
    return (
      <section className="browser-push-card" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <p>Проверяем браузерные устройства…</p>
      </section>
    );
  }
  if (!state) {
    return (
      <section className="browser-push-card" aria-labelledby="browser-push-title">
        <header className="browser-push-heading">
          <div>
            <h3 id="browser-push-title">Браузерные устройства</h3>
            <p>Список устройств временно недоступен.</p>
          </div>
        </header>
        <div className="browser-push-error inline-alert danger" role="alert">
          <span>{error ?? "Не удалось загрузить состояние Web Push."}</span>
          <button
            className="inline-alert-action"
            onClick={() => setRetryVersion((value) => value + 1)}
            type="button"
          >
            Повторить
          </button>
        </div>
      </section>
    );
  }

  const activeDevices =
    state.devices.filter(({ status }) => status === "ACTIVE").length;
  return (
    <section className="browser-push-card" aria-labelledby="browser-push-title">
      <header className="browser-push-heading">
        <div>
          <h3 id="browser-push-title">Браузерные устройства</h3>
          <p>
            Подписка относится к аккаунту и конкретному профилю браузера.
            Секреты устройства в интерфейсе не отображаются.
          </p>
        </div>
        <span className="browser-push-limit">
          {activeDevices} / {state.registration.maxActiveDevices}
        </span>
      </header>

      {!webPushEnabled && (
        <div className="inline-alert warning compact">
          Глобальный Browser Push выключен. Устройства сохранятся, но канал
          останется приостановлен после подключения доставки.
        </div>
      )}
      {!online && (
        <div className="inline-alert warning compact" role="status">
          Нет сети. Список сохранён на экране, новые операции станут доступны
          после восстановления соединения.
        </div>
      )}
      {error && (
        <div className="browser-push-error inline-alert danger compact" role="alert">
          <span>{error}</span>
          <button
            className="inline-alert-action"
            onClick={() => setRetryVersion((value) => value + 1)}
            type="button"
          >
            Повторить
          </button>
        </div>
      )}

      <BrowserPushCurrentState
        featureSupport={featureSupport}
        onRegister={() => {
          if (installation) {
            void registerCurrentBrowser();
          } else {
            setRetryVersion((value) => value + 1);
          }
        }}
        onRefresh={() => setRetryVersion((value) => value + 1)}
        onResetOwner={() => void resetBrowserOwner()}
        operation={operation}
        reconcileRequired={currentDeviceNeedsReconciliation}
        viewState={viewState}
      />

      {state.devices.length ? (
        <ul className="browser-device-list">
          {state.devices.map((device) => {
            const current =
              installation?.installationId === device.installationId;
            const deviceBusy =
              operation &&
              "installationId" in operation &&
              operation.installationId === device.installationId;
            return (
              <li className="browser-device-row" key={device.installationId}>
                <div className="browser-device-copy">
                  <div>
                    <strong>{device.label}</strong>
                    {current && <span className="current-device-badge">Текущий</span>}
                    <DeviceStatus status={device.status} />
                  </div>
                  <small>
                    {browserLabel(device.browser)} ·{" "}
                    {platformLabel(device.platform)} ·{" "}
                    {deliveryDescription(device)}
                  </small>
                  {device.statusReason && (
                    <small>{statusReasonLabel(device.statusReason)}</small>
                  )}
                </div>
                {editingId === device.installationId ? (
                  <form
                    className="browser-device-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameDevice(device);
                    }}
                  >
                    <label>
                      <span className="visually-hidden">Название устройства</span>
                      <input
                        autoFocus
                        disabled={Boolean(operation)}
                        maxLength={80}
                        onChange={(event) => setLabelDraft(event.target.value)}
                        value={labelDraft}
                      />
                    </label>
                    <button
                      className="text-button"
                      disabled={Boolean(operation)}
                      type="submit"
                    >
                      {deviceBusy ? "Сохраняем…" : "Сохранить"}
                    </button>
                    <button
                      className="text-button"
                      disabled={Boolean(operation)}
                      onClick={() => {
                        setEditingId(undefined);
                        setLabelDraft("");
                      }}
                      type="button"
                    >
                      Отмена
                    </button>
                  </form>
                ) : (
                  <div className="browser-device-actions">
                    {device.status === "ACTIVE" && (
                      <>
                        <button
                          className="text-button"
                          disabled={Boolean(operation) || !online}
                          onClick={() => {
                            setEditingId(device.installationId);
                            setLabelDraft(device.label);
                          }}
                          type="button"
                        >
                          Переименовать
                        </button>
                        <button
                          className="text-button danger-text"
                          disabled={Boolean(operation) || !online}
                          onClick={() => void revokeDevice(device)}
                          type="button"
                        >
                          {deviceBusy ? "Отзываем…" : "Отозвать"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="browser-device-empty">
          <strong>Нет зарегистрированных браузеров</strong>
          <p>
            Подключение начинается только после явного нажатия кнопки выше.
          </p>
        </div>
      )}

      <div className="browser-push-test">
        <button
          className="secondary-button"
          disabled
          title="Доставка будет доступна после подключения защищённого delivery-адаптера"
          type="button"
        >
          Отправить тест
        </button>
        <small>
          Тестовая и рабочая доставка пока не включены на сервере. Регистрация
          устройства только безопасно подготавливает канал.
        </small>
      </div>
    </section>
  );
}

function BrowserPushCurrentState({
  featureSupport,
  onRefresh,
  onRegister,
  onResetOwner,
  operation,
  reconcileRequired,
  viewState
}: Readonly<{
  featureSupport: WebPushFeatureSupport;
  onRefresh: () => void;
  onRegister: () => void;
  onResetOwner: () => void;
  operation: PushOperation | undefined;
  reconcileRequired: boolean;
  viewState: ReturnType<typeof deriveBrowserPushViewState>;
}>) {
  if (viewState === "LOADING") {
    return (
      <div className="browser-push-current" aria-busy="true">
        <span className="spinner" />
        <span>Проверяем текущее устройство…</span>
      </div>
    );
  }
  if (viewState === "SERVER_DISABLED") {
    return (
      <div className="inline-alert warning">
        Регистрация Web Push отключена на сервере: VAPID и защищённое хранилище
        ещё не настроены.
      </div>
    );
  }
  if (viewState === "UNSUPPORTED") {
    return (
      <div className="inline-alert warning">
        {unsupportedReasonMessage(
          featureSupport.supported
            ? "NOT_IN_BROWSER"
            : featureSupport.reason
        )}
      </div>
    );
  }
  if (viewState === "OWNER_CONFLICT") {
    return (
      <div className="browser-push-current conflict">
        <div>
          <strong>Этот браузер привязан к другому аккаунту</strong>
          <p>
            Мы не переносим endpoint между аккаунтами автоматически. Сначала
            удалите локальную подписку прежнего аккаунта.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={Boolean(operation)}
          onClick={onResetOwner}
          type="button"
        >
          {operation?.kind === "resetting"
            ? "Подготавливаем…"
            : "Использовать текущий аккаунт"}
        </button>
      </div>
    );
  }
  if (viewState === "PERMISSION_DENIED") {
    return (
      <div className="browser-push-current conflict">
        <div>
          <strong>Уведомления запрещены в браузере</strong>
          <p>
            Разрешите их для этого сайта вручную. Повторный системный prompt
            приложение не вызывает.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={Boolean(operation)}
          onClick={onRefresh}
          type="button"
        >
          Проверить снова
        </button>
      </div>
    );
  }
  if (viewState === "ACTIVE") {
    return (
      <div className="browser-push-current active">
        <div>
          <strong>Текущий браузер зарегистрирован</strong>
          <p>
            {reconcileRequired
              ? "Service Worker сообщил об изменении подписки — нужна безопасная синхронизация."
              : "Локальная подписка совпадает с активным серверным устройством."}
          </p>
        </div>
        {reconcileRequired && (
          <button
            className="secondary-button"
            disabled={Boolean(operation)}
            onClick={onRegister}
            type="button"
          >
            {operation?.kind === "registering"
              ? "Синхронизируем…"
              : "Синхронизировать"}
          </button>
        )}
      </div>
    );
  }

  const registering = viewState === "REGISTERING";
  const copy = browserPushCurrentCopy(viewState, reconcileRequired);
  return (
    <div className="browser-push-current">
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.description}</p>
      </div>
      <button
        className="secondary-button"
        disabled={Boolean(operation) || viewState === "OFFLINE"}
        onClick={onRegister}
        type="button"
      >
        {registering
          ? reconcileRequired
            ? "Синхронизируем…"
            : "Подключаем…"
          : copy.action}
      </button>
    </div>
  );
}

function browserPushCurrentCopy(
  viewState: ReturnType<typeof deriveBrowserPushViewState>,
  reconcileRequired: boolean
): {
  readonly title: string;
  readonly description: string;
  readonly action: string;
} {
  if (reconcileRequired) {
    return {
      title: "Требуется синхронизация ключа",
      description:
        "Браузер обновит локальную подписку и безопасно передаст новую версию серверу.",
      action: "Синхронизировать"
    };
  }
  if (viewState === "OFFLINE") {
    return {
      title: "Подключение ждёт сеть",
      description:
        "Повторная попытка использует существующую локальную подписку и не создаёт дубль.",
      action: "Подключить этот браузер"
    };
  }
  if (viewState === "ERROR") {
    return {
      title: "Подключение не завершено",
      description:
        "Повторная попытка использует существующую локальную подписку и не создаёт дубль.",
      action: "Повторить подключение"
    };
  }
  if (viewState === "REGISTERING") {
    return {
      title: "Подключаем текущий браузер",
      description:
        "Service Worker создаёт локальную подписку, затем сервер сохранит её защищённо.",
      action: "Подключаем…"
    };
  }
  if (viewState === "PERMISSION_DEFAULT") {
    return {
      title: "Разрешение ещё не запрашивалось",
      description:
        "Браузер покажет системный запрос только после нажатия кнопки.",
      action: "Подключить этот браузер"
    };
  }
  return {
    title: "Разрешение есть, подписки нет",
    description:
      "Повторная попытка использует существующую локальную подписку и не создаёт дубль.",
    action: "Подключить этот браузер"
  };
}

function DeviceStatus({
  status
}: Readonly<{ status: WebPushDeviceStatus }>) {
  return (
    <span className={`browser-device-status ${status.toLowerCase()}`}>
      {status === "ACTIVE"
        ? "Активно"
        : status === "EXPIRED"
          ? "Истекло"
          : "Отозвано"}
    </span>
  );
}

function withPushDevice(
  state: WebPushSubscriptionsState,
  device: WebPushDeviceSummary
): WebPushSubscriptionsState {
  return {
    ...state,
    devices: [
      device,
      ...state.devices.filter(
        ({ installationId }) => installationId !== device.installationId
      )
    ]
  };
}

function deliveryDescription(device: WebPushDeviceSummary): string {
  if (device.status === "EXPIRED" && device.expiredAt) {
    return `истекло ${formatTimestamp(device.expiredAt)}`;
  }
  if (device.status === "REVOKED" && device.revokedAt) {
    return `отозвано ${formatTimestamp(device.revokedAt)}`;
  }
  if (device.lastDeliveryStatus === "DELIVERED" && device.lastDeliveryAt) {
    return `доставлено ${formatTimestamp(device.lastDeliveryAt)}`;
  }
  if (device.lastDeliveryStatus === "FAILED" && device.lastDeliveryAt) {
    return `ошибка ${formatTimestamp(device.lastDeliveryAt)}`;
  }
  return `добавлено ${formatTimestamp(device.createdAt)}`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function browserLabel(value: WebPushBrowser): string {
  const labels: Readonly<Record<WebPushBrowser, string>> = {
    CHROME: "Chrome",
    EDGE: "Edge",
    FIREFOX: "Firefox",
    OPERA: "Opera",
    SAFARI: "Safari",
    OTHER: "Другой браузер"
  };
  return labels[value];
}

function platformLabel(value: WebPushPlatform): string {
  const labels: Readonly<Record<WebPushPlatform, string>> = {
    ANDROID: "Android",
    CHROMEOS: "ChromeOS",
    IOS: "iOS",
    LINUX: "Linux",
    MACOS: "macOS",
    WINDOWS: "Windows",
    OTHER: "Другая система"
  };
  return labels[value];
}

function statusReasonLabel(value: WebPushDeviceStatusReason): string {
  const labels: Readonly<Record<WebPushDeviceStatusReason, string>> = {
    USER_REVOKED: "Устройство отозвано пользователем.",
    SESSION_REVOKED: "Семейство сессий было завершено.",
    PERMISSION_REVOKED: "Разрешение браузера было отозвано.",
    PUSH_SERVICE_GONE: "Push-сервис сообщил, что подписка больше не существует.",
    ACCOUNT_CHANGED: "Подписка отключена после смены аккаунта."
  };
  return labels[value];
}

function unsupportedReasonMessage(value: WebPushUnsupportedReason): string {
  const messages: Readonly<Record<WebPushUnsupportedReason, string>> = {
    NOT_IN_BROWSER: "Web Push доступен только в браузере.",
    INSECURE_CONTEXT:
      "Web Push требует HTTPS. На локальной машине используйте безопасный localhost.",
    NOTIFICATION_UNSUPPORTED:
      "Этот браузер не поддерживает системные уведомления.",
    SERVICE_WORKER_UNSUPPORTED:
      "Этот браузер не поддерживает Service Worker.",
    PUSH_MANAGER_UNSUPPORTED:
      "Этот браузер не поддерживает стандарт Web Push."
  };
  return messages[value];
}

function pushErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    const messages: Readonly<Record<string, string>> = {
      VAPID_KEY_VERSION_CHANGED:
        "Ключ регистрации изменился. Обновите состояние и подключите браузер снова.",
      PUSH_SUBSCRIPTION_ALREADY_BOUND:
        "Эта локальная подписка уже принадлежит другому аккаунту.",
      PUSH_DEVICE_LIMIT_REACHED:
        "Достигнут лимит активных браузеров. Отзовите ненужное устройство.",
      EXPLICIT_ENABLE_REQUIRED:
        "Сервер требует явного повторного подключения этого браузера.",
      VERSION_CONFLICT:
        "Устройство изменилось в другой вкладке. Список будет обновлён.",
      WEB_PUSH_UNAVAILABLE:
        "Регистрация Web Push временно недоступна на сервере.",
      REAUTHENTICATION_REQUIRED:
        "Для подключения браузера подтвердите вход ещё раз."
    };
    return messages[error.code] ?? error.message;
  }
  if (error instanceof PushInstallationStorageError) return error.message;
  if (error instanceof Error) return error.message;
  return "Не удалось обновить браузерные устройства.";
}

function isPushReconciliationMessage(
  value: unknown
): value is { readonly type: "WEB_PUSH_RECONCILE_REQUIRED"; readonly version: 1 } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    "type" in value &&
    value.type === "WEB_PUSH_RECONCILE_REQUIRED" &&
    "version" in value &&
    value.version === 1
  );
}
