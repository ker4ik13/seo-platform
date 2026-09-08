import { ResetPasswordForm } from "../../../components/password-recovery-forms";
import { UiText } from "../../../components/ui-locale";


export default function ResetPasswordPage() {
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <img alt="" aria-hidden="true" className="brand-mark" height={29} src="/brand/seonorita-mark.svg" width={29} />
        <span><UiText text="SEOньорита" /></span>
      </a>
      <section className="auth-card">
        <header>
          <h1><UiText text="Новый пароль" /></h1>
          <p>
            <UiText text="После смены пароля все прежние сессии будут завершены, а текущий браузер войдёт в аккаунт заново." /></p>
        </header>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
