export default function Loading() {
  return (
    <main className="center-state" aria-live="polite" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <p>Загружаем рабочее пространство…</p>
    </main>
  );
}
