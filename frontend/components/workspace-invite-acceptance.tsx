"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  fragmentFreeBrowserPath,
  readOneTimeTokenFragment
} from "../lib/one-time-link";
import {
  acceptedWorkspaceInviteMember,
  workspaceInviteFailurePhase,
  type WorkspaceInviteFailurePhase
} from "../lib/team-management";
import { UiText } from "./ui-locale";


type AcceptancePhase =
  | "loading"
  | "accepted"
  | WorkspaceInviteFailurePhase;

const STORAGE_KEY = "pending-workspace-invite-token";
const RETURN_TO = "/app/workspace-invites/accept";

export function WorkspaceInviteAcceptance() {
  const [phase, setPhase] = useState<AcceptancePhase>("loading");
  const automaticAcceptanceStarted = useRef(false);
  const acceptanceInFlight = useRef(false);

  const accept = useCallback(async (token: string): Promise<void> => {
    if (acceptanceInFlight.current) return;
    acceptanceInFlight.current = true;
    setPhase("loading");
    try {
      const result = await browserApiRequest<unknown>(
        "/app/api/workspace-invites/accept",
        {
          method: "POST",
          body: { token }
        }
      );
      acceptedWorkspaceInviteMember(result);
      sessionStorage.removeItem(STORAGE_KEY);
      setPhase("accepted");
    } catch (error) {
      if (error instanceof BrowserApiError) {
        const failurePhase = workspaceInviteFailurePhase(error);
        if (failurePhase === "invalid") {
          sessionStorage.removeItem(STORAGE_KEY);
        }
        setPhase(failurePhase);
        return;
      }
      setPhase("error");
    } finally {
      acceptanceInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const fragment = readOneTimeTokenFragment(window.location.hash);
    if (fragment.shouldScrub) {
      window.history.replaceState(
        null,
        "",
        fragmentFreeBrowserPath(window.location)
      );
    }
    const storedToken = sessionStorage.getItem(STORAGE_KEY);
    const token = fragment.token || storedToken;
    if (fragment.token) {
      sessionStorage.setItem(STORAGE_KEY, fragment.token);
    }
    if (!token) {
      setPhase("invalid");
      return;
    }
    if (!automaticAcceptanceStarted.current) {
      automaticAcceptanceStarted.current = true;
      void accept(token);
    }
  }, [accept]);

  if (phase === "loading") {
    return (
      <div className="auth-form" aria-busy="true">
        <div className="inline-alert" role="status">
          <UiText text="Проверяем приглашение…" /></div>
      </div>
    );
  }

  if (phase === "accepted") {
    return (
      <div className="auth-form">
        <div className="inline-alert success" role="status">
          <UiText text="Приглашение принято. Рабочая область уже доступна в приложении." /></div>
        <a className="primary-button auth-submit" href="/app">
          <UiText text="Открыть рабочую область" /></a>
      </div>
    );
  }

  if (phase === "authentication-required") {
    const encodedReturnTo = encodeURIComponent(RETURN_TO);
    return (
      <div className="auth-form">
        <div className="inline-alert warning" role="status">
          <UiText text="Войдите или создайте аккаунт с адресом, на который пришло приглашение. Ссылка сохранена только в этой вкладке." /></div>
        <a
          className="primary-button auth-submit"
          href={`/app/login?returnTo=${encodedReturnTo}`}
        >
          <UiText text="Войти" /></a>
        <a
          className="secondary-button auth-submit"
          href={`/app/register?returnTo=${encodedReturnTo}`}
        >
          <UiText text="Создать аккаунт" /></a>
      </div>
    );
  }

  if (phase === "verification-required") {
    return (
      <div className="auth-form">
        <div className="inline-alert warning" role="status">
          <UiText text="Сначала подтвердите email аккаунта, затем вернитесь к приглашению." /></div>
        <a
          className="primary-button auth-submit"
          href={`/app/verify-email?returnTo=${encodeURIComponent(RETURN_TO)}`}
        >
          <UiText text="Подтвердить email" /></a>
      </div>
    );
  }

  if (phase === "account-mismatch") {
    return (
      <div className="auth-form">
        <div className="inline-alert warning" role="status">
          <UiText text="Приглашение отправлено на другой подтверждённый email. Проверьте текущий аккаунт или выйдите и войдите под нужным адресом. Ссылка сохранена только в этой вкладке." /></div>
        <a className="primary-button auth-submit" href="/app/settings/security">
          <UiText text="Проверить аккаунт" /></a>
      </div>
    );
  }

  if (phase === "workspace-unavailable") {
    return (
      <div className="auth-form">
        <div className="inline-alert warning" role="status">
          <UiText text="Рабочая область сейчас не принимает приглашения. Обратитесь к администратору или повторите позже." /></div>
        <button
          className="primary-button auth-submit"
          onClick={() => {
            const token = sessionStorage.getItem(STORAGE_KEY);
            if (token) void accept(token);
            else setPhase("invalid");
          }}
          type="button"
        >
          <UiText text="Повторить" /></button>
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="auth-form">
        <div className="inline-alert danger" role="alert">
          <UiText text="Приглашение недействительно, отозвано, уже использовано или просрочено. Попросите администратора отправить новое." /></div>
        <a className="secondary-button auth-submit" href="/app">
          <UiText text="Перейти в приложение" /></a>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <div className="inline-alert danger" role="alert">
        <UiText text="Не удалось проверить приглашение. Проверьте соединение и повторите." /></div>
      <button
        className="primary-button auth-submit"
        onClick={() => {
          const token = sessionStorage.getItem(STORAGE_KEY);
          if (token) void accept(token);
          else setPhase("invalid");
        }}
        type="button"
      >
        <UiText text="Повторить" /></button>
    </div>
  );
}
