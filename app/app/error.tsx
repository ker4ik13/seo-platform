"use client";

export default function ErrorPage({
  reset
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <main className="center-state">
      <span className="state-icon" aria-hidden="true">!</span>
      <h1>Не удалось открыть рабочее пространство</h1>
      <p>Проверьте соединение и повторите попытку.</p>
      <button className="primary-button" onClick={reset} type="button">
        Повторить
      </button>
    </main>
  );
}

