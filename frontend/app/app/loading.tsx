
import { UiText } from "../../components/ui-locale";
export default function Loading() {
  return (
    <main className="center-state" aria-live="polite" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <p><UiText text="Загружаем рабочее пространство…" /></p>
    </main>
  );
}

