import { AuthForm } from "../../../components/auth-form";
import { safeAppReturnTo } from "../../../lib/app-path";

interface LoginPageProps {
  readonly searchParams: Promise<{
    readonly returnTo?: string;
    readonly reason?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <img alt="" aria-hidden="true" className="brand-mark" height={29} src="/brand/seonorita-mark.svg" width={29} />
        <span>SEOньорита</span>
      </a>
      <section className="auth-card">
        <header>
          <h1>Вход в приложение</h1>
          <p>Откройте проекты, историю запусков и командное пространство.</p>
        </header>
        <AuthForm
          mode="login"
          returnTo={safeAppReturnTo(params.returnTo)}
          sessionExpired={params.reason === "session-expired"}
          sessionRevoked={params.reason === "session-revoked"}
        />
      </section>
    </main>
  );
}
