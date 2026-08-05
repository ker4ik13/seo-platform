"use client";

export default function ErrorPage({
  reset
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <main className="state-page">
      <strong>Панель временно недоступна</strong>
      <button onClick={reset} type="button">Повторить</button>
    </main>
  );
}
