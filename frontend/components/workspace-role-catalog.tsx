
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

type RoleAccess =
  | "NONE"
  | "VIEW"
  | "EDIT"
  | "EDIT_LIMITED"
  | "VIEW_EXPORT"
  | "CREATE"
  | "RUN"
  | "RUN_LIMITED"
  | "USE"
  | "COMMENTS"
  | "REPORTS"
  | "COSTS";

const CAPABILITIES: readonly [string, ...RoleAccess[]][] = [
  ["Рабочая область", "EDIT", "EDIT_LIMITED", "VIEW", "VIEW", "VIEW", "VIEW", "VIEW", "VIEW"],
  ["Участники и роли", "EDIT", "EDIT", "VIEW", "NONE", "NONE", "NONE", "NONE", "NONE"],
  ["Биллинг", "EDIT", "EDIT_LIMITED", "COSTS", "NONE", "NONE", "NONE", "NONE", "NONE"],
  ["Проекты", "EDIT", "EDIT", "EDIT", "EDIT_LIMITED", "VIEW", "VIEW", "VIEW", "VIEW"],
  ["Семантика", "EDIT", "EDIT", "EDIT", "EDIT", "VIEW_EXPORT", "EDIT_LIMITED", "NONE", "VIEW"],
  ["Платные операции", "RUN", "RUN", "RUN", "RUN_LIMITED", "NONE", "NONE", "NONE", "NONE"],
  ["Позиции и аналитика", "EDIT", "EDIT", "EDIT", "EDIT", "VIEW_EXPORT", "VIEW", "REPORTS", "VIEW"],
  ["Страницы и контент", "EDIT", "EDIT", "EDIT", "EDIT", "VIEW", "EDIT", "COMMENTS", "VIEW"],
  ["Интеграции", "EDIT", "EDIT", "USE", "USE", "NONE", "NONE", "NONE", "NONE"],
  ["Автоматизации", "EDIT", "EDIT", "EDIT", "VIEW", "NONE", "NONE", "NONE", "NONE"]
];

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
                      <RoleAccessPresentation value={value} />
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

function RoleAccessPresentation({ value }: Readonly<{ value: RoleAccess }>) {
  if (value === "NONE") {
    return <span className="workspace-role-access none">—</span>;
  }
  const [primary, secondary] = roleAccessLabels(value);
  return (
    <span className={`workspace-role-access ${roleAccessTone(value)}`}>
      <span><UiText text={primary} /></span>
      {secondary && <strong><UiText text={secondary} /></strong>}
    </span>
  );
}

function roleAccessLabels(value: Exclude<RoleAccess, "NONE">): readonly [string, string?] {
  switch (value) {
    case "VIEW": return ["Просмотр"];
    case "EDIT": return ["Просмотр", "Редактирование"];
    case "EDIT_LIMITED": return ["Просмотр", "Ограниченное редактирование"];
    case "VIEW_EXPORT": return ["Просмотр", "Экспорт"];
    case "CREATE": return ["Просмотр", "Создание"];
    case "RUN": return ["Просмотр", "Запуск"];
    case "RUN_LIMITED": return ["Просмотр", "Запуск по лимиту"];
    case "USE": return ["Просмотр", "Использование"];
    case "COMMENTS": return ["Просмотр", "Комментарии"];
    case "REPORTS": return ["Просмотр отчётов"];
    case "COSTS": return ["Просмотр расходов"];
  }
}

function roleAccessTone(value: Exclude<RoleAccess, "NONE">): "view" | "edit" | "action" {
  if (["VIEW", "VIEW_EXPORT", "REPORTS", "COSTS"].includes(value)) {
    return "view";
  }
  if (["RUN", "RUN_LIMITED", "USE", "COMMENTS", "CREATE"].includes(value)) {
    return "action";
  }
  return "edit";
}

function roleLabel(roleCode: string | undefined): string {
  return ROLE_COLUMNS.find(([code]) => code === roleCode)?.[1] ?? "Не назначена";
}
