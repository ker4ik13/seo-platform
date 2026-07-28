import { RequestPasswordResetForm } from "../../../components/password-recovery-forms";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <span className="brand-mark">S</span>
        <span>SEO Workspace</span>
      </a>
      <section className="auth-card">
        <header>
          <p className="eyebrow">Доступ к аккаунту</p>
          <h1>Восстановление пароля</h1>
          <p>
            Укажите email аккаунта. Ссылка действует ограниченное время и
            может быть использована один раз.
          </p>
        </header>
        <RequestPasswordResetForm />
      </section>
    </main>
  );
}
