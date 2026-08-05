# ADR-2026-041: три прикладных сервиса для Dokploy

- Статус: принято
- Дата: 5 августа 2026 года
- Затронутые области: frontend, backend-core, backend-execution, Directus,
  process lifecycle, Dokploy/VPS runtime
- Изменение API/БД: публичные API и data ownership не меняются; меняются
  deployable topology, каталоги и process orchestration

## Контекст

После логической консолидации по ADR-2026-040 репозиторий всё ещё содержал
старые top-level package names и отдельные deployment profiles для admin,
Realtime и каждого worker. Это создавало впечатление множества
микросервисов, усложняло Dokploy и оставляло неиспользуемый Directus-контур с
собственными PostgreSQL/Redis/SMTP/storage secrets.

Frontend admin уже использует тот же session/API boundary, а Core Realtime и
Execution workers собираются из тех же artifacts. Для текущей нагрузки нет
измерений, оправдывающих отдельный container lifecycle каждого профиля.
Directus не был настроен и не являлся фактическим источником контента:
frontend всегда имел статический типизированный fallback.

## Решение

Оставить ровно три прикладных deployable-сервиса:

1. `frontend` — единый Next.js artifact с public routes, `/app`, `/admin` и
   same-origin BFF;
2. `backend-core` — Platform API + SEO composition, Realtime и опциональный
   Web Push;
3. `backend-execution` — Jobs HTTP и execution worker roles.

`backend-core` и `backend-execution` используют небольшой process supervisor.
Каждая role остаётся отдельным Node.js child process с собственным event loop
и явным allowlist окружения. Неожиданный выход любой обязательной role
останавливает container, чтобы orchestrator перезапустил согласованный набор.
SIGINT/SIGTERM передаются всем children.

Исходные доменные пакеты Core физически находятся в
`backend-core/modules/{api,seo,realtime}`. Общие contracts и supervisor
находятся в `packages`. Старые top-level `platform-*` каталоги удаляются.

Directus, его DB/Redis/SMTP/storage configuration и runtime удаляются.
Маркетинговый контент текущей версии хранится как типизированный source в
frontend. Возврат headless CMS возможен после появления редакционного
workflow и требует нового ADR с миграцией контента, access model и backup
policy.

Infrastructure containers и one-shot migrations остаются в Compose, но не
считаются прикладными сервисами. Data ownership не объединяется этим решением:
четыре существующие Prisma migration histories и compatibility databases
сохраняются до отдельного проверяемого data cutover.

## Security boundary

Container получает union secrets своих roles, потому что container — единица
Dokploy deployment. Supervisor не наследует окружение целиком в children:
DB, Redis, NATS, SMTP, payment, Web Push и vault variables передаются только
явно разрешённым процессам. PostgreSQL roles, Redis ACL, internal tokens и
credential broker продолжают обеспечивать capability boundary независимо от
env-фильтрации.

Два backend containers остаются разными security/failure domains: provider
credential execution не переносится в Core.

## Последствия

Положительные:

- в Dokploy три понятных application targets вместо набора профилей;
- один frontend release исключает рассинхронизацию app/admin UI;
- меньше image builds, health checks и restart units;
- source tree отражает фактическую архитектуру;
- удалены неиспользуемые CMS database, Redis, secrets и operational surface.

Компромиссы:

- отдельную role нельзя независимо перезапустить или масштабировать внутри
  одного container;
- утечка на container boundary потенциально затрагивает union его secrets,
  поэтому child env allowlists не заменяют OS/container isolation;
- падение обязательной role перезапускает весь backend component.

При доказанном bottleneck одну role можно запустить отдельным profile того же
artifact без возврата старых исходных сервисов. Такое изменение требует
метрик и обновления ADR/карты.

## Миграция и rollback

1. Переместить каталоги и обновить workspace/package/import paths.
2. Объединить admin routes в `frontend`.
3. Добавить supervisors и scoped runtime definitions.
4. Свести Compose к трём application services; сохранить one-shot migrations.
5. Удалить Directus и его инфраструктуру после подтверждения отсутствия
   настроенного authoritative content.
6. Выполнить Prisma validation/generation, TypeScript/lint/tests/build и
   runtime smoke.

Rollback до предыдущей topology выполняется возвратом предыдущего Git release
и его environment template. Database rollback не нужен: schema/data ownership
этим ADR не менялись. Directus data rollback отсутствует, потому что
authoritative Directus instance и контент не существовали.
