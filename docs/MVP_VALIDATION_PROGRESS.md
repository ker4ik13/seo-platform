# Проверки коммерческого MVP

Обновлено 8 сентября 2026. Это промежуточный журнал, не акт готовности production.
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

Большие rank operations развёрнуты в локальном production-like runtime. Ранний
50k тест обнаружил холодный квадратичный join и Prisma bind limit; bounded read
plan и страницы по 5k исправили оба дефекта. Итоговый чистый прогон
`e2e.pgFQt0xdUs` создал 50 000 ключей, назначил их, сохранил все пакеты,
финализировал Arsenkin/XMLStock manifests и завершился успешно. Ни один из этих
тестов не отправляет реальные платные SEO-запросы.

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
- Первый clean Dokploy build обнаружил отсутствующую предварительную сборку
  workspace dependency `operational-alerts` в isolated Core API image. После
  исправления отдельно воспроизведены Prisma generate → Core API TypeScript
  build → `pnpm deploy --prod` с предварительно убранными локальными `dist`;
  финальный deploy artifact содержит скомпилированную зависимость. Статический
  infrastructure regression закрепляет порядок clean Docker build.

## Позиции, сезонность и выдача — финальный локальный срез

- Контракты: 126 passed; Execution: 823 passed, 13 opt-in skipped; Core API:
  778 passed, 12 opt-in skipped; Core SEO: 362 passed, 5 opt-in skipped;
  Frontend: 388 passed. Корневые `typecheck` и `lint`, Prisma validate/generate
  и production build на 33 маршрута прошли.
- Изолированный PostgreSQL runner `e2e.pgFQt0xdUs` с новым чистым кластером
  прошёл миграции, ACL, уведомления, Core/Execution/SEO concurrency и 50k rank
  workload. Нагрузочная часть завершилась за 165 секунд, live provider calls — 0.
- Browser E2E `e2e.rank-workbench.2MqHWFed` прошёл через публичный HTTPS/Caddy.
  Он проверил дневную матрицу, desktop/mobile, city/device sidebar, стабильный
  drawer колонок, XLSX round trip, длинную заметку 130 033 символа, сезонность,
  SERP comparison и append-only удаление одного ошибочного среза. Browser
  errors — 0, paid requests — 0.
- Перед локальными миграциями сохранена копия четырёх БД:
  `pre-migration-20260908T175555Z.X1696yjs`. После миграций runtime снова
  доступен по `https://144.31.221.28:3000`; все readiness endpoints и
  пользовательский маршрут через системный Caddy возвращают ожидаемые статусы.

## Arsenkin seasonality и компактный интерфейс — 9 сентября

- Официальная документация Arsenkin и фактический API подтвердили
  `wordstat/type=3`, region/device/group/startdate/enddate и обязательный для
  текущей границы Wordstat `correct_dates=true`. XMLStock удалён из маршрутов
  сезонности; обычная частотность XMLStock сохранена.
- Первый принятый Arsenkin task дал ранее не документированную форму результата
  `data: [{query, data: {date: {frequency}}}]`; fail-closed parser не сохранил
  её до проверки. После добавления точной схемы тот же provider result прошёл
  отдельный regression на 12 точек. Финальный UI-запуск на одном существующем
  ключе с частотностью завершён `COMPLETED`: 12 месячных точек сохранены в
  PostgreSQL, operation result и keyword insights, browser errors — 0.
  Всего на два принятых canary task израсходовано 2 лимита Arsenkin; отклонённые
  проверки формата лимиты не списали. Project Wordstat route возвращён на
  исходный XMLStock, все краткоживущие проверочные сессии отозваны.
- Browser E2E `e2e.rank-ui-final.z9NJ1cN7` прошёл через HTTPS/Caddy. Он проверил
  отсутствие native select/date, общий календарь, desktop/mobile layout,
  скрытое распределение, sidebar trigger не выше 52 px и option не выше 56 px.
- После финального parser/UI diff: Execution — 830 passed, 13 opt-in skipped;
  Frontend — 388 passed; root typecheck/lint, i18n placeholder check и build на
  33 маршрута прошли. Живой sidebar дополнительно подтвердил порядок
  «Частотность → Сезонность», названия «Россия/Москва», подпись «Последние 30
  дней» и сохранённый график.
