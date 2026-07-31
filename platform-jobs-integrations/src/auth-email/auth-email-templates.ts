import type {
  InternalAuthEmailMaterialDecisionV1
} from "@seo-platform/contracts";
import type { TransactionalEmail } from "../email/email.port.js";

type ReadyMaterial = Extract<
  InternalAuthEmailMaterialDecisionV1,
  { readonly decision: "READY" | "READY_RECEIPT" }
>;
type ActionReadyMaterial = Extract<
  ReadyMaterial,
  { readonly decision: "READY" }
>;

interface TemplateCopy {
  readonly subject: string;
  readonly heading: string;
  readonly introduction: string;
  readonly action: string;
  readonly expiry: string;
  readonly ignore: string;
}

const COPY: Readonly<
  Record<
    "en" | "ru",
    Readonly<
      Record<ActionReadyMaterial["eventType"], TemplateCopy>
    >
  >
> = {
  en: {
    "identity.email-verification.requested.v1": {
      subject: "Confirm your email address",
      heading: "Confirm your email address",
      introduction:
        "Use the secure link below to finish setting up your account.",
      action: "Confirm email",
      expiry: "This one-time link expires at",
      ignore: "If you did not create this account, you can ignore this email."
    },
    "identity.password-reset.requested.v1": {
      subject: "Reset your password",
      heading: "Reset your password",
      introduction:
        "Use the secure link below to choose a new password.",
      action: "Reset password",
      expiry: "This one-time link expires at",
      ignore: "If you did not request a password reset, you can ignore this email."
    },
    "workspace.invite.requested.v1": {
      subject: "You have been invited to a workspace",
      heading: "Workspace invitation",
      introduction:
        "Use the secure link below to review and accept your invitation.",
      action: "Review invitation",
      expiry: "This one-time link expires at",
      ignore: "If you were not expecting this invitation, you can ignore this email."
    }
  },
  ru: {
    "identity.email-verification.requested.v1": {
      subject: "Подтвердите адрес электронной почты",
      heading: "Подтвердите адрес электронной почты",
      introduction:
        "Перейдите по защищённой ссылке, чтобы завершить создание аккаунта.",
      action: "Подтвердить email",
      expiry: "Одноразовая ссылка действует до",
      ignore: "Если вы не создавали аккаунт, просто проигнорируйте это письмо."
    },
    "identity.password-reset.requested.v1": {
      subject: "Сброс пароля",
      heading: "Сброс пароля",
      introduction:
        "Перейдите по защищённой ссылке, чтобы задать новый пароль.",
      action: "Сбросить пароль",
      expiry: "Одноразовая ссылка действует до",
      ignore: "Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо."
    },
    "workspace.invite.requested.v1": {
      subject: "Приглашение в рабочую область",
      heading: "Приглашение в рабочую область",
      introduction:
        "Перейдите по защищённой ссылке, чтобы посмотреть и принять приглашение.",
      action: "Открыть приглашение",
      expiry: "Одноразовая ссылка действует до",
      ignore: "Если вы не ожидали приглашение, просто проигнорируйте это письмо."
    }
  }
};

export function authEmailMessageId(
  eventId: string,
  domain: string
): string {
  if (!/^[0-9a-f-]{36}$/u.test(eventId)) {
    throw new TypeError("Invalid auth email event ID");
  }
  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      domain
    )
  ) {
    throw new TypeError("Invalid auth email Message-ID domain");
  }
  const messageId = `<auth-email-${eventId}@${domain}>`;
  if (messageId.length > 255) {
    throw new TypeError("Invalid auth email Message-ID domain");
  }
  return messageId;
}

