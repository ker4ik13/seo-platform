"use client";

export default function ErrorPage({
  error,
  reset
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <main className="center-state">
      <span className="state-icon" aria-hidden="true">!</span>
      <h1>Не удалось открыть рабочее пространство</h1>
      <p>Проверьте соединение и повторите попытку.</p>
      {error.digest && (
        <small className="error-reference">
          Код обращения: {error.digest}
        </small>
      )}
      <button className="primary-button" onClick={reset} type="button">
        Повторить
      </button>
    </main>
  );
}
