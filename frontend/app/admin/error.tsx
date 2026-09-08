"use client";

import { UiText } from "../../components/ui-locale";


export default function ErrorPage({
  reset
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <main className="state-page">
      <strong><UiText text="Панель временно недоступна" /></strong>
      <button onClick={reset} type="button"><UiText text="Повторить" /></button>
    </main>
  );
}
