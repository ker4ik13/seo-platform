"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AppUser } from "../lib/app-types";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { Icon } from "./icon";
import { UserAvatar } from "./user-avatar";

const AVATAR_MAX_BYTES = 512 * 1_024;
const AVATAR_SOURCE_MAX_BYTES = 10 * 1_024 * 1_024;

type ProfileOperation = "avatar-upload" | "avatar-delete" | "password";

export function AccountSecurityProfile({
  user
}: Readonly<{ user: AppUser }>) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(user);
  const [operation, setOperation] = useState<ProfileOperation>();
  const [avatarError, setAvatarError] = useState<string>();
  const [avatarNotice, setAvatarNotice] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [passwordNotice, setPasswordNotice] = useState<string>();

  async function uploadAvatar(file: File | undefined): Promise<void> {
    if (!file || operation) return;
    setOperation("avatar-upload");
    setAvatarError(undefined);
    setAvatarNotice(undefined);
    try {
      const updated = await browserApiRequest<AppUser>("/app/api/me/avatar", {
        method: "PUT",
        body: await accountAvatarPayload(file)
      });
      setCurrentUser(updated);
      setAvatarNotice("Аватар обновлён.");
      router.refresh();
    } catch (error) {
      setAvatarError(profileErrorMessage(error, "Не удалось загрузить аватар."));
    } finally {
      setOperation(undefined);
    }
  }

  async function deleteAvatar(): Promise<void> {
    if (!currentUser.avatarUpdatedAt || operation) return;
    setOperation("avatar-delete");
    setAvatarError(undefined);
    setAvatarNotice(undefined);
    try {
      const updated = await browserApiRequest<AppUser>("/app/api/me/avatar", {
        method: "DELETE"
      });
      setCurrentUser(updated);
      setAvatarNotice("Аватар удалён.");
      router.refresh();
    } catch (error) {
      setAvatarError(profileErrorMessage(error, "Не удалось удалить аватар."));
    } finally {
      setOperation(undefined);
    }
  }

  async function requestPasswordChange(): Promise<void> {
    if (operation) return;
    setOperation("password");
    setPasswordError(undefined);
    setPasswordNotice(undefined);
    try {
      await browserApiRequest<{ readonly accepted: true }>(
        "/app/api/auth/password/request",
        {
          method: "POST",
          body: { email: currentUser.email }
        }
      );
      setPasswordNotice(
        `Ссылка для смены пароля отправлена на ${currentUser.email}.`
      );
    } catch (error) {
      setPasswordError(
        profileErrorMessage(error, "Не удалось отправить письмо.")
      );
    } finally {
      setOperation(undefined);
    }
  }

  return (
    <div className="account-security-grid">
      <section className="panel security-card account-avatar-card">
        <header className="security-card-header account-profile-heading">
          <div>
            <span className="settings-card-eyebrow">Профиль</span>
            <h2>Фото аккаунта</h2>
            <p>
              PNG, JPEG или WebP. Большие изображения уменьшаются в браузере
              перед отправкой.
            </p>
          </div>
          <UserAvatar
            className="account-settings-avatar"
            size={76}
            user={currentUser}
          />
        </header>
        <div className="account-profile-identity">
          <strong>{currentUser.displayName}</strong>
          <span>{currentUser.email}</span>
        </div>
        {avatarError && (
          <div className="inline-alert danger compact" role="alert">
            {avatarError}
          </div>
        )}
        {avatarNotice && (
          <div className="inline-alert success compact" role="status">
            {avatarNotice}
          </div>
        )}
        <div className="account-profile-actions">
          <label
            className={`secondary-button${operation ? " disabled" : ""}`}
          >
            {operation === "avatar-upload"
              ? "Загружаем…"
              : currentUser.avatarUpdatedAt
                ? "Заменить фото"
                : "Загрузить фото"}
            <input
              accept="image/png,image/jpeg,image/webp"
              disabled={Boolean(operation)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void uploadAvatar(file);
              }}
              type="file"
            />
          </label>
          {currentUser.avatarUpdatedAt && (
            <button
              className="text-button danger-text"
              disabled={Boolean(operation)}
              onClick={() => void deleteAvatar()}
              type="button"
            >
              {operation === "avatar-delete" ? "Удаляем…" : "Удалить"}
            </button>
          )}
        </div>
      </section>

      <section className="panel security-card account-password-card">
        <header className="security-card-header">
          <div>
            <span className="settings-card-eyebrow">Пароль</span>
            <h2>Смена через email</h2>
            <p>
              Мы отправим одноразовую ссылку на подтверждённую почту. Пароль
              не запрашивается внутри открытой сессии.
            </p>
          </div>
          <span aria-hidden="true" className="account-password-mark">
            <Icon height={22} name="mail" width={22} />
          </span>
        </header>
        <div className="account-password-details">
          <span>Письмо придёт на</span>
          <strong>{currentUser.email}</strong>
          <small>
            Ссылка действует 30 минут. После смены пароля остальные сессии
            будут завершены.
          </small>
        </div>
        {passwordError && (
          <div className="inline-alert danger compact" role="alert">
            {passwordError}
          </div>
        )}
        {passwordNotice && (
          <div className="inline-alert success compact" role="status">
            {passwordNotice}
          </div>
        )}
        <button
          className="primary-button account-password-action"
          disabled={Boolean(operation) || !currentUser.emailVerified}
          onClick={() => void requestPasswordChange()}
          type="button"
        >
          {operation === "password"
            ? "Отправляем…"
            : "Отправить ссылку для смены пароля"}
        </button>
      </section>
    </div>
  );
}

class AccountAvatarError extends Error {}

async function accountAvatarPayload(file: File): Promise<{
  readonly contentType: "image/png" | "image/jpeg" | "image/webp";
  readonly data: string;
}> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new AccountAvatarError("Выберите изображение PNG, JPEG или WebP.");
  }
  if (file.size > AVATAR_SOURCE_MAX_BYTES) {
    throw new AccountAvatarError("Исходное изображение должно быть не больше 10 МБ.");
  }
  let image: Blob = file;
  if (image.size > AVATAR_MAX_BYTES) image = await resizeAvatar(file);
  if (image.size > AVATAR_MAX_BYTES || image.size < 32) {
    throw new AccountAvatarError("Не удалось уменьшить изображение до 512 КБ.");
  }
  return {
    contentType: image.type as "image/png" | "image/jpeg" | "image/webp",
    data: await blobBase64(image)
  };
}

async function resizeAvatar(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") {
    throw new AccountAvatarError(
      "Этот браузер не умеет уменьшать большие изображения. Выберите файл до 512 КБ."
    );
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new AccountAvatarError("Не удалось обработать изображение в браузере.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.88, 0.76, 0.64, 0.52]) {
    const result = await canvasBlob(canvas, quality);
    if (result && result.size <= AVATAR_MAX_BYTES) return result;
  }
  throw new AccountAvatarError("Не удалось уменьшить изображение до 512 КБ.");
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new AccountAvatarError("Не удалось прочитать изображение."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new AccountAvatarError("Не удалось подготовить изображение."));
      } else {
        resolve(result.slice(separator + 1));
      }
    };
    reader.readAsDataURL(blob);
  });
}

function profileErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AccountAvatarError) return error.message;
  if (error instanceof BrowserApiError) {
    if (error.status === 401) {
      return "Сессия завершена. Обновите страницу, чтобы войти снова.";
    }
    if (error.status === 429) {
      return "Слишком много запросов. Подождите немного и повторите.";
    }
    return error.message;
  }
  return fallback;
}
