import { MfaChallengeForm } from "../../../components/mfa-challenge-form";
import { safeAppReturnTo } from "../../../lib/app-path";

interface MfaPageProps {
  readonly searchParams: Promise<{
    readonly returnTo?: string;
  }>;
}

export default async function MfaPage({ searchParams }: MfaPageProps) {
  const params = await searchParams;
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        <img alt="" aria-hidden="true" className="brand-mark" height={29} src="/brand/seonorita-mark.svg" width={29} />
        <span>SEOньорита</span>
      </a>
      <section className="auth-card">
        <header>
          <h1>Подтвердите вход</h1>
          <p>
            Пароль принят. Осталось подтвердить второй фактор для создания
            сессии.
          </p>
        </header>
        <MfaChallengeForm returnTo={safeAppReturnTo(params.returnTo)} />
      </section>
    </main>
  );
}
