
import { UiText } from "./ui-locale";
const ROLE_COLUMNS = [
  ["OWNER", "Владелец"],
  ["ADMIN", "Администратор"],
  ["SEO_LEAD", "SEO Lead"],
  ["SEO_SPECIALIST", "SEO-специалист"],
  ["ANALYST", "Аналитик"],
  ["CONTENT_EDITOR", "Контент-редактор"],
  ["CLIENT", "Клиент"],
  ["VIEWER", "Наблюдатель"]
] as const;

const CAPABILITIES = [
  ["Управление рабочей областью", "Да", "Частично", "—", "—", "—", "—", "—", "—"],
  ["Участники и роли", "Да", "Да", "Просмотр", "—", "—", "—", "—", "—"],
  ["Биллинг", "Да", "По разрешению", "Расходы", "—", "—", "—", "—", "—"],
  ["Создание проектов", "Да", "Да", "Да", "По разрешению", "—", "—", "—", "—"],
  ["Семантика", "Да", "Да", "Да", "Да", "Просмотр / экспорт", "Ограниченно", "—", "Просмотр"],
  ["Платные операции", "Да", "Да", "Да", "По лимиту", "—", "—", "—", "—"],
  ["Позиции и аналитика", "Да", "Да", "Да", "Да", "Да", "Просмотр", "Отчёты", "Просмотр"],
  ["Страницы и контент", "Да", "Да", "Да", "Да", "Просмотр", "Да", "Комментарии", "Просмотр"],
  ["Интеграции", "Да", "Да", "Использование", "Использование", "—", "—", "—", "—"],
  ["Автоматизации", "Да", "Да", "Да", "По разрешению", "—", "—", "—", "—"]
] as const;

export function WorkspaceRoleCatalog({
  currentRoleCode
}: Readonly<{ currentRoleCode: string | undefined }>) {
  return (
    <div className="workspace-role-catalog">
      <section className="panel workspace-role-summary">
        <div>
          <span className="billing-label"><UiText text="Модель доступа" /></span>
          <h2><UiText text="Системные роли" /></h2>
          <p>
            <UiText text="Роль задаёт верхнюю границу полномочий в workspace. Доступ к отдельному проекту может только сузить её." /></p>
        </div>
        <span className="security-status on">
          <UiText text="Ваша роль:" after=" " />{<UiText text={roleLabel(currentRoleCode) ?? ""} />}
        </span>
      </section>

      <section className="panel workspace-role-matrix-panel">
        <header className="security-card-header">
          <div>
            <h2><UiText text="Матрица возможностей" /></h2>
            <p>
              <UiText text="Системные роли неизменяемы. Сервер дополнительно проверяет project assignment, состояние workspace и биллинг." /></p>
          </div>
        </header>
        <div className="workspace-role-matrix-wrap" tabIndex={0}>
          <table className="workspace-role-matrix">
            <thead>
              <tr>
                <th><UiText text="Возможность" /></th>
                {ROLE_COLUMNS.map(([code, label]) => (
                  <th className={code === currentRoleCode ? "current" : undefined} key={code}>
                    <UiText text={label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map(([capability, ...values]) => (
                <tr key={capability}>
                  <th><UiText text={capability} /></th>
                  {values.map((value, index) => (
                    <td
                      className={ROLE_COLUMNS[index]?.[0] === currentRoleCode ? "current" : undefined}
                      key={`${capability}:${ROLE_COLUMNS[index]?.[0]}`}
                    >
                      <UiText text={value} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel workspace-project-role-panel">
        <header className="security-card-header">
          <div>
            <h2><UiText text="Роли в проектах" /></h2>
            <p>
              <UiText text="Назначаются отдельно для каждого проекта и никогда не расширяют системную роль участника." /></p>
          </div>
        </header>
        <div className="workspace-project-role-grid">
          <article>
            <strong><UiText text="Нет доступа" /></strong>
            <p><UiText text="Проект не отображается и его данные недоступны." /></p>
          </article>
          <article>
            <strong><UiText text="Наблюдатель" /></strong>
            <p><UiText text="Просмотр таблиц, отчётов и истории без изменений." /></p>
          </article>
          <article>
            <strong><UiText text="Участник" /></strong>
            <p><UiText text="Работа с данными проекта в пределах системной роли." /></p>
          </article>
          <article>
            <strong><UiText text="Менеджер проекта" /></strong>
            <p><UiText text="Настройки проекта и управление доступом в пределах системной роли." /></p>
          </article>
        </div>
      </section>
    </div>
  );
}

function roleLabel(roleCode: string | undefined): string {
  return ROLE_COLUMNS.find(([code]) => code === roleCode)?.[1] ?? "Не назначена";
}
