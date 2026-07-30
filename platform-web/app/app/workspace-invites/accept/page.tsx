import { WorkspaceInviteAcceptance } from "../../../../components/workspace-invite-acceptance";

export default function WorkspaceInviteAcceptancePage() {
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <span className="brand-mark">S</span>
        <span>SEO Workspace</span>
      </a>
      <section className="auth-card">
        <header>
          <p className="eyebrow">Командная работа</p>
          <h1>Приглашение в рабочую область</h1>
          <p>
            Ссылка одноразовая. Для принятия используйте подтверждённый
            аккаунт с тем же email.
          </p>
        </header>
        <WorkspaceInviteAcceptance />
      </section>
    </main>
  );
}
