import { ResetPasswordForm } from "../../../components/password-recovery-forms";

export default function ResetPasswordPage() {
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <span className="brand-mark">S</span>
        <span>SEO Workspace</span>
      </a>
      <section className="auth-card">
        <header>
          <p className="eyebrow">Безопасность</p>
          <h1>Новый пароль</h1>
          <p>
            После смены пароля все прежние сессии будут завершены, а текущий
            браузер войдёт в аккаунт заново.
          </p>
        </header>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
