import { AppShell } from "../components/app-shell";

export default function NotFound() {
  return (
    <AppShell>
      <section className="empty-state">
        <span className="state-icon">404</span>
        <h1>Раздел не найден</h1>
        <p>Возможно, ссылка устарела или у вас нет доступа к этому разделу.</p>
        <a className="primary-button" href="/">Вернуться к обзору</a>
      </section>
    </AppShell>
  );
}
