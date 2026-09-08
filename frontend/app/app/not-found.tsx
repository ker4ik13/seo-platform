
import { UiText } from "../../components/ui-locale";
export default function NotFound() {
  return (
    <main className="center-state">
      <section className="empty-state compact">
        <span className="state-icon">404</span>
        <h1><UiText text="Раздел не найден" /></h1>
        <p><UiText text="Возможно, ссылка устарела или у вас нет доступа к этому разделу." /></p>
        <a className="primary-button" href="/app"><UiText text="Вернуться к обзору" /></a>
      </section>
    </main>
  );
}
