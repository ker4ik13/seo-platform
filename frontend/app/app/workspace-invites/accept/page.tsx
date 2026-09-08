import { WorkspaceInviteAcceptance } from "../../../../components/workspace-invite-acceptance";
import { UiText } from "../../../../components/ui-locale";


export default function WorkspaceInviteAcceptancePage() {
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <img alt="" aria-hidden="true" className="brand-mark" height={29} src="/brand/seonorita-mark.svg" width={29} />
        <span><UiText text="SEOньорита" /></span>
      </a>
      <section className="auth-card">
        <header>
          <h1><UiText text="Приглашение в рабочую область" /></h1>
          <p>
            <UiText text="Ссылка одноразовая. Для принятия используйте подтверждённый аккаунт с тем же email." /></p>
        </header>
        <WorkspaceInviteAcceptance />
      </section>
    </main>
  );
}
