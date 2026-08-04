import { BrowserApiError } from "./browser-api.ts";

export function projectCreationErrorMessage(error: unknown): string {
  if (!(error instanceof BrowserApiError)) {
    return "Не удалось создать проект. Данные формы сохранены.";
  }
  if (error.status >= 500) {
    return "Сервис временно недоступен. Данные формы сохранены.";
  }
  if (error.code === "QUOTA_EXCEEDED") {
    return "Лимит проектов текущего тарифа исчерпан. Увеличьте лимит в разделе «Тариф и оплата» или архивируйте ненужный проект.";
  }
  if (error.code === "PAYMENT_REQUIRED") {
    return "Рабочая область сейчас доступна только для чтения. Возобновите тариф, чтобы создавать проекты.";
  }
  if (error.code === "FORBIDDEN") {
    return "У вашей роли нет права создавать проекты в этой рабочей области.";
  }
  if (error.fieldErrors.length > 0) {
    return error.fieldErrors
      .map(({ message }) => message)
      .filter((message): message is string => Boolean(message))
      .join(" ") || "Проверьте название и домен, затем повторите попытку.";
  }
  return error.message || "Проверьте название и домен, затем повторите попытку.";
}