export function renderAuthEmail(
  material: ReadyMaterial,
  messageIdDomain: string
): TransactionalEmail {
  const locale = templateLocale(material.locale);
  if (material.decision === "READY_RECEIPT") {
    return renderReceiptEmail(material, locale, messageIdDomain);
  }
  const copy = COPY[locale][material.eventType];
  if (!copy) throw new TypeError("Unsupported auth email event type");
  const actionUrl = safeActionUrl(material.actionUrl);
  const expiry = new Date(material.expiresAt);
  if (!Number.isFinite(expiry.getTime())) {
    throw new TypeError("Invalid auth email expiry");
  }
  const formattedExpiry = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(expiry);
  const text = [
    copy.heading,
    "",
    copy.introduction,
    "",
    `${copy.action}: ${actionUrl}`,
    "",
    `${copy.expiry} ${formattedExpiry} UTC.`,
    "",
    copy.ignore
  ].join("\n");
  const html = [
    "<!doctype html>",
    '<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#172033">',
    `<h1>${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(copy.introduction)}</p>`,
    `<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;background:#3157d5;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(copy.action)}</a></p>`,
    `<p>${escapeHtml(copy.expiry)} ${escapeHtml(formattedExpiry)} UTC.</p>`,
    `<p>${escapeHtml(copy.ignore)}</p>`,
    "</body></html>"
  ].join("");

  return {
    messageId: authEmailMessageId(material.eventId, messageIdDomain),
    to: material.recipient,
    subject: copy.subject,
    text,
    html
  };
}

function renderReceiptEmail(
  material: Extract<
    ReadyMaterial,
    { readonly decision: "READY_RECEIPT" }
  >,
  locale: "en" | "ru",
  messageIdDomain: string
): TransactionalEmail {
  const receiptUrl = safeReceiptUrl(
    material.receiptUrl,
    material.officialReceiptId
  );
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "RUB"
  }).format(material.grossAmountMinor / 100);
  const copy =
    locale === "ru"
      ? {
          subject: "Ваш чек об оплате SEO Workspace",
          heading: "Чек об оплате",
          introduction:
            "Оплата зарегистрирована. Официальный чек ФНС доступен по ссылке ниже.",
          amount: "Сумма",
          service: "Услуга",
          receipt: "Открыть официальный чек",
          identifier: "Номер чека"
        }
      : {
          subject: "Your SEO Workspace payment receipt",
          heading: "Payment receipt",
          introduction:
            "Your payment has been registered. The official FNS receipt is available below.",
          amount: "Amount",
          service: "Service",
          receipt: "Open official receipt",
          identifier: "Receipt ID"
        };
  const text = [
    copy.heading,
    "",
    copy.introduction,
    "",
    `${copy.service}: ${material.serviceDescription}`,
    `${copy.amount}: ${amount}`,
    `${copy.identifier}: ${material.officialReceiptId}`,
    "",
    `${copy.receipt}: ${receiptUrl}`
  ].join("\n");
  const html = [
    "<!doctype html>",
    '<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#172033">',
    `<h1>${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(copy.introduction)}</p>`,
    `<p><strong>${escapeHtml(copy.service)}:</strong> ${escapeHtml(material.serviceDescription)}<br>`,
    `<strong>${escapeHtml(copy.amount)}:</strong> ${escapeHtml(amount)}<br>`,
    `<strong>${escapeHtml(copy.identifier)}:</strong> ${escapeHtml(material.officialReceiptId)}</p>`,
    `<p><a href="${escapeHtml(receiptUrl)}" style="display:inline-block;padding:12px 18px;background:#3157d5;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(copy.receipt)}</a></p>`,
    "</body></html>"
  ].join("");
  return {
    messageId: authEmailMessageId(material.eventId, messageIdDomain),
    to: material.recipient,
    subject: copy.subject,
    text,
    html
  };
}

function templateLocale(value: string): "en" | "ru" {
  try {
    return new Intl.Locale(value).language.toLowerCase() === "ru"
      ? "ru"
      : "en";
  } catch {
    return "en";
  }
}

function safeActionUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Invalid auth email action URL");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new TypeError("Invalid auth email action URL");
  }
  return parsed.toString();
}

function safeReceiptUrl(
  value: string,
  officialReceiptId: string
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Invalid NPD receipt URL");
  }
  const path = parsed.pathname.split("/").filter(Boolean);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "lknpd.nalog.ru" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    path.length !== 6 ||
    path[0] !== "api" ||
    path[1] !== "v1" ||
    path[2] !== "receipt" ||
    !/^\d{10,16}$/u.test(path[3] ?? "") ||
    path[4] !== officialReceiptId ||
    path[5] !== "print"
  ) {
    throw new TypeError("Invalid NPD receipt URL");
  }
  return parsed.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
