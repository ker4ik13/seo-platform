import { WorkspaceInviteAcceptance } from "../../../../components/workspace-invite-acceptance";

export default function WorkspaceInviteAcceptancePage() {
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <img alt="" aria-hidden="true" className="brand-mark" height={29} src="/brand/seonorita-mark.svg" width={29} />
        <span>SEOньорита</span>
      </a>
      <section className="auth-card">
        <header>
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
