# Проверки коммерческого MVP

Обновлено 7 сентября 2026. Это промежуточный журнал, не акт готовности production.
Артефакты расположены в `/home/dev/.local/share/seo-platform-runtime/tmp/e2e.mvp-release-20260906`.

| Проверка | Результат |
|---|---|
| Core API suite после Crypto/Telegram/paid-operation wiring | 760 passed, 8 skipped; до последних subscription/refund changes |
| Полный изолированный PostgreSQL `e2e.pgKSJ8MXvf` | passed: permissions/migrations, Core, Execution, SEO |
| Core PostgreSQL races в этом запуске | 13 passed |
| Execution PostgreSQL races в этом запуске | 10 passed, 1 историческая pre-upgrade fixture skipped |
| Telegram PostgreSQL lifecycle | связывание, чужой browser/Telegram, replay, гонка finish, MFA, unlink passed |
| Crypto Pay PostgreSQL lifecycle | одно зачисление, unknown-create recovery, исключение test funding, amount drift passed |
| Provider usage PostgreSQL | Core permit обязателен; одно START; checkpoint replay; cancellation during I/O; unknown quarantine passed |
| Refund PostgreSQL | request не платит; concurrent approvals; cash hold; failure restore; 20h cutoff; verified provider reference; subscription days restore passed |
| Bulk admission / pricing / credit-period unit slice | 17 passed, включая 50 000 входных ключей |
| Core API + frontend typecheck после refund UI | passed |
| Root oxlint после refund UI | passed |
| Новая production build / новый Caddy browser pass | ещё не выполнялись |
| Живые платные SEO calls | 0 из 5 |
| PostgreSQL после provider probes / каталог v5 | `e2e.pgNQggdX1b`: passed, все owner/worker permissions и lifecycle suites |
| RU/EN словарь и placeholders | 4664 перевода, генератор проверяет соответствие placeholders |
| Чистый UI i18n unit slice | 5 passed: template values, сохранность авторского текста, JSX entities, длинные сообщения |
| Frontend typecheck после locale propagation | passed; финальный browser pass ещё требуется |
| Full Core API suite, следующий срез | 768 passed, 11 opt-in skipped |
| Full Execution suite, следующий срез | 808 passed, 13 opt-in skipped |
| Full frontend suite после i18n | 370 passed |
| Production build и новая миграция локального runtime | passed; 7 сентября, backup всех четырёх БД до миграций |
| HTTPS/Caddy, новая сборка | status-runtime passed, публичная страница 200 |
| Новый browser suite `e2e.H1zqlXHp` | 11 passed, настройки 320/390/768/1440, CSRF/tenant/write/error/EICAR |
| Отдельный RU/EN browser | 20 screens, сохранение выбора языка и авторского текста passed; найденные остаточные подписи исправляются |
| NPD PostgreSQL + полный runner `e2e.pg0uKNULke` | passed: гонки claim/start/complete, UNKNOWN, refund during issuance, повреждённый buyer envelope |

После этих проверок добавлены public documents/pricing и несколько исправлений
перевода. Для них требуется следующая сборка и browser pass; предыдущие
результаты не доказывают проверку ещё не развёрнутых изменений.

Следующий срез: публичные страницы RU/EN проверены через Caddy (32 page/viewport
комбинации), strict English settings pass не нашёл русского UI-текста кроме
заданных авторских названий. Проверены draft/noindex, real billing catalog,
язык SSR и отдельные согласия. Артефакты `public-browser` и `locale-browser-final`.

Большие rank operations пока не развёрнуты. Новые миграции проверены общим
runner `e2e.pgBE7SodtI`; legacy PostgreSQL tests passed. 50k тест обнаружил
холодный квадратичный join (180s timeout) и затем реальный Prisma bind limit
в relation fetch. Исправлены ограниченный read plan и страницы по 5k;
следующий срез дал scope ~1.5s, assignment ~8.4s, Arsenkin seal ~19.7s.
Полный 50k ingest/finalization/50k XMLStock manifest ещё проверяется.
Ни один из этих тестов не отправляет реальные платные SEO запросы.

PostgreSQL-проверки используют настоящие изолированные базы и SQL constraints.
Provider transport контролируется fixtures: этот результат не выдается за
live-проверку XMLStock, Arsenkin, YooKassa, Crypto Pay или ФНС.

Исторический pre-upgrade fixture проверяет отдельный сценарий старых ACL и не
запускается поверх уже мигрированной схемы. Старый аудит production-like runtime,
S3/ClamAV, HTTPS, browser и backup restore находится в `mvp-audit-2026-09-06.md`.
Эти результаты нужно повторить для итогового artifact после завершения MVP.

## Итоговый срез 8 сентября

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, Prisma
  validate/generate — passed; 2720 тестов прошли, 33 opt-in пропущены, ошибок
  нет, production build собрал 33 маршрута.
- Изолированный PostgreSQL runner применил полный migration set и прошёл
  permission/concurrency/50k/manual-history regressions. Migration review не
  нашёл `DELETE`, `TRUNCATE` или удаление таблиц с пользовательскими данными.
- Локальный production-like runtime применил миграции всех четырёх БД,
  `status-runtime.sh` подтвердил все readiness endpoints, MinIO, ClamAV и
  пользовательский HTTPS-маршрут через системный Caddy.
- Browser E2E `e2e.rank-layout.Scqf588y` создал изолированные tenant-данные,
  проверил заметку более 100 000 символов, дневные позиции, XLSX round trip,
  четыре city/device target, 101 папку и RU/EN. Панель колонок сохранила точные
  ширину/scroll/header/value и не отправила повторных rank-read запросов.
- Четыре запуска XMLStock из пользовательского UI (Москва/Санкт-Петербург ×
  ПК/телефон) получили execution grants и завершились без failed keyword.
