"use client";

import type { UserSessionSummary } from "@seo-platform/contracts";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  formatSessionActivity,
  formatSessionDate,
  loadAllUserSessions,
  parseRevokedSessionCount,
  REVOKED_SESSION_LOGIN_PATH,
  REVOKE_OTHER_SESSIONS_PATH,
  sessionDevicePresentation,
  sessionIpLabel,
  sessionListAuthenticationRedirect,
  sessionListHealth,
  sessionLocationLabel,
  sessionRequestErrorMessage,
  sessionRevocationSucceeded,
  sessionRevokePath,
  sessionSettingsViewState,
  withoutOtherSessions,
  withoutRevokedSession
} from "../lib/session-management";
import { UiText, useUiLocale } from "./ui-locale";


type RevokeIntent =
  | {
      readonly kind: "session";
      readonly session: UserSessionSummary;
    }
  | {
      readonly kind: "others";
      readonly count: number;
    };

const SESSION_PAGE_SIZE = 10;

export function SessionSettings() {
  const { t: uiText } = useUiLocale();
  const [sessions, setSessions] =
    useState<readonly UserSessionSummary[]>();
  const sessionsRef = useRef<readonly UserSessionSummary[] | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [operation, setOperation] = useState<string>();
  const operationRef = useRef<string | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<RevokeIntent>();
  const [reloadVersion, setReloadVersion] = useState(0);
  const [page, setPage] = useState(1);
  const lastFocusedElement = useRef<HTMLElement | null>(null);
  const wasOffline = useRef(false);

  useEffect(() => {
    const updateNetworkState = () => {
      const nextOnline = navigator.onLine;
      setOnline(nextOnline);
      if (wasOffline.current && nextOnline) {
        setReloadVersion((value) => value + 1);
      }
      wasOffline.current = !nextOnline;
    };
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
    setLoading(true);
    setLoadError(undefined);
    setOperationError(undefined);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setLoading(false);
      setLoadError("Нет подключения к интернету.");
      return () => controller.abort();
    }

    void loadAllUserSessions({ signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        updateSessions(result);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || isAbortError(requestError)) return;
        const authenticationRedirect =
          sessionListAuthenticationRedirect(requestError);
        if (authenticationRedirect) {
          window.location.replace(authenticationRedirect);
          return;
        }
        setLoadError(
          sessionRequestErrorMessage(
            requestError,
            "Не удалось загрузить активные сессии."
          )
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadVersion]);

  const sessionHealth = sessions ? sessionListHealth(sessions) : undefined;
  const viewState = sessionSettingsViewState({
    sessions,
    loading,
    online,
    hasLoadError: Boolean(loadError)
  });
  const otherSessionCount =
    sessions?.filter(({ current }) => !current).length ?? 0;
  const degraded = viewState === "DEGRADED";
  const pageCount = Math.max(
    1,
    Math.ceil((sessions?.length ?? 0) / SESSION_PAGE_SIZE)
  );
  const visibleSessions = sessions?.slice(
    (page - 1) * SESSION_PAGE_SIZE,
    page * SESSION_PAGE_SIZE
  );

  function updateSessions(next: readonly UserSessionSummary[]): void {
    sessionsRef.current = next;
    setSessions(next);
    setPage((current) =>
      Math.min(
        current,
        Math.max(1, Math.ceil(next.length / SESSION_PAGE_SIZE))
      )
    );
  }

  function retry(): void {
    if (!online || loading) return;
    setReloadVersion((value) => value + 1);
  }

  function requestConfirmation(intent: RevokeIntent): void {
    if (operationRef.current || !online) return;
    lastFocusedElement.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setOperationError(undefined);
    setNotice(undefined);
    setConfirmation(intent);
  }

  function closeConfirmation(): void {
    if (operationRef.current) return;
    setConfirmation(undefined);
    setOperationError(undefined);
    window.setTimeout(() => lastFocusedElement.current?.focus(), 0);
  }

  async function confirmRevocation(): Promise<void> {
    if (!confirmation || operationRef.current) return;
    if (!online) {
      setOperationError(
        "Нет подключения. Восстановите сеть и повторите попытку."
      );
      return;
    }

    const operationKey =
      confirmation.kind === "others"
        ? "others"
        : confirmation.session.id;
    operationRef.current = operationKey;
    setOperation(operationKey);
    setOperationError(undefined);
    setNotice(undefined);

    let idempotentReplay = false;
    let revokedCount: number | undefined;
    try {
      if (confirmation.kind === "others") {
        revokedCount = parseRevokedSessionCount(
          await browserApiRequest<unknown>(
            REVOKE_OTHER_SESSIONS_PATH,
            { method: "DELETE" }
          )
        );
      } else {
        await browserApiRequest<void>(
          sessionRevokePath(confirmation.session.id),
          { method: "DELETE" }
        );
      }
    } catch (requestError) {
      if (sessionRevocationSucceeded(requestError)) {
        idempotentReplay = true;
      } else {
        if (
          requestError instanceof BrowserApiError &&
          requestError.status === 401
        ) {
          window.location.replace(REVOKED_SESSION_LOGIN_PATH);
          return;
        }
        setOperationError(
          sessionRequestErrorMessage(
            requestError,
            "Не удалось завершить сессию."
          )
        );
        return;
      }
    } finally {
      operationRef.current = undefined;
      setOperation(undefined);
    }

    if (confirmation.kind === "session") {
      const revokedSession = confirmation.session;
      updateSessions(
        withoutRevokedSession(
          sessionsRef.current ?? [],
          revokedSession.id
        )
      );
      setConfirmation(undefined);
      if (revokedSession.current) {
        window.location.replace(REVOKED_SESSION_LOGIN_PATH);
        return;
      }
      setNotice(
        idempotentReplay
          ? "Сессия уже была завершена."
          : "Сессия завершена."
      );
    } else {
      updateSessions(
        withoutOtherSessions(sessionsRef.current ?? [])
      );
      setConfirmation(undefined);
      setNotice(
        idempotentReplay
          ? "Другие сессии уже были завершены."
          : revokedCount === 0
            ? "Других активных сессий уже не было."
            : `Завершено сессий: ${revokedCount ?? confirmation.count}.`
      );
    }
    setReloadVersion((value) => value + 1);
  }

  return (
    <section
      aria-busy={loading}
      aria-labelledby="active-sessions-heading"
      className="panel security-card session-card"
    >
      <header className="security-card-header session-card-heading">
        <div>
          <h2 id="active-sessions-heading"><UiText text="Активные сессии" /></h2>
          <p>
            <UiText text="Проверьте устройства, с которых выполнен вход, и завершите незнакомые сессии." /></p>
        </div>
        <div className="session-heading-actions">
          {loading && sessions !== undefined && (
            <span
              aria-label={uiText("Обновляем список")}
              className="spinner compact"
              role="status"
            />
          )}
          <button
            className="secondary-button"
            disabled={
              otherSessionCount === 0 ||
              !online ||
              loading ||
              Boolean(operation) ||
              sessionHealth !== "READY"
            }
            onClick={() =>
              requestConfirmation({
                kind: "others",
                count: otherSessionCount
              })
            }
            type="button"
          >
            <UiText text="Завершить другие" /></button>
        </div>
      </header>

      {!online && (
        <div className="inline-alert warning session-alert" role="status">
          <span>
            <UiText text="Нет подключения. Список может быть устаревшим, а завершение сессий временно недоступно." /></span>
          <button
            className="inline-alert-action"
            disabled
            type="button"
          >
            <UiText text="Повторить после подключения" /></button>
        </div>
      )}

      {degraded && loadError && online && (
        <div className="inline-alert warning session-alert" role="status">
          <span>
            {<UiText text={loadError ?? ""} />} <UiText text="Показаны последние полученные данные." before=" " /></span>
          <button
            className="inline-alert-action"
            disabled={loading}
            onClick={retry}
            type="button"
          >
            {loading ? <UiText text="Обновляем…" /> : <UiText text="Повторить" />}
          </button>
        </div>
      )}

      {sessionHealth === "CURRENT_SESSION_MISSING" && (
        <div className="inline-alert warning" role="status">
          <UiText text="Текущая сессия не отмечена в ответе сервера. Не выполняйте массовое завершение, пока список не обновится." /></div>
      )}

      {operationError && !confirmation && (
        <div className="inline-alert danger session-alert" role="alert">
          <span>{<UiText text={operationError ?? ""} />}</span>
          <button
            className="inline-alert-action"
            onClick={() => setOperationError(undefined)}
            type="button"
          >
            <UiText text="Закрыть" /></button>
        </div>
      )}

      {notice && (
        <div className="inline-alert success" role="status">
          {<UiText text={notice ?? ""} />}
        </div>
      )}

      {viewState === "LOADING" ? (
        <div className="session-loading" role="status">
          <span className="spinner" />
          <div>
            <strong><UiText text="Загружаем активные сессии…" /></strong>
            <p><UiText text="Проверяем устройства и время последней активности." /></p>
          </div>
        </div>
      ) : sessions === undefined ? (
        <div className="panel-empty compact session-empty">
          <span aria-hidden="true" className="state-icon">
            !
          </span>
          <strong>
            {online
              ? <UiText text="Не удалось загрузить сессии" />
              : <UiText text="Список недоступен без сети" />}
          </strong>
          <p>
            {loadError ??
              <UiText text="Обновите список. Данные входа не сохранены в браузере." />}
          </p>
          <button
            className="primary-button"
            disabled={!online || loading}
            onClick={retry}
            type="button"
          >
            {loading ? <UiText text="Загружаем…" /> : <UiText text="Повторить" />}
          </button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="panel-empty compact session-empty">
          <span aria-hidden="true" className="state-icon">
            0
          </span>
          <strong><UiText text="Активные сессии не найдены" /></strong>
          <p>
            <UiText text="Это нетипично для открытой защищённой страницы. Обновите список или войдите в аккаунт заново." /></p>
          <button
            className="secondary-button"
            disabled={!online || loading}
            onClick={retry}
            type="button"
          >
            <UiText text="Обновить" /></button>
        </div>
      ) : (
        <ul className="session-list">
          {visibleSessions?.map((session) => (
            <SessionRow
              busy={operation === session.id}
              disabled={Boolean(operation)}
              key={session.id}
              onRevoke={() =>
                requestConfirmation({ kind: "session", session })
              }
              online={online}
              session={session}
            />
          ))}
        </ul>
      )}

      {sessions && sessions.length > 0 && (
        <nav className="session-pagination" aria-label={uiText("Страницы сессий")}>
          <span>
            {Math.min((page - 1) * SESSION_PAGE_SIZE + 1, sessions.length)}–
            {Math.min(page * SESSION_PAGE_SIZE, sessions.length)} <UiText text="из" before=" " after=" " />{sessions.length}
          </span>
          <div>
            <button
              aria-label={uiText("Предыдущая страница сессий")}
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              type="button"
            >
              ←
            </button>
            <strong>{page} / {pageCount}</strong>
            <button
              aria-label={uiText("Следующая страница сессий")}
              className="secondary-button"
              disabled={page >= pageCount}
              onClick={() =>
                setPage((value) => Math.min(pageCount, value + 1))
              }
              type="button"
            >
              →
            </button>
          </div>
        </nav>
      )}

      <footer className="session-privacy-note">
        <strong><UiText text="О данных устройства" /></strong>
        <p>
          <UiText text="Здесь показаны устройства, с которых выполнен вход в ваш аккаунт. Если вы не узнаёте устройство, завершите его сессию и измените пароль. IP-адрес может отличаться при использовании VPN." /></p>
      </footer>

      {confirmation && (
        <SessionConfirmation
          busy={operation !== undefined}
          error={operationError}
          intent={confirmation}
          offline={!online}
          onCancel={closeConfirmation}
          onConfirm={() => void confirmRevocation()}
        />
      )}
    </section>
  );
}

function SessionRow({
  busy,
  disabled,
  online,
  session,
  onRevoke
}: Readonly<{
  busy: boolean;
  disabled: boolean;
  online: boolean;
  session: UserSessionSummary;
  onRevoke: () => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const device = sessionDevicePresentation(session.userAgent);
  return (
    <li className={session.current ? "session-row current" : "session-row"}>
      <span
        aria-hidden="true"
        className={`session-device-mark ${device.kind}`}
      >
        {device.monogram}
      </span>
      <div className="session-row-copy">
        <div className="session-row-title">
          <strong>{device.title.split(" · ").map(part => uiText(part)).join(" · ")}</strong>
          {session.current && (
            <span className="security-status on"><UiText text="Текущая" /></span>
          )}
        </div>
        <dl className="session-metadata">
          <div>
            <dt><UiText text="Активность" /></dt>
            <dd>
              <time dateTime={session.lastUsedAt}>
                <UiText text={formatSessionActivity(session.lastUsedAt, undefined, uiLocale)} />
              </time>
            </dd>
          </div>
          <div>
            <dt><UiText text="Вход" /></dt>
            <dd>
              <time dateTime={session.authenticatedAt}>
                {formatSessionDate(session.authenticatedAt, uiLocale)}
              </time>
            </dd>
          </div>
          <div>
            <dt><UiText text="Сессия действует до" /></dt>
            <dd>
              <time dateTime={session.expiresAt}>
                {formatSessionDate(session.expiresAt, uiLocale)}
              </time>
            </dd>
          </div>
        </dl>
        <div className="session-network-metadata">
          <span>{<UiText text={sessionIpLabel(session.ipAddress) ?? ""} />}</span>
          <span>{<UiText text={sessionLocationLabel() ?? ""} />}</span>
        </div>
      </div>
      <button
        aria-label={uiText("Завершить сессию: {0}{1}", [String(device.title), String(session.current ? ", текущая" : "")])}
        className={session.current ? "danger-button" : "secondary-button"}
        disabled={!online || disabled}
        onClick={onRevoke}
        type="button"
      >
        {busy
          ? <UiText text="Завершаем…" />
          : session.current
            ? <UiText text="Выйти здесь" />
            : <UiText text="Завершить" />}
      </button>
    </li>
  );
}

function SessionConfirmation({
  busy,
  error,
  intent,
  offline,
  onCancel,
  onConfirm
}: Readonly<{
  busy: boolean;
  error: string | undefined;
  intent: RevokeIntent;
  offline: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const current =
    intent.kind === "session" && intent.session.current;
  const title = current
    ? "Завершить текущую сессию?"
    : intent.kind === "others"
      ? "Завершить все другие сессии?"
      : "Завершить выбранную сессию?";
  const description = current
    ? "Вы выйдете из аккаунта на этом устройстве и будете перенаправлены на страницу входа."
    : intent.kind === "others"
      ? `Будут завершены все другие активные сессии (${intent.count}). Текущая сессия останется активной.`
      : `Вход на устройстве «${sessionDevicePresentation(intent.session.userAgent).title}» будет завершён.`;

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelButton.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled)"
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="session-dialog-backdrop">
      <div
        aria-describedby="session-confirmation-description"
        aria-labelledby="session-confirmation-title"
        aria-modal="true"
        className="session-dialog"
        onKeyDown={trapFocus}
        ref={dialog}
        role="alertdialog"
      >
        <span aria-hidden="true" className="session-dialog-mark">
          !
        </span>
        <div>
          <h3 id="session-confirmation-title"><UiText text={title} /></h3>
          <p id="session-confirmation-description"><UiText text={description} /></p>
        </div>
        {error && (
          <div className="inline-alert danger session-dialog-error" role="alert">
            {<UiText text={error ?? ""} />}
          </div>
        )}
        {!error && offline && (
          <div className="inline-alert warning session-dialog-error" role="status">
            <UiText text="Нет подключения. Отмените действие или повторите его после восстановления сети." /></div>
        )}
        <div className="session-dialog-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
            ref={cancelButton}
            type="button"
          >
            <UiText text="Отмена" /></button>
          <button
            className="danger-button"
            disabled={busy || offline}
            onClick={onConfirm}
            type="button"
          >
            {busy ? <UiText text="Завершаем…" /> : current ? <UiText text="Выйти" /> : <UiText text="Завершить" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
