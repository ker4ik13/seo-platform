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
          <span className="billing-label">Модель доступа</span>
          <h2>Системные роли</h2>
          <p>
            Роль задаёт верхнюю границу полномочий в workspace. Доступ к
            отдельному проекту может только сузить её.
          </p>
        </div>
        <span className="security-status on">
          Ваша роль: {roleLabel(currentRoleCode)}
        </span>
      </section>

      <section className="panel workspace-role-matrix-panel">
        <header className="security-card-header">
          <div>
            <h2>Матрица возможностей</h2>
            <p>
              Системные роли неизменяемы. Сервер дополнительно проверяет
              project assignment, состояние workspace и биллинг.
            </p>
          </div>
        </header>
        <div className="workspace-role-matrix-wrap" tabIndex={0}>
          <table className="workspace-role-matrix">
            <thead>
              <tr>
                <th>Возможность</th>
                {ROLE_COLUMNS.map(([code, label]) => (
                  <th className={code === currentRoleCode ? "current" : undefined} key={code}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map(([capability, ...values]) => (
                <tr key={capability}>
                  <th>{capability}</th>
                  {values.map((value, index) => (
                    <td
                      className={ROLE_COLUMNS[index]?.[0] === currentRoleCode ? "current" : undefined}
                      key={`${capability}:${ROLE_COLUMNS[index]?.[0]}`}
                    >
                      {value}
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
            <h2>Роли в проектах</h2>
            <p>
              Назначаются отдельно для каждого проекта и никогда не расширяют
              системную роль участника.
            </p>
          </div>
        </header>
        <div className="workspace-project-role-grid">
          <article>
            <strong>Нет доступа</strong>
            <p>Проект не отображается и его данные недоступны.</p>
          </article>
          <article>
            <strong>Наблюдатель</strong>
            <p>Просмотр таблиц, отчётов и истории без изменений.</p>
          </article>
          <article>
            <strong>Участник</strong>
            <p>Работа с данными проекта в пределах системной роли.</p>
          </article>
          <article>
            <strong>Менеджер проекта</strong>
            <p>Настройки проекта и управление доступом в пределах системной роли.</p>
          </article>
        </div>
      </section>
    </div>
  );
}

function roleLabel(roleCode: string | undefined): string {
  return ROLE_COLUMNS.find(([code]) => code === roleCode)?.[1] ?? "Не назначена";
}
