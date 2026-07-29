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
        <span className="brand-mark">S</span>
        <span>SEO Workspace</span>
      </a>
      <section className="auth-card">
        <header>
          <p className="eyebrow">С возвращением</p>
          <h1>Вход в приложение</h1>
          <p>Откройте проекты, историю запусков и командное пространство.</p>
        </header>
        <AuthForm
          mode="login"
          returnTo={safeAppReturnTo(params.returnTo)}
          sessionExpired={params.reason === "session-expired"}
        />
      </section>
    </main>
  );
}
