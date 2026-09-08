"use client";

import { UiText } from "../../components/ui-locale";


export default function ErrorPage({
  error,
  reset
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <main className="center-state">
      <span className="state-icon" aria-hidden="true">!</span>
      <h1><UiText text="Не удалось открыть рабочее пространство" /></h1>
      <p><UiText text="Проверьте соединение и повторите попытку." /></p>
      {error.digest && (
        <small className="error-reference">
          <UiText text="Код обращения:" after=" " />{error.digest}
        </small>
      )}
      <button className="primary-button" onClick={reset} type="button">
        <UiText text="Повторить" /></button>
    </main>
  );
}
