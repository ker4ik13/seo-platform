import { AuthForm } from "../../../components/auth-form";
import { safeAppReturnTo } from "../../../lib/app-path";

interface RegisterPageProps {
  readonly searchParams: Promise<{
    readonly returnTo?: string;
  }>;
}

export default async function RegisterPage({
  searchParams
}: RegisterPageProps) {
  const params = await searchParams;
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <img alt="" aria-hidden="true" className="brand-mark" height={29} src="/brand/seonorita-mark.svg" width={29} />
        <span>SEOньорита</span>
      </a>
      <section className="auth-card">
        <header>
          <h1>Создайте аккаунт</h1>
          <p>
            После подтверждения email вы создадите рабочую область и первый
            проект.
          </p>
        </header>
        <AuthForm
          mode="register"
          returnTo={safeAppReturnTo(params.returnTo)}
        />
      </section>
    </main>
  );
}
