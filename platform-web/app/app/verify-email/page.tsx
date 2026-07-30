import { VerifyEmailForm } from "../../../components/verify-email-form";
import { safeAppReturnTo } from "../../../lib/app-path";

interface VerifyEmailPageProps {
  readonly searchParams: Promise<{
    readonly email?: string;
    readonly returnTo?: string;
  }>;
}

export default async function VerifyEmailPage({
  searchParams
}: VerifyEmailPageProps) {
  const { email, returnTo } = await searchParams;
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <span className="brand-mark">S</span>
        <span>SEO Workspace</span>
      </a>
      <section className="auth-card">
        <header>
          <p className="eyebrow">Безопасность аккаунта</p>
          <h1>Подтвердите email</h1>
          <p>
            Мы отправили одноразовую ссылку. После подтверждения будет создана
            защищённая сессия.
          </p>
        </header>
        <VerifyEmailForm
          initialEmail={email}
          initialReturnTo={safeAppReturnTo(returnTo)}
        />
      </section>
    </main>
  );
}
