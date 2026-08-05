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
        <img alt="" aria-hidden="true" className="brand-mark" height={29} src="/brand/seonorita-mark.svg" width={29} />
        <span>SEOньорита</span>
      </a>
      <section className="auth-card">
        <header>
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
