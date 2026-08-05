import { RequestPasswordResetForm } from "../../../components/password-recovery-forms";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <img alt="" aria-hidden="true" className="brand-mark" height={29} src="/brand/seonorita-mark.svg" width={29} />
        <span>SEOньорита</span>
      </a>
      <section className="auth-card">
        <header>
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
