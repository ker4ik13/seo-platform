# PostgreSQL 18 и Prisma: модель данных

## 1. Общие соглашения

- Основные ID: UUIDv7, генерируемый PostgreSQL 18 либо приложением с проверенной реализацией.
- Время: `timestamptz`, UTC.
- Деньги: `bigint` minor units + `char(3)` currency.
- Версия optimistic locking: `integer`, начиная с 1.
- Soft delete используется только там, где необходимо восстановление.
- Финансовые и audit записи не изменяются.
- JSONB применяется для конфигураций и provider payload metadata, но не заменяет нормальную модель основных полей.
- Названия таблиц и колонок — `snake_case`; Prisma models могут быть PascalCase с `@@map`.
- В каждой tenant-таблице есть `workspace_id`.
- В проектной таблице есть `project_id`.
- Все внешние service IDs хранятся как scalar UUID без Prisma relation.

## 2. Базы данных

- `platform_db`;
- `seo_db`;
- `jobs_db`;
- `realtime_db`.

На старте базы могут находиться в одном PostgreSQL cluster, но используют
отдельных пользователей и databases. Для четырёх application databases
фиксированы пары `platform_owner/platform_runtime`, `seo_owner/seo_runtime`,
`jobs_owner/jobs_runtime`, `realtime_owner/realtime_runtime`: owner применяется
только к migrations, runtime не владеет объектами и получает после migration
только CRUD/sequence и точные routine privileges без DDL, `TRUNCATE` и
`_prisma_migrations`. Обе роли не имеют membership, cluster privileges,
replication или `BYPASSRLS`. Cluster bootstrap credential сервисам запрещён.
First-match HBA разрешает каждой family только точную собственную database и
до общих rules отклоняет соседние databases и replication.

## 3. PostgreSQL extensions

Планируемые:

- `pg_trgm`;
- `citext` при подтверждённой необходимости;
- `btree_gin`/`btree_gist` по результатам query design;
- `pg_stat_statements`;
- UUIDv7 используется встроенной функцией PostgreSQL 18.

Любое расширение включается migration и должно быть доступно в выбранном deployment.

## 4. `platform_db`

### 4.1. Identity

#### `users`

- id;
- email_normalized unique;
- email_display;
- email_verified_at;
- password_hash nullable;
- display_name;
- avatar_url;
- locale;
- timezone;
- country;
- status;
- last_login_at;
- created_at;
- updated_at;
- deleted_at;
- version.

Indexes:

- unique email_normalized where not deleted;
- status;
- created_at.

#### `user_identities`

- id;
- user_id;
- provider;
- provider_subject;
- provider_email;
- metadata;
- created_at;
- last_used_at.

Unique: `(provider, provider_subject)`.

#### `sessions`

- id;
- user_id;
- token_family_id;
- refresh_token_hash;
- device;
- user_agent_hash/summary;
- IP/security metadata;
- created_at;
- last_seen_at;
- expires_at;
- revoked_at;
- revoke_reason.

`family_id` является aggregate ID terminal lifecycle. Все security-значимые
session writers одного пользователя сериализуются user-scoped PostgreSQL
advisory transaction lock. Terminal helper выбирает distinct active families,
условно меняет только `revoked_at IS NULL` с единым timestamp и создаёт по
одному `identity.session-family.revoked.v1` outbox row только для family, где
реально изменилась хотя бы одна session. Rotation внутри family не terminal и
событие не создаёт. Текущий producer использует существующие `sessions` и
`outbox_events`; новая таблица или Prisma migration не требуется.
Новые family IDs — UUIDv7; существующие UUIDv4 продолжают читаться без
backfill, так как колонка и event aggregate принимают UUID независимо от
версии.

#### `mfa_methods`

- id;
- user_id;
- type;
- secret_encrypted/reference;
- status;
- created_at;
- confirmed_at;
- last_used_at.

#### `recovery_codes`

- id;
- user_id;
- code_hash;
- used_at.

#### `mfa_challenges`

- id;
- user_id;
- token_hash;
- attempt_count;
- expires_at;
- consumed_at;
- минимальные IP/user-agent security metadata;
- created_at.

Challenge token хранится только как hash. Cleanup удаляет истёкшие challenges
по retention-политике; сессия не создаётся до атомарного consumed transition.

### 4.2. Workspace и RBAC

#### `workspaces`

- id;
- name;
- slug;
- logo_object_key;
- country;
- locale;
- timezone;
- billing_currency;
- data_region;
- status;
- owner_user_id;
- created_at;
- updated_at;
- deletion_scheduled_at;
- version.

#### `workspace_members`

- id;
- workspace_id;
- user_id;
- system_role_code nullable;
- custom_role_id nullable;
- all_projects;
- status;
- joined_at;
- invited_by;
- last_active_at;
- version.

Unique: `(workspace_id, user_id)`.

#### `roles`

- id;
- workspace_id nullable for system template;
- code;
- name;
- description;
- is_system;
- created_at;
- updated_at;
- version.

#### `permissions`

- code primary key;
- resource;
- action;
- description.

#### `role_permissions`

- role_id;
- permission_code;
- effect allow/deny.

Unique: `(role_id, permission_code)`.

#### `workspace_invites`

- id;
- workspace_id;
- email_normalized;
- email_display;
- role_code;
- all_projects;
- project_accesses JSONB;
- message;
- token_hash;
- status;
- expires_at;
- accepted_at;
- declined_at;
- revoked_at;
- invited_by;
- created_at.

`project_accesses` в приглашении хранит только проверенный снимок
`[{ projectId, level }]`; после принятия он нормализуется в
`project_member_access`. Открытый invitation token в БД, outbox, очереди и
логах не хранится.

Активные приглашения адресата читаются только по `email_normalized` его
активного подтверждённого аккаунта. Принятие и отклонение сериализуются на
строках пользователя, workspace и invite; `DECLINED` является отдельным
terminal state и не подменяет отзыв приглашения администратором.

#### `project_member_access`

- id;
- project_id;
- member_id;
- level `none/viewer/member/manager`;
- created_at;
- updated_at.

Unique: `(project_id, member_id)`. Проектный уровень может только сужать
workspace role; отсутствие записи означает полный role access только при
`all_projects=true`.

### 4.3. Projects

#### `projects`

- id;
- workspace_id;
- name;
- slug;
- primary_domain;
- domain_normalized;
- type;
- locale;
- timezone;
- search_city_name nullable;
- search_city_yandex_region_code nullable;
- search_city_google_region_code nullable;
- status;
- tags;
- template_id;
- owner_user_id;
- display_order integer not null;
- created_by;
- created_at;
- updated_at;
- archived_at;
- deletion_scheduled_at;
- version.

Indexes:

- `(workspace_id, status, updated_at desc)`;
- `(workspace_id, display_order, created_at, id)`;
- `(workspace_id, domain_normalized)`;
- `(workspace_id, slug)` unique.

`display_order` — Core-owned общий порядок внутри workspace. Additive migration
детерминированно backfill-ит его по `(created_at, id)`. Reorder, create и
меж-workspace transfer берут row lock workspace перед вычислением/изменением
позиций; reorder принимает только точную перестановку полного текущего набора,
поэтому concurrent либо неполная команда не может затереть чужой проект.

`owner_user_id` backfill-ится из владельца workspace и обязателен. `created_by`
остаётся неизменяемой исторической ссылкой на автора и не используется как
текущее владение.

Три поля `search_city_*` либо все равны `NULL`, либо вместе задают выбранный в
настройках российский город и provider-specific коды. Они являются только
default preference; region каждого фактического запуска сохраняется в его
immutable input/context.

#### `project_transfer_requests`

- id UUIDv7;
- workspace_id;
- project_id;
- from_user_id;
- to_user_id;
- requested_by;
- destination_workspace_id nullable до принятия;
- source_project_status для восстановления lifecycle после переноса;
- status `pending/processing/accepted/declined/cancelled/expired`;
- attempt_count, next_attempt_at и last_error_code для bounded reconcile;
- expires_at;
- processing_started_at / accepted_at / declined_at / cancelled_at;
- created_at / updated_at.

Partial unique index по `project_id WHERE status IN ('PENDING','PROCESSING')`
сериализует активную передачу. Check constraints запрещают одинаковых участников,
неположительный TTL и противоречивые terminal timestamps. Terminal Core
commit меняет `projects.workspace_id`, `owner_user_id`, project access и
transfer status одной transaction после подтверждённых Execution reset и
Core SEO tenant re-scope по ADR-2026-042.

#### `project_domains`

- id;
- project_id;
- kind primary/mirror/subdomain;
- scheme;
- host;
- path_prefix;
- canonical;
- created_at.

#### `project_templates`

- id;
- workspace_id nullable;
- name;
- type;
- config;
- version;
- status.

### 4.4. Audit

#### `audit_events`

- id UUIDv7;
- workspace_id;
- project_id nullable;
- actor_type;
- actor_id;
- action;
- resource_type;
- resource_id;
- before_redacted;
- after_redacted;
- metadata;
- IP;
- user_agent summary;
- correlation_id;
- occurred_at.

Партиционирование: monthly range by occurred_at.

### 4.5. Billing

#### `plans`, `plan_versions`, `plan_prices`, `plan_features`

Хранят versioned catalog.

Лимит участников хранится в immutable JSONB snapshot `features.seats` каждой
версии тарифа. Стартовая collaboration-сетка версии 2: Trial — 3, Solo — 10,
Team — 20, Agency/Business/Enterprise — 50. Публикация нового лимита закрывает
effective interval предыдущей версии и копирует цены в новую версию; уже
созданная подписка продолжает ссылаться на свой exact `plan_version_id`.

#### `subscriptions`

- id;
- workspace_id;
- plan_version_id;
- status;
- period;
- currency;
- current_period;
- trial/grace/cancel fields;
- provider;
- external IDs;
- version.

#### `usage_events`

- id;
- workspace_id;
- meter;
- quantity numeric;
- occurred_at;
- source_type/id;
- idempotency_key;
- metadata.

Unique idempotency key per source.

#### `ledger_accounts`

- id;
- workspace_id nullable;
- type;
- currency;
- status.

#### `ledger_transactions`

- id;
- type;
- business_reference unique;
- description;
- occurred_at;
- created_by;
- metadata;
- reversal_of nullable.

#### `ledger_entries`

- id;
- transaction_id;
- account_id;
- direction;
- amount_minor positive;
- currency.

DB constraint/trigger или application invariant гарантирует баланс transaction.

#### `balance_reservations`

- id;
- workspace_id;
- job_id external;
- amount_minor;
- currency;
- status;
- expires_at;
- captured_amount;
- version.

#### `budgets`

- id;
- workspace_id;
- scope_type;
- scope_id;
- period;
- soft_limit;
- hard_limit;
- currency;
- action;
- version.

#### `payments`, `refunds`

- provider и immutable external ID;
- workspace/subscription/order reference;
- gross amount/currency;
- status;
- payment method type;
- succeeded/cancelled/refunded timestamps;
- verified provider payload reference;
- reconciliation state;
- idempotency/version.

Unique `(provider, external_id)`. Provider payload целиком при необходимости
хранится зашифрованно/S3 по retention, а не в audit.

#### `npd_receipt_obligations`

Таблица создаётся только для receipt workflow платежей ЮKassa:

- id;
- payment_id unique;
- yookassa_payment_id unique;
- gross_amount_minor/currency;
- paid_at;
- service_description_snapshot;
- buyer_type;
- buyer_name/inn;
- delivery_email/phone encrypted or access-controlled;
- registration_mode;
- status;
- official_receipt_id/url;
- artifact_object_key;
- registered_at/delivered_at;
- delivery_attempts;
- cancellation_reason;
- replacement_receipt_id;
- audit timestamps/version.

Не хранит логин, пароль, access token или session cookies «Мой налог».

### 4.6. Platform API/webhooks

#### `api_clients`

- id;
- workspace_id;
- name;
- client_id;
- secret_hash;
- scopes;
- status;
- last_used_at;
- created_at.

#### `webhook_endpoints`

- id;
- workspace_id;
- URL;
- secret_encrypted/reference;
- event_types;
- status;
- version.

#### `feature_flags` и `feature_flag_targets`

Versioned rollout configuration.

### 4.7. Rank execution authorization

#### `rank_execution_grant_receipts`

Immutable Platform-owned decision перед новым provider submit хранит:

- workspace/project/actor/membership и их project/membership version
  evidence;
- opaque external Job/JobItem/execution-attempt и policy version;
- tenant-scoped idempotency scope/key;
- независимые 32-byte request/scope hashes и exact allowlisted request/response
  JSON snapshots;
- `GRANTED|DENIED`, finite denial reason, DB-derived decision time и для
  grant — expiry ровно через 30 секунд;
- обязательный authoritative `quota_reservation_id` только для `GRANTED`;
- bounded safe correlation ID и created timestamp.

Unique `(workspace_id, idempotency_scope, idempotency_key)` обеспечивает exact
replay/conflict, а `(workspace_id, job_item_id, execution_attempt)` запрещает
две авторизации одного submit attempt под разными keys. CHECK matrix требует
reservation и exact TTL для `GRANTED`, отсутствие reservation/expiry для
`DENIED`, bounded hashes/JSON и API-equivalent policy/idempotency/correlation
formats. `BEFORE UPDATE OR DELETE` и `BEFORE TRUNCATE` triggers запрещают
переписывать receipt. External Jobs IDs остаются opaque и не получают
cross-database FK.

Историческое имя `quota_reservation_id` сохранено для совместимости схемы.
В BYOK rank связанная immutable row является usage/grant receipt и не задаёт
дневной предел; production policy не считает эти строки при admission.

Expiry не изменяет receipt и не создаёт synthetic denial: exact replay
возвращает исходный snapshot, а Jobs проверяет expiry при будущем атомарном
import/consume. Production BYOK policy создаёт связанную audit row и может
сохранить `GRANTED` без внутренней дневной квоты.

## 5. `seo_db`

### 5.1. Project projection

#### `projects`

Локальная event-driven projection:

- id;
- workspace_id;
- name;
- domain;
- status;
- locale;
- timezone;
- source_version;
- updated_at.

### 5.2. Семантика

#### `keywords`

- id;
- workspace_id;
- project_id;
- text_original;
- text_normalized;
- language;
- status;
- priority;
- is_favorite;
- show_ai_answer_button, видимость shortcut сохранённого ИИ-ответа рядом с
  запросом;
- is_tracked;
- group_id;
- cluster_id;
- target_page_id;
- intent;
- note nullable, до 4 000 символов;
- intent_confidence;
- intent_source;
- commerciality;
- geo_dependency;
- word_count;
- char_count;
- source_type;
- source_id;
- created_by;
- updated_by;
- created_at;
- updated_at;
- deleted_at;
- version.

`is_tracked` — канонический пользовательский переключатель участия keyword в
новых съёмах позиций. Он имеет default `true`, меняется versioned keyword-
командами и не зависит от temporal assignments. При добавлении запроса в
tracking context значение не переписывается. Rank scope читает колонку
авторитетно и включает строки со значением `false` только при явном immutable
launch override `includeUntracked = true`.

Indexes:

- unique `(project_id, text_normalized)` where deleted_at null, если включён строгий dedup;
- `(workspace_id, project_id, status, created_at desc, id desc)` для
  tenant-scoped keyset pagination;
- `(project_id, group_id, id)`;
- `(project_id, cluster_id, id)`;
- `(project_id, target_page_id)`;
- `(project_id, is_tracked)`;
- GIN/trigram on text_normalized;
- partial issues indexes.

Для trigram-поиска migration владельца `seo_db` включает PostgreSQL extension
`pg_trgm`. Extension принадлежит `seo_owner`, а отдельный audited bootstrap
step отзывает `PUBLIC EXECUTE` у member functions и выдаёт их только
`seo_runtime`; произвольные public extensions запрещены. Точный `count`
выполняется только для первой страницы; cursor-page
не повторяет его. Каждый query одновременно фильтруется по `workspace_id`,
`project_id` и активному status.

При необходимости строгий dedup заменяется отдельной `keyword_unique_keys`, чтобы поддержать variants.

#### `keyword_merges`

- `id`, `workspace_id`, `project_id`;
- уникальный `source_keyword_id` и индексированный `target_keyword_id`;
- snapshot исходных `source_text`, `source_language`;
- `created_by`, `created_at`.

Обе ссылки имеют составной tenant FK на `keywords`; source и target обязаны
различаться. Перед созданием правила все прежние алиасы source-target
перенаправляются непосредственно на конечный target, поэтому чтение не требует
рекурсивного обхода. Immutable snapshots сохраняют исходный keyword ID, а read
models соединяют его с активным target через эту таблицу.

#### `semantic_negative_keyword_presets`

- `id`, `workspace_id`, `project_id`;
- `name`, `normalized_name`;
- `words text[]` cardinality `1..500`;
- `match_mode = CONTAINS | WHOLE_WORD`;
- `case_sensitive`;
- `status`, `version`, actor/timestamps и soft-delete metadata.

Активное имя уникально внутри проекта. Таблица принадлежит semantic core,
участвует в точном allowlist project transfer и не содержит provider secrets.

#### `keyword_variants`

- id;
- keyword_id;
- text;
- normalized;
- source;
- metadata.

#### `groups`

- id;
- workspace_id;
- project_id;
- parent_id;
- name;
- path/cache;
- color;
- sort_order;
- description;
- keyword_count_cache;
- count_status;
- created_at;
- updated_at;
- deleted_at;
- version.

Иерархия: adjacency list + materialized path/closure table по результатам benchmark.

#### `group_closure`

- ancestor_id;
- descendant_id;
- depth.

#### `clusters`

- id;
- workspace_id;
- project_id;
- group_id;
- name;
- method;
- confidence;
- config;
- target_page_id;
- locked;
- created_by_job_id;
- created_at;
- updated_at;
- version.

#### `tags`, `keyword_tags`

Many-to-many.

#### `custom_columns`

- id;
- project_id;
- name;
- type;
- config;
- formula;
- formula_version;
- status;
- permissions;
- version.

#### `keyword_custom_values`

Выбирается один из вариантов после benchmark:

1. typed EAV columns;
2. JSONB values per keyword;
3. отдельные generated tables для часто фильтруемых columns.

Требование: фильтруемые custom columns должны иметь индексируемую typed representation. Хранение всего только в JSONB без стратегии индексов запрещено.

#### `saved_views`

- id;
- project_id;
- owner_id;
- scope;
- name;
- config;
- version.

### 5.3. Страницы

#### `pages`

- id;
- workspace_id;
- project_id;
- URL;
- URL_normalized;
- host;
- path;
- type;
- status;
- indexability;
- HTTP status;
- canonical_page_id;
- robots;
- metadata fields;
- content status;
- owner_id;
- crawled_at;
- created_at;
- updated_at;
- version.

Unique `(project_id, url_normalized)`.

#### `keyword_page_assignments`

- id;
- keyword_id;
- page_id;
- type primary/alternate/observed;
- source;
- confidence;
- rationale;
- active;
- created_at;
- ended_at;
- version.

#### `page_snapshots`

Append-only technical/content snapshots.

#### `radar_configurations`, `radar_runs`

- scope/view/sitemap;
- interval/timezone/window;
- requests_per_minute/concurrency;
- max URLs/runtime;
- field watch rules;
- own/competitor host policy;
- backoff/paused state;
- last/next run;
- immutable run settings snapshot.

#### `page_changes`

- project/page/snapshot IDs;
- field/rule;
- before/after normalized value or S3 reference;
- before/after hashes;
- severity;
- detected_at;
- acknowledged/resolved state;
- notification reference.

Append-only evidence не переписывается при acknowledgement.

#### `generated_sitemaps`, `generated_sitemap_files`

- project/config/version;
- source snapshot;
- status;
- URL counts;
- validation summary;
- checksum/object key;
- generated/published/submitted timestamps;
- previous version relation.

### 5.4. Tracking

#### `tracking_contexts`

- id, logical context ID;
- workspace_id;
- project_id;
- name;
- status `ACTIVE/ARCHIVED`;
- created_by;
- updated_by;
- archived_by nullable;
- version для optimistic concurrency;
- created_at;
- updated_at;
- archived_at nullable.

Эта таблица хранит пользовательскую идентичность контекста, но не provider,
credential, fallback, budget, schedule и поисковые параметры. Hard delete в
пользовательском flow отсутствует; archive/restore сохраняют конфигурационную
историю и назначения.

Ограничения и индексы:

- unique `(workspace_id, project_id, id)` для tenant-safe дочерних связей;
- index `(workspace_id, project_id, status, created_at, id)`;
- `version > 0`;
- `archived_by/archived_at` обязательны только для `ARCHIVED` и отсутствуют
  для `ACTIVE`.

#### `tracking_context_versions`

- workspace_id;
- project_id;
- depth: `10|20|30|50|100`; значения 10/20 используются конкурентными
  срезами, обычный position workflow ограничен 30/50/100;
- context_id;
- configuration_version;
- search_engine `GOOGLE/YANDEX`;
- country_code ISO alpha-2;
- region_code nullable, канонический код региона платформы;
- region_label nullable и допустим только вместе с region_code;
- language BCP 47;
- device `DESKTOP/MOBILE`;
- depth `30/50/100`;
- domain_match_mode;
- domain_match_value nullable;
- safe_search;
- configuration_hash SHA-256;
- created_by;
- created_at.

Primary key: `(context_id, configuration_version)`. Дополнительный unique
`(workspace_id, project_id, context_id, configuration_version)` и составной
foreign key в `tracking_contexts` не позволяют связать версию с другим
tenant/project. У режимов `SPECIFIC_URL/URL_PREFIX` значение обязательно, у
остальных режимов — запрещено.

Configuration version неизменяема: изменение любой поисковой настройки
добавляет следующую строку. Rename, archive и restore меняют только entity
version в `tracking_contexts` и не создают фиктивную configuration version.
Rank manifest/snapshot обязан ссылаться на точную configuration version, а не
только на logical context.

#### `tracking_context_keyword_assignments`

- id;
- workspace_id;
- project_id;
- context_id;
- keyword_id;
- assigned_by;
- assigned_at;
- removed_by nullable;
- removed_at nullable.

Назначение temporal и не удаляется физически. Снятие закрывает период через
`removed_by/removed_at`; повторное назначение создаёт новую строку. Partial
unique `(workspace_id, project_id, context_id, keyword_id) WHERE removed_at
IS NULL` допускает только один активный период. Составные foreign keys к
контексту и keyword включают `workspace_id/project_id` и используют
`ON DELETE RESTRICT`.

Assignment отвечает только за membership сохранённого tracking context.
`SemanticKeywordListItem.isTracked` читается из `keywords.is_tracked`; создание
или закрытие assignment не меняет пользовательский переключатель.

#### `tracking_context_create_receipts`

- workspace_id;
- project_id;
- actor_id;
- idempotency_key;
- request_hash, ровно 32 bytes;
- context_id;
- immutable response_snapshot;
- created_at.

Primary key:
`(workspace_id, project_id, actor_id, idempotency_key)`. Exact replay
возвращает исходный snapshot создания, в том числе после последующих
изменений context. Другой request hash под тем же ключом возвращает
`IDEMPOTENCY_CONFLICT`. Receipt и logical context создаются одной
транзакцией.

Migration `20260729130000_versioned_tracking_contexts` преобразует раннюю
provider-shaped foundation table только при пустых `tracking_contexts`,
`rank_snapshots` и `current_ranks`. Все три таблицы блокируются
`ACCESS EXCLUSIVE` до проверки. Наличие хотя бы одной legacy строки
останавливает migration; для такого окружения требуется отдельный
expand → inspect → backfill → validate → contract plan.

### 5.5. Rank snapshots

#### `rank_snapshots`

- id;
- workspace_id;
- project_id;
- keyword_id;
- context_id;
- captured_at;
- provider;
- provider_version;
- position;
- absolute_position;
- pixel_position;
- ranking_url;
- ranking_url_normalized;
- title;
- result_type;
- found;
- features;
- raw_serp_object_key;
- job_id;
- quality_flags;
- created_at.

Partitioning:

- range by `captured_at`, daily or monthly based on volume;
- optional subpartition/hash by project for very large deployments.

Indexes per partition:

- `(project_id, context_id, captured_at desc)`;
- `(keyword_id, context_id, captured_at desc)`;
- `(project_id, captured_at, position)`;
- BRIN captured_at.

#### `rank_current`

Projection:

- keyword_id;
- context_id;
- snapshot_id;
- position;
- previous_position;
- ranking_url;
- captured_at;
- delta;
- quality.

Primary key `(keyword_id, context_id)`.

#### `project_position_history_revisions` и `project_position_history_projections`

Постоянная read-проекция главного графика принадлежит Core SEO. Revision table
имеет tenant primary key `(workspace_id, project_id)` и монотонный `BIGINT`.
Statement-level triggers с transition tables увеличивают revision один раз на
SQL statement при добавлении rank snapshots и при изменении tracked/status,
контекстов, history deletions, keyword merges или rank-dimension merges.

Projection table имеет primary key
`(workspace_id, project_id, scope_hash)` и хранит:

- version алгоритма;
- exact source revision;
- bounded JSON до 100 дневных точек;
- время построения.

Read использует payload только при полном совпадении revision и версии схемы.
После rank finalization и semantic import tracked-проекция прогревается; для
других dimension/include-untracked scopes действует lazy rebuild. Решение и
freshness protocol зафиксированы в
`ADR-2026-049-project-position-history-projection.md`.

### 5.6. Frequency snapshots

#### `frequency_snapshots`

- id;
- project_id;
- keyword_id;
- type;
- value;
- region;
- device;
- period;
- observed_at;
- provider;
- job_id;
- quality_flags.

Partitioning monthly by observed_at.

#### `frequency_current`

Projection by keyword/type/context.

### 5.7. SERP

#### `serp_snapshots`

- id;
- project_id;
- keyword_id;
- context_id;
- captured_at;
- provider;
- depth;
- raw_object_key;
- checksum;
- feature_summary;
- quality_flags;
- job_id.

#### `serp_results`

- snapshot_id;
- ordinal;
- organic_position;
- absolute_position;
- type;
- URL;
- URL_normalized;
- host;
- title;
- snippet;
- metadata.

Partitioned/aligned with snapshots. Не все raw fields нормализуются.

### 5.8. Конкуренты

#### `competitors`

- id;
- project_id;
- domain;
- domain_normalized;
- name;
- type;
- priority;
- scope;
- active;
- created_at;
- version.

#### `competitor_keyword_snapshots`, `competitor_page_snapshots`

Append-only provider data.

### 5.9. Analytics

#### `analytics_connections_projection`

Только connection ID/capabilities, без secrets.

#### `search_analytics_daily`

- project;
- source;
- date;
- query nullable;
- page nullable;
- country;
- device;
- clicks;
- impressions;
- CTR;
- position.

Partition monthly.

#### `web_analytics_daily`

- project;
- source;
- date;
- page/dimensions;
- users;
- sessions;
- engagement;
- conversions;
- revenue + currency.

#### `magnet_proposals`, `magnet_proposal_items`

- project;
- source connection/property/date/dimensions snapshot;
- item query/page and normalized key;
- source metrics JSON с field-level provenance;
- classification `NEW/EXISTING/CONFLICT/IGNORED`;
- selected/published state;
- target group/page;
- resulting keyword ID;
- created/expires/published timestamps.

Unique source identity делает повторный sync идемпотентным. Proposal item не
заменяет канонические analytics snapshots.

### 5.10. Issues и версии

#### `issues`

- id;
- project_id;
- rule_id/version;
- type;
- severity;
- status;
- entity_type/id;
- evidence;
- confidence;
- assignee_id;
- first_seen_at;
- last_seen_at;
- resolved_at;
- suppressed_reason;
- version.

#### `semantic_versions`

- id;
- project_id;
- parent_id;
- type;
- actor_id;
- job_id;
- summary;
- affected_count;
- diff_object_key;
- reversible;
- created_at.

#### `entity_change_log`

Partitioned append-only log для history/read model.

## 6. `jobs_db`

### 6.1. Jobs

Таблицы:

- `jobs`;
- `job_attempts`;
- `job_chunks`;
- `job_errors`;
- `job_artifacts`;
- `job_cost_lines`;
- `job_checkpoints`.

Indexes:

- workspace/project/status/created;
- queue/status/priority;
- unique workspace/idempotency scope/idempotency key;
- partial unique active workspace/deduplication key;
- type/status/lease expiry/created;
- type/status/retry time/priority/created;
- provider request ID;
- schedule.

Текущая `jobs` table хранит `idempotency_scope`, опциональную пару
`idempotency_key + 32-byte request_hash`, `lease_owner`,
`lease_expires_at`, `retry_at` и `updated_at`. DB CHECK запрещает только одну
часть idempotency pair. Активный partial unique index охватывает `PREPARING`,
`QUEUED`, `WAITING_RATE_LIMIT`, `RUNNING`, `CANCEL_REQUESTED`,
`RETRY_SCHEDULED`; terminal history не мешает новой команде. Worker получает
lease условным update по прежним status/version, а потерявший lease worker не
может записать terminal result. Dispatcher фильтрует по конкретному `type`,
поэтому operational lease/retry indexes начинаются с `type`, а не с общего
`status`.

#### Реализованный manual rank Job graph

Первый manual rank runtime создаёт `MANUAL_RANK_CHECK` только в
`PREPARING/PREPARING_SCOPE`. Для него DB triggers фиксируют неизменяемыми
tenant/actor/idempotency, input/scope snapshots, total/unit, оценочную
стоимость/currency, provider/mode, max attempts, correlation и created time.
Отдельная transition matrix запрещает возврат terminal Job в active status.
`ACTION_REQUIRED` допустим только как terminal
`SUBMIT_OUTCOME_UNKNOWN` с нулём подтверждённо сохранённых результатов и
всеми парами в unknown count.

Каждый такой `jobs` row обязан иметь ровно один `rank_job_runs` sidecar;
deferred constraints запрещают commit неполного либо несогласованного graph.
Tenant-safe composite FK связывает обе записи. Create вставляет Job, затем
sidecar в одной транзакции; все мутации уже существующего graph сначала
берут `SELECT ... FOR UPDATE` на `Job`, затем на `RankJobRun`. Один порядок
lock устраняет взаимную блокировку cancel/claim/persist/finalize; после
internal seal request допускается только один контролируемый Job version
drift — запись cooperative cancel.

#### `keyword_research_runs` и `keyword_research_rows`

`keyword_research_runs` принадлежит Jobs DB и хранит tenant/actor scope,
источник `KEYS_SO|ARSENKIN_WORDSTAT|XMLSTOCK_WORDSTAT`, provider, immutable `input_snapshot`,
opaque `provider_task_id`, статус, lease/version, retry, итоговые счётчики,
Keys.so overview/competitors и подтверждённый `target_group_path`.
`distribution_mode` фиксирует общую раскладку Wordstat: одна папка или
вложенные папки по исходным seed-фразам.
`keyword_research_rows` хранит нормализованный запрос, URL/позицию/частотности,
исходную Wordstat seed-фразу и колонку `LEFT|RIGHT`, stable sequence и selected
state. Необязательный row-level `target_group_path` переопределяет общую
раскладку только для этой строки. Raw provider response и secret material не
сохраняются в этих таблицах.

DB broker claim/submit/defer/complete использует version/lease fencing.
Arsenkin run с известным `provider_task_id` может только продолжить poll;
неизвестный исход начавшегося submit не возвращается автоматически в
submit-ready state. XMLStock run продвигается по одному seed через отдельную
lease/version-fenced completion function; повторный worker не может дважды
записать уже завершённую страницу. Confirm импортирует `ALL` либо bounded `SELECTED` rows
через отдельную import-worker роль и не даёт connector-worker прямой доступ к
Core SEO DB.

### 6.2. Imports/exports

- `uploads`;
- `imports`;
- `import_files`;
- `import_mappings`;
- `import_presets`;
- `import_validation_summaries`;
- `exports`;
- `export_artifacts`.

`uploads` хранит tenant/actor scope, opaque object key, исходное отображаемое
имя, MIME declaration, размер, `multipart_id`, размер/число parts,
`idempotency_key`, expiry и timestamps состояний. Опциональный
`declared_checksum` отделён от обязательного фактически вычисленного worker-ом
`checksum`; доверять заявленному значению до inspection запрещено.
Дополнительно сохраняются `detected_media_type`,
`inspection_started_at`, `inspection_heartbeat_at` и
`inspection_completed_at`. `inspection_started_at` является lease token:
terminal update допустим только для worker-а, который всё ещё владеет этим
значением. `scan_result` содержит машинный код результата и технические
метаданные; публичный API возвращает только allowlisted rejection code, но не
malware signature или внутреннюю ошибку dependency.

Row staging создаётся в staging schema/partitioned tables и очищается retention job.

В первом вертикальном срезе parsing metadata хранится в `semantic_imports`, а
сырой ряд — в `semantic_import_staging_rows`. Staging hash-partitioned на 16
partitions по `import_id`; ключ строки — `(import_id, row_number)`. Запись
содержит только исходный массив значений, allowlisted issue codes и
fingerprint. `semantic_imports` хранит tenant/actor scope, upload reference,
requested/detected parsing options, headers, mapping proposal, ограниченный
sample, counters, progress, failure code, lease/heartbeat и optimistic
`version`. Эти таблицы не являются каноническим semantic core и не дают
jobs-сервису право записывать `seo_db` напрямую.

Следующий срез добавляет в `semantic_imports` подтверждённый mapping,
validation/result summary и независимые lease/heartbeat поля validation и
publishing. `semantic_import_validated_rows` hash-partitioned на 16 partitions,
содержит normalized hash, allowlisted canonical row, issue codes,
`is_valid` и `project_duplicate`. Raw и validated staging остаются собственностью
`jobs_db` и удаляются только отдельной retention job после завершения
диагностического срока.

В `seo_db` идемпотентность публикации обеспечивают:

- `semantic_import_receipts` — scope, mapping hash, duplicate policy,
  ожидаемые chunks/rows, итоговая semantic version и result summary;
- `semantic_import_chunk_receipts` — индекс и payload hash чанка, фактические
  счётчики созданных/обновлённых сущностей и snapshots.

`keywords` хранит `source_mode`, `source_id`, `created_by`, `updated_by`;
иерархический путь группы имеет project-scoped hash; `tags` и `keyword_tags`
принадлежат `seo_db`. Canonical merge создаёт/обновляет только сущности этого
владельца БД и никогда не открывает jobs-сервису Prisma connection к `seo_db`.

### 6.3. Integrations

#### `integration_credentials`

- id;
- workspace_id;
- provider;
- mode;
- label;
- payload ciphertext;
- payload 96-bit nonce;
- payload GCM auth tag;
- encrypted_data_key;
- data_key_nonce;
- data_key_auth_tag;
- KEK version;
- masked display hint;
- capabilities;
- status;
- provider metadata без plaintext secret;
- idempotency key;
- keyed request fingerprint без plaintext secret;
- fingerprint key version;
- material version;
- created_by;
- updated_by;
- verified_at;
- last_success_at;
- last_error_at;
- last_error_code;
- deleted_at;
- version.

Текущая реализация использует envelope encryption: случайный 256-bit DEK
шифрует payload через AES-256-GCM, а versioned KEK jobs/integrations шифрует
DEK. Payload AAD содержит workspace, provider и immutable credential ID; AAD
обёрнутого DEK дополнительно содержит KEK version. Новый или заменённый ключ
получает `PENDING_VERIFICATION`. Секретные поля никогда не возвращаются Prisma
DTO наружу; revoke перезаписывает payload ciphertext и encrypted DEK до soft
delete. Ограничения БД проверяют длины GCM nonce/tag, непустые ciphertext/DEK,
положительные KEK/fingerprint key versions и 32-byte request fingerprint.
Уникальный `workspace_id + idempotency_key` делает создание безопасным при
повторе после сетевого timeout. Actor и нормализованный create payload входят
в HMAC под отдельным versioned fingerprint keyring, поэтому тот же workspace
key с другим actor/payload возвращает conflict. Fingerprint создания остаётся
неизменным при rotate/rename: точный повтор исходного POST не создаёт второй
credential и возвращает его текущее masked-представление. После revoke повтор
получает conflict. Отделение `fingerprint_key_version` от `key_version`
позволяет переоборачивать DEK и удалять старый KEK без зависимости от
idempotency lifecycle. Связь `key_version → KEK bytes` immutable: изменение
key material требует новой версии; одноимённая замена существующего значения
запрещена. Все UUID канонизируются до lowercase до вычисления AAD/HMAC и
совпадают с представлением PostgreSQL. `material_version`
увеличивается при полной замене secret payload и позволяет
отбросить устаревший результат параллельной проверки. `last_error_code`
хранит только allowlisted нормализованный код; provider-specific expiry будет
добавлен вместе с connector history.

Добавление `PENDING_VERIFICATION` вынесено в отдельную migration, чтобы новая
PostgreSQL enum value была committed до использования в DEFAULT следующей
migration. Foundation migration с обязательными envelope-полями имеет
fail-closed precondition и одну явную транзакцию: pre-release
`integration_credentials` должна быть пустой, а DDL применяется целиком или
не применяется. Если в окружении уже есть записи, их запрещено удалять ради
deploy: используется отдельный expand → application backfill → validate →
contract план, а failed migration восстанавливается через документированный
`prisma migrate resolve` workflow.

Отдельная migration credential validation добавляет Job idempotency
scope/hash, lease/retry timestamps, `material_version` и `last_error_code`.
Она намеренно fail-closed останавливается при любой строке в pre-release
`jobs`: безопасное значение обязательного `idempotency_scope` нельзя вывести
универсально. Окружение с существующими jobs нельзя очищать ради deploy — для
него заранее выпускается отдельная expand → application backfill → validate →
contract migration.

Validation execution login больше не имеет direct table DML/`SELECT`:
allowlisted `SECURITY DEFINER` broker выдаёт due IDs, exact lease-bound
encrypted projection и принимает три fenced finish outcome. Каждая операция
повторно проверяет тип Job, tenant, credential/material/connector versions,
owner, случайный lease token, row version и DB deadline. Success boundary
также валидирует provider metadata независимо от TypeScript connector:
Arsenkin обязан передать объект ровно с одним неотрицательным safe-integer
`limitsTotal`; SQL `NULL`, JSON `null`, `{}`, лишние ключи и некорректное
число не могут активировать credential. Synthetic authenticated KEK canaries
не содержат tenant material и проверяют все реально используемые версии до
создания worker.

Cluster-wide direct-ACL audit, `PUBLIC`/default ACL hardening и fixed-role HBA
прошли fresh PostgreSQL 18 positive/negative regression. Оставшиеся production
gates — повтор фактического HBA order/login smoke в target environment,
rollout старых replicas, межхостовой TLS/source-CIDR и circuit breaker.
Сам symmetric KEK пока находится в execution process; дальнейшее уменьшение
blast radius требует KMS/asymmetric unwrap или внешнего credential broker.

#### `project_connector_bindings`

- id;
- workspace_id;
- обязательный project_id;
- capability;
- enabled;
- created_by/updated_by;
- version;
- timestamps.

После migration `20260804170000_workspace_project_connector_routing` binding
также хранит `fallback_mode`, allowlisted `fallback_reasons`,
`configuration_scope`, optional snapshot workspace binding ID/version.
`WORKSPACE_INHERITED` требует полный workspace snapshot, а
`PROJECT_OVERRIDE` запрещает его. Это не переносит credential ownership в
проект.

Ограничения:

- unique `workspace_id + project_id + capability`;
- tenant-safe unique `workspace_id + project_id + id` для composite FK;
- положительная version;
- binding не удаляется автоматически и выключается через `enabled=false`.

#### `project_connector_routes`

- id;
- workspace_id/project_id/binding_id;
- position;
- source_kind;
- credential_id;
- timestamps.

Route хранит `routing_scope` и optional `workspace_route_id`. Позиции bounded
`0..7`; project override, inherited workspace default и appended workspace
fallback различаются явными scope. Composite FK
`workspace_id + project_id + binding_id` запрещает подменить tenant проекта,
а FK `workspace_id + credential_id` запрещает привязать credential другого
workspace. Оба FK используют `ON DELETE RESTRICT`: revoke credential
уничтожает secret и soft-deletes запись, но не удаляет историю настройки.
Использованный route также не удаляется и не переиспользуется при смене
project override, переходе на workspace inheritance или сокращении fallback:
он получает `retired_at`, а новая активная проекция создаётся с новым ID.
Partial unique гарантирует одну активную строку на позицию; обычные routing и
estimate queries читают только `retired_at IS NULL`, тогда как execution,
зафиксировавший route ID, сохраняет доступ к immutable historical reference.
Для `SERP_RANK_TRACKING` позиция `0` является маршрутом по умолчанию, а
позиции `1..7` могут быть выбраны явным provider/credential параметром.
Execution повторно проверяет exact route ID, binding, credential и tenant, но
не требует, чтобы явно выбранный маршрут одновременно был route по умолчанию.

#### `workspace_connector_bindings` и `workspace_connector_routes`

Workspace binding уникален по `workspace_id + capability`, содержит enabled,
fallback mode/reasons, actor, version и timestamps. Routes уникальны по
binding position и credential; position ограничена `0..7`. Tenant-safe FK к
`integration_credentials` не позволяет использовать ключ другой рабочей
области. Project inherited bindings ссылаются на workspace binding/version,
а materialized routes — на исходный workspace route. RLS разрешает полный
доступ только jobs runtime; rank runtime получает SELECT только для
`SERP_RANK_TRACKING`.

#### `project_connector_binding_create_receipts`

- workspace_id/project_id/idempotency_key — composite primary key;
- 32-byte request_hash;
- binding_id;
- immutable response_snapshot;
- created_at.

Receipt имеет tenant-safe FK и unique на
`workspace_id + project_id + binding_id`. Он создаётся в одной транзакции с
binding, route и outbox event. Response snapshot возвращает точный исходный
create result даже после PATCH; при чтении его структура, UUID, timestamps,
enum values и совпадение с receipt scope валидируются fail-closed.

Migration заменяет pre-release `integration_bindings` только если таблица
пуста. Сразу после `BEGIN` она берёт `ACCESS EXCLUSIVE` lock legacy-таблицы,
после чего проверка, DROP/CREATE, indexes/FK выполняются одной транзакцией.
Так конкурентный writer не может вставить строку в окне check → DROP. При
наличии строк deploy останавливается и не удаляет их; нужен отдельный expand →
backfill → validate → contract план. Fresh migration, fail-closed rollback и
concurrent-writer сценарий проверены на PostgreSQL 16, повтор на целевом
PostgreSQL 18 обязателен в staging.

#### `rank_estimates`

Короткоживущие provider-free receipts оценки ручного съёма принадлежат
`jobs_db` и не являются `jobs`:

- tenant/actor/tracking context и idempotency scope/key;
- 32-byte request hash;
- project version и hash домена без plaintext domain;
- context/configuration versions и hashes;
- semantic/final scope hashes либо согласованная пара `NULL`, когда bounded
  scope нельзя безопасно materialize для provider;
- private binding/route/credential/material/validation version snapshot;
- provider/mode/policy version;
- optional provider-effective `execution_snapshot` и его 32-byte hash,
  сохраняемые только для согласованной projection и не являющиеся grant;
- keyword/task/minimum stage request counts;
- finite blockers;
- redacted public response snapshot;
- DB-derived `calculated_at`, фиксированный `expires_at` и `created_at`.

Unique `workspace_id + idempotency_scope + idempotency_key` обеспечивает
exact replay и conflict. CHECK constraints требуют 32-byte hashes,
положительные версии, exact chunk counts, JSON array/object, полный
validation proof и TTL пять минут. Hash availability имеет точную матрицу:

- `keyword_count=0` — оба hashes обязательно доступны;
- `keyword_count=1..1000` — оба hashes либо доступны, либо оба `NULL`;
  `NULL` означает bounded, но provider-incompatible text/byte scope;
- `keyword_count=1001` — overflow sentinel, оба hashes обязательно `NULL`;
- только один `NULL` и `1001 + AVAILABLE` запрещены.

Receipt не имеет FK в другую database; IDs внешнего владельца являются
immutable snapshot. `BEFORE UPDATE` trigger запрещает переписывать весь
receipt, включая optional execution pair; физическая очистка остаётся
отдельной maintenance-операцией, а не update. Private IDs и domain hash не
входят в public DTO.

Физическая очистка выполняется отдельной maintenance policy после окна
сетевых повторов и диагностики; expiry не означает автоматическое удаление
проекта, tracking context или результатов. Сам estimate не создаёт provider
usage, billing reservation или Job; отдельный internal `rank-runs` create
может потребить ещё действующий executable receipt только после повторной
проверки всех mutable evidence.

#### `rank_job_runs`

Durable sidecar manual rank Job принадлежит `jobs_db` и хранит:

- tenant/project/job, estimate и tracking context IDs;
- trusted caller project domain/status/version snapshot; authoritative
  current lifecycle требует отдельной project projection/precondition;
- exact immutable manifest command и 32-byte command hash, записанные до
  первого internal HTTP;
- seal state `PENDING`, `OUTCOME_UNKNOWN`, `NOT_SEALED`, `SEALED` или
  `FINALIZED`;
- bounded seal attempt count и время последней попытки;
- immutable manifest ID/hash/deduplication hash/pair/chunk receipt после
  `SEALED`;
- immutable finalization status/request hash/time после `FINALIZED`;
- audit actor первого cancel.

Unique constraints обеспечивают один run на Job, один run на estimate и одно
локальное соответствие manifest ID. `OUTCOME_UNKNOWN` записывается вместе с
claim до внешнего вызова. Receipt fields отсутствуют до доказанного
`SEALED`, после `SEALED/FINALIZED` не переписываются; finalization fields
появляются только при `FINALIZED`. Seal evidence замораживается после
`NOT_SEALED/SEALED/FINALIZED`, строки не удаляются и не обрезаются.

Insert разрешён только как exact `Job(PREPARING, version=1, attempt=0) +
RankJobRun(PENDING, sealAttempt=0)` без lease, result/error/cancel/receipt
evidence. Deferred graph constraints проверяют monotonic attempts,
соответствие actor/tracking context/project version/keyword total executable
estimate, manifest pair count после seal, допустимую Job/seal/finalization
матрицу и provenance cancel actor. Estimate, command и terminal receipts
после записи неизменяемы.

Текущий rank worker задаёт `max_attempts=20`. Retryable ambiguity повторяет
exact idempotent seal/finalize command только в этом budget. Исчерпание
budget либо non-retryable неоднозначность не маркируются как `NOT_SEALED`, а
завершают Job `ACTION_REQUIRED/SUBMIT_OUTCOME_UNKNOWN`. DB matrix допускает
`OUTCOME_UNKNOWN|SEALED` без finalization receipt либо
`FINALIZED/ACTION_REQUIRED`; она не выдумывает единый исход для разных
стадий. PostgreSQL dispatcher выбирает только due, unlocked
`PREPARING/CANCEL_REQUESTED` graph и восстанавливает потерянное BullMQ
сообщение, в котором находится только `jobId`.

#### `rank_execution_grant_attempts`

Jobs-owned durable history намерения получить execution grant хранит:

- tenant/project/Job/JobItem и monotonic execution attempt;
- immutable Job version и stable idempotency key;
- exact private request snapshot;
- независимые 32-byte request/scope hashes и execution-evidence hash;
- optional exact issuer decision snapshot, `decided_at`, 30-секундный
  `expires_at` и terminal timestamp;
- состояние `REQUESTED`, `DENIED`, `GRANTED_PENDING_CONSUME`, `EXPIRED`,
  `CONSUMED` либо `REJECTED_LOCAL`.

Новая строка всегда начинается exact `REQUESTED` до HTTP. Unique
`workspace_id + job_item_id + execution_attempt` и
`workspace_id + idempotency_key` не позволяют двум конкурентам создать
разные identities одной попытки. Retryable transport ambiguity оставляет
строку `REQUESTED` и повторяет сохранённые request/idempotency key, а не
строит новый scope из mutable state.

Перед insert и при записи decision Jobs использует canonical lock order
`Job → RankJobRun → JobItem → credential → validation Job → binding → route
→ RankExecutionGrantAttempt`, DB clock и exact revalidation execution graph.
Состояния `DENIED`, `EXPIRED` и `REJECTED_LOCAL` terminal. Валидный
неистёкший grant сохраняется как `GRANTED_PENDING_CONSUME` и сам по себе не
разрешает provider call. Повторная проверка current graph до expiry атомарно
создаёт единственную `rank_connector_executions` row и переводит attempt в
`CONSUMED`. После `GRANTED_PENDING_CONSUME` decision/expiry immutable,
физические delete/truncate запрещены. `credential_verified_at` и подписанные
execution-контракты канонизированы до миллисекунд, потому что это максимальная
точность `Date`. Validation Job может хранить `finished_at` с микросекундами
PostgreSQL; DB guard сравнивает его через
`date_trunc('milliseconds', finished_at)`, одновременно сохраняя exact
validation ID/version, connector version, material version и 24-часовое окно.

Tenant-composite FK связывают attempt с `jobs`, `rank_job_runs` и
`job_items`. Та же migration fail-closed проверяет legacy JobItem scope,
заменяет прежнюю parent FK на tenant-safe связи и добавляет trigger, который
не допускает расхождение `workspace/project/job` с parent Job. Migration
`20260729230100_rank_execution_grant_attempts` имеет schema/static coverage;
fresh full-chain apply, constraint-negative grant/consume и конкурентный
single-consumer smoke пройдены на PostgreSQL 18. Production-role permission
proof и гонки с будущим provider lifecycle остаются release gate.

#### `rank_connector_executions`

Secret-free scoped execution принадлежит `jobs_db` и хранит:

- exact tenant/Job/JobItem/grant attempt/execution attempt;
- estimate, manifest/hash/chunk и execution-evidence hash;
- binding/route/credential/validation IDs и их immutable versions;
- versioned execution connector, provider policy и kill switch;
- исходный grant expiry, состояния
  `READY_TO_SUBMIT → CLAIMED → SUBMITTING`, bounded lease owner/token/expiry,
  monotonic lease generation и row version;
- единственную submit attempt и durable `submit_bytes_started_at`: после её
  commit provider bytes могли начаться, поэтому автоматический повторный
  submit запрещён.

Ciphertext, wrapped DEK, nonce/tag, plaintext secret и provider request в эту
таблицу не копируются. Insert разрешён только для неистёкшего
`GRANTED_PENDING_CONSUME` под current Job/item/manifest/binding/route/
credential/validation evidence. Tenant-safe FK и trigger повторно проверяют
ACTIVE credential, COMPLETED validation, отсутствие cancel, SEALED manifest и
exact estimate projection.

Одна транзакция сначала создаёт scoped execution, затем переводит grant
attempt в `CONSUMED`. Два deferred constraint triggers требуют на commit
exact one-to-one `CONSUMED ↔ rank_connector_execution` во всех разрешённых
состояниях и запрещают любую половину. Execution identity остаётся immutable;
разрешены только точный `READY_TO_SUBMIT → CLAIMED`, reclaim истёкшего
`CLAIMED → CLAIMED` с новым token/generation и однонаправленный
`CLAIMED → SUBMITTING`. Lease не выходит за grant expiry. Delete/truncate
запрещены.

`rank_connector_execution_controls` хранит default-closed submit flag и
exact connector/policy/kill-switch versions. Каждая использованная
kill-switch version навсегда резервируется в immutable
`rank_connector_execution_control_versions`, включая initial version новых
control rows; поэтому rollback `A → B → A` отклоняется атомарно.

`claim_rank_connector_execution` — `SECURITY DEFINER` функция с
`search_path = pg_catalog, pg_temp`. Она сначала ищет весь eligible current
graph, чтобы stale ранняя row не блокировала очередь, затем удерживает locks
строго в порядке `Job → RankJobRun → JobItem → credential → validation Job →
binding → route → grant → execution → control` и после ожиданий повторно
проверяет execution version/state, Job/cancel, credential, grant expiry и
control versions. Возвращается только одна exact encrypted credential
projection и lease identity; provider payload или HTTP отсутствуют.
`CLAIMED` является pre-network состоянием. Отдельная
`authorize_rank_connector_execution_submit` повторно блокирует и проверяет
Job/run/item, credential/validation, binding/route, consumed grant, execution
lease generation/version/owner/token, DB deadline и versioned control. Только
после успешной проверки она атомарно фиксирует `SUBMITTING`, единственную
attempt и `submit_bytes_started_at`, возвращая secret-free permit. Транзакция
должна завершиться до отправки bytes; rollback не оставляет marker.

Migrations `20260730101500_rank_connector_execution_claim`,
`20260730101700_rank_connector_submitting_enum` и
`20260730101800_rank_connector_submit_authorization` отзывают `PUBLIC` и все
legacy ACL приватного claim primitive. Deploy-time connector permissions
выдают только exact public claim/authorize signatures без direct table DML.
Fresh полный migration apply, upgrade-ACL и реальные concurrent claim/reclaim/
authorize/replay/rollback/expiry/cancel/credential/control/`pg_temp` проверки
прошли на PostgreSQL 18. Runtime caller и provider HTTP/result persistence ещё
не подключены; live submit остаётся default-closed. Credential-validation
broker уже исключает global vault read, но production role provisioning,
cluster-wide ACL/`pg_hba` evidence остаются release gates.

#### `rank_execution_manifests`

Immutable pre-provider scope принадлежит `seo_db`. Header содержит:

- tenant/project/job/estimate и audit actor;
- project domain/status/version snapshot;
- tracking context/configuration versions и evidence hashes;
- semantic/final estimate scope hashes;
- provider/operation и provider-effective execution JSON;
- retention, pair/chunk counts;
- full `manifest_hash`, semantic `deduplication_hash`, schema versions;
- `sealed_at`, immutable estimate expiry, optional `closed_at`, lifecycle
  status.

`sealed_by` входит в full manifest preimage. Storage-local `request_hash`
сравнивается timing-safe для exact replay/idempotency conflict и не входит в
contract manifest hash.

Lifecycle enum: `BUILDING`, `SEALED`, `CLOSED`. `BUILDING` допустим только
внутри транзакции создания; deferred constraint trigger запрещает его commit.
Единственный разрешённый update после seal — `SEALED → CLOSED` с
`closed_at >= sealed_at`. Header нельзя удалить, переписать, открыть повторно
или вставить сразу как `SEALED/CLOSED`; `TRUNCATE` запрещён.

Partial unique
`workspace_id + project_id + provider + deduplication_hash WHERE status =
SEALED` запрещает второй активный эквивалентный provider run. Semantic hash
содержит только provider-effective content: tenant/project, domain,
execution/retention и упорядоченные
`keyword_id + text_hash + language`. Tracking-context identity, logical
revisions, configuration/semantic/final evidence hashes, assignment/run IDs,
actor и timestamps в него не входят, но run-specific evidence остаётся в
full manifest hash. Поэтому clone/rename эквивалентного context, display-only
label, metadata edit или reassignment не обходят active dedup. `CLOSED`
освобождает active key, не удаляя историю.

#### `rank_execution_manifest_chunks`

- tenant/project/manifest composite FK с `ON DELETE/UPDATE RESTRICT`;
- zero-based `chunk_index`;
- `rank-manifest-chunk@1`, 32-byte chunk hash;
- `entry_count=1..250`;
- unique tenant/project/manifest/chunk identity.

Chunks можно вставлять только пока parent `BUILDING`; update/delete/late
insert и `TRUNCATE` запрещены. При `BUILDING → SEALED` DB проверяет exact
chunk count, contiguous indices и совпадение declared/actual entry counts.

#### `rank_execution_manifest_entries`

- immutable entry ID и global sequence;
- assignment/keyword IDs;
- exact keyword version/text/language snapshot;
- SHA-256 точных raw UTF-8 bytes текста;
- tenant-safe FK к chunk, assignment и keyword с `RESTRICT`;
- unique sequence, assignment и keyword внутри manifest.

Пределы первого Arsenkin slice: 1 000 entries, chunk 250, максимум 500
Unicode code points и 2 000 UTF-8 bytes на keyword, 2 000 000 bytes на весь
scope. До чтения текста выполняется byte-first bounded aggregate preflight;
provider-incompatible scope не materialize-ится. Seal trigger проверяет, что
assignment активен, относится к manifest tracking context и тому же keyword,
а keyword активен и совпадает по version/text/language. Все три таблицы
создаются migration `20260729160000_rank_execution_manifests`.

#### `rank_check_finalization_receipts`

Protected SEO Data finalize атомарно закрывает manifest и сохраняет
immutable receipt:

- tenant/project/manifest/job и audit actor;
- `rank-finalize@1` и 32-byte request hash;
- tracking context/configuration version;
- terminal status и согласованные pair/persisted/found/not-found/missing
  counts;
- DB-derived `finalized_at`.

Exact replay возвращает тот же receipt; repeat identity включает
job/manifest/status, но не audit actor. Первый успешный writer фиксирует
provenance, а другой уполномоченный actor получает исходный receipt; изменение
семантики terminal command отклоняется.
В текущем runtime разрешены zero-persisted
`CANCELLED/FAILED/ACTION_REQUIRED`. `COMPLETED/PARTIALLY_COMPLETED` остаются
fail-closed до normalized ingest, который должен сериализоваться с finalize
на том же manifest lock и запрещать late chunks.

#### `connector_registry`

- provider;
- connector version;
- capabilities;
- status;
- config schema;
- error mapping version.

#### `provider_usage`

Append-only:

- workspace/project/job;
- provider;
- credential mode;
- operation;
- units;
- provider cost;
- customer cost;
- price version;
- occurred_at.

### 6.4. Автоматизации

- `automations`;
- `automation_versions`;
- `schedules`;
- `automation_runs`;
- `automation_failure_counters`.

## 7. `realtime_db`

### 7.1. Comments

- `comment_threads`;
- `comments`;
- `comment_mentions`;
- `comment_revisions`;
- `comment_reactions`.

### 7.2. Notifications

- `notifications`;
- `notification_recipients`;
- `notification_preferences`;
- `notification_rules`;
- `project_notification_subscriptions`;
- `web_push_subscriptions`;
- `deliveries`;
- `delivery_attempts`;

`notifications` хранит `workspace_id`, optional `project_id`, получателя,
allowlist event type, severity, title/body, optional actor/resource reference,
локальный deep link, dedupe key, `read_at` и `created_at`. Индексы
`user_id + created_at DESC + id DESC` и
`user_id + read_at + created_at DESC + id DESC` обслуживают общий и unread
cursor-list. Внешний provider payload и credentials в таблицу не копируются.
Deep link ограничен маршрутом `/app`.

`notification_preferences` хранит пользовательские master-switches, timezone,
quiet hours, digest schedule, bypass critical events, optimistic `version` и
defaults новых проектов. `user_id` уникален; профиль создаётся лениво с
безопасными defaults: in-app включён, email и Web Push выключены.

`notification_rules` хранит нормализованную матрицу
`preference_id + scope_key + event_type + channel`, optional subscription,
user/project scope, minimum severity, delivery mode и enabled state.
`scope_key` равен UUID профильного preference либо UUID membership-bound
project subscription и вместе с event/channel образует unique constraint.
Project rule не может расширить глобально запрещённый канал.

`project_notification_subscriptions` хранит `user_id`, `workspace_id`,
`project_id`, `membership_id`, `membership_version`, mode
`inherit/override/paused`, `paused_until`, `notify_own_jobs`, status и
optimistic `version`. Unique membership snapshot не позволяет случайно
переиспользовать прежний scope; при новом snapshot прежние active-подписки
деактивируются. Удаление/отзыв project access должно дополнительно
деактивировать подписку через событие membership lifecycle.

`web_push_subscriptions` принадлежит `realtime_db` и хранит user-scoped
installation UUID, registration session-family snapshot, device label,
нормализованную недоверенную browser/platform metadata, VAPID public-key
version, optimistic `version`, provider expiry, last success/error и
`active/revoked/expired` state. Endpoint, `p256dh` и `auth` сохраняются одним
AES-256-GCM ciphertext с nonce/auth tag и encryption key version; отдельные
versioned HMAC fingerprints позволяют находить active endpoint и выполнять
reconciliation без расшифровки. Encryption и fingerprint keyrings используют
разный material. Active rows обязаны иметь полный crypto tuple, terminal rows
не должны его иметь: revoke/expiry атомарно стирает ciphertext, nonce/tag и
fingerprints, сохраняя безопасный tombstone. Unique
`user_id + installation_id` не позволяет одному browser installation создать
несколько устройств пользователя. Partial unique index гарантирует
уникальность только одного HMAC digest; одинаковый endpoint под разными
fingerprint key versions имеет разные digests. Поэтому межверсионная
уникальность обеспечивается сервисным поиском fingerprints по всему
настроенному overlap keyring под стабильным advisory lock endpoint. Все
Realtime replicas обязаны пройти rollout `expand одинакового keyring на всех
replicas → drain старых replicas → switch active version`; смешанные keyrings
не считаются безопасным состоянием. Endpoint conflict не приводит к
молчаливой передаче endpoint другому аккаунту. Active count bounded policy,
default 20. Cross-database FK на identity session family запрещён; lifecycle
отзыва применяется через durable identity event до включения sender.
Platform API producer/publisher и Realtime durable pull consumer этого
события реализованы по ADR-2026-036. Consumer ack-ит source только после
commit локальных inbox/tombstone/device изменений; остальные event types не
входят в allowlist identity publisher.

До включения sender `realtime_db` получает
`revoked_session_family_tombstones`:

- `user_id`;
- `session_family_id`;
- source `event_id`;
- `revoked_at`;
- `received_at`.

Unique `(user_id, session_family_id)` делает повтор идемпотентным; cross-DB FK
запрещён. Consumer одной транзакцией пишет inbox + tombstone и terminal-
отзывает совпавшие devices. Registration/upsert под тем же user/device lock
проверяет tombstone до create/update, поэтому event-before-registration не
допускает resurrection. Tombstone retention не короче максимального refresh
TTL плюс предельной задержки outbox/consumer и сохраняется, пока нужен
связанный device tombstone. Таблица, scoped inbox receipt, handler и
fail-closed upsert guard входят в отдельную Realtime migration; fresh apply и
concurrent smoke на PostgreSQL 18 остаются release gate. Producer migration
при этом не меняется.

`deliveries` содержит immutable effective-policy snapshot, deduplication key,
канал, scheduled time и финальный status; `delivery_attempts` — provider
message ID, классифицированную ошибку и следующий retry без тела сообщения и
секретов.

### 7.3. Documents

- `documents`;
- `document_snapshots`;
- `document_update_segments`;
- `document_versions`;
- `document_permissions_projection`.

Yjs binary updates могут храниться в PostgreSQL до compaction и затем в S3.

Presence в PostgreSQL не хранится.

### 7.4. Reports

- `report_definitions`;
- `report_versions`;
- `report_publications`;
- `report_artifacts`;
- `share_links`;
- `share_access_log`.

## 8. Prisma schema example

Пример отражает соглашения, но не заменяет отдельные production schemas:

```prisma
model Workspace {
  id              String   @id @db.Uuid
  name            String   @db.VarChar(160)
  slug            String   @unique @db.VarChar(100)
  country         String?  @db.Char(2)
  locale          String   @default("en") @db.VarChar(16)
  timezone        String   @default("UTC") @db.VarChar(64)
  billingCurrency String   @map("billing_currency") @db.Char(3)
  status          WorkspaceStatus
  ownerUserId     String   @map("owner_user_id") @db.Uuid
  version         Int      @default(1)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz

  members  WorkspaceMember[]
  projects Project[]

  @@map("workspaces")
}

model WorkspaceMember {
  id          String       @id @db.Uuid
  workspaceId String       @map("workspace_id") @db.Uuid
  userId      String       @map("user_id") @db.Uuid
  roleCode    String       @map("role_code") @db.VarChar(64)
  status      MemberStatus
  version     Int          @default(1)
  joinedAt    DateTime?    @map("joined_at") @db.Timestamptz
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId, status])
  @@map("workspace_members")
}

model Keyword {
  id             String    @id @db.Uuid
  workspaceId    String    @map("workspace_id") @db.Uuid
  projectId      String    @map("project_id") @db.Uuid
  textOriginal   String    @map("text_original") @db.Text
  textNormalized String    @map("text_normalized") @db.Text
  language       String?   @db.VarChar(16)
  status         KeywordStatus
  priority       Int       @default(0)
  groupId        String?   @map("group_id") @db.Uuid
  clusterId      String?   @map("cluster_id") @db.Uuid
  targetPageId   String?   @map("target_page_id") @db.Uuid
  /// User-controlled default participation in new rank runs.
  isTracked      Boolean   @default(true) @map("is_tracked")
  version        Int       @default(1)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt      DateTime? @map("deleted_at") @db.Timestamptz

  @@index([projectId, groupId, id])
  @@index([projectId, clusterId, id])
  @@index([projectId, targetPageId])
  @@index([projectId, isTracked])
  @@map("keywords")
}

model Job {
  id               String    @id @db.Uuid
  workspaceId      String    @map("workspace_id") @db.Uuid
  projectId        String?   @map("project_id") @db.Uuid
  type             JobType
  status           JobStatus
  stage            String?   @db.VarChar(64)
  priority         Int       @default(100)
  idempotencyScope String    @map("idempotency_scope") @db.VarChar(180)
  idempotencyKey   String?   @map("idempotency_key") @db.VarChar(180)
  requestHash      Bytes?    @map("request_hash")
  inputSnapshot    Json      @map("input_snapshot")
  current          BigInt    @default(0)
  total            BigInt?
  attempt          Int       @default(0)
  maxAttempts      Int       @default(3) @map("max_attempts")
  leaseOwner       String?   @map("lease_owner") @db.VarChar(100)
  leaseExpiresAt   DateTime? @map("lease_expires_at") @db.Timestamptz
  retryAt          DateTime? @map("retry_at") @db.Timestamptz
  version          Int       @default(1)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz
  startedAt        DateTime? @map("started_at") @db.Timestamptz
  finishedAt       DateTime? @map("finished_at") @db.Timestamptz
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([workspaceId, idempotencyScope, idempotencyKey])
  @@index([workspaceId, projectId, status, createdAt])
  @@index([status, priority, createdAt])
  @@index([type, status, leaseExpiresAt, createdAt])
  @@index([type, status, retryAt, priority, createdAt])
  @@map("jobs")
}
```

## 9. Optimistic update

Обновление выполняется условно:

```ts
const result = await prisma.keyword.updateMany({
  where: { id, projectId, version: expectedVersion },
  data: {
    targetPageId,
    version: { increment: 1 },
    updatedAt: new Date(),
  },
})

if (result.count !== 1) {
  throw new VersionConflictError()
}
```

## 10. Partition management

- Partition creation выполняется maintenance job заранее.
- Default partition допускается только как аварийная защита и мониторится.
- Старые partitions detach/archive/drop по retention.
- Prisma migrations содержат custom SQL.
- Query обязательно включает partition key для истории.
- Partition size и index bloat мониторятся.

## 11. Tenant isolation

- Repository method требует workspace/project context.
- Составные indexes начинаются с project/workspace там, где это полезно.
- Допускается PostgreSQL RLS как defense-in-depth для platform/core tables.
- Service accounts не используют superuser.
- Background job получает ограниченный tenant context.
- Export/delete jobs ведут manifest обработанных сущностей.

## 12. Retention

Настраиваемые классы:

- audit/security;
- financial;
- raw SERP;
- parsed snapshots;
- imports;
- exports;
- attachments;
- deleted projects;
- notifications;
- Yjs updates.

Retention не должен нарушать юридические обязательства и active report snapshots.

Обязательная продуктовая политика:

- проекты не удаляются по billing timeout, нулевому балансу или downgrade;
- parsed/aggregate rank, frequency и analytics history хранится без
  фиксированного срока, пока существует workspace;
- read-only workspace продолжает читать агрегированную историю;
- raw SERP/provider payload/HTML/browser artifacts имеют отдельный
  `expires_at` по plan snapshot и удаляются partition/object lifecycle job;
- удаление пользователем проходит grace period и отдельный deletion manifest;
- financial, payment и NPD receipt records сохраняются по юридической policy,
  даже если пользовательские данные должны быть минимизированы/анонимизированы.

## 13. Backup и восстановление

- ежедневный full backup;
- WAL/PITR с целевым RPO не более 15 минут;
- offsite encrypted copy;
- регулярный restore test;
- object storage versioning/replication;
- документированный порядок восстановления согласованности event projections.

## 14. Граница Prisma и PostgreSQL-specific SQL

Prisma Client является единственным стандартным data-access API production
TypeScript-кода. CRUD, relations, обычные aggregates, pagination и optimistic
updates реализуются Prisma model operations. Параллельный handwritten
repository/query слой для тех же операций не создаётся.

Parameterized `$queryRaw`/`$executeRaw` допускаются только там, где Prisma
Client не выражает требуемую семантику либо ухудшает correctness/query plan:

- advisory/row locks, `FOR UPDATE`, `FOR SHARE`, `SKIP LOCKED`;
- один атомарный `ON CONFLICT`, CTE/window query или bounded bulk upsert;
- database clock и встроенный PostgreSQL UUIDv7;
- broker-функции с `SECURITY DEFINER` и exact permission boundary;
- extension, trigger, partial/expression index, partition и data migration.

`$queryRawUnsafe`, `$executeRawUnsafe` и `Prisma.raw` запрещены policy-тестом.
Значения всегда передаются параметрами; identifiers не собираются из
request/provider input. Сложный статический read может быть перенесён в Prisma
TypedSQL только после проверки generated types, `EXPLAIN`, regression tests и
воспроизводимой container-сборки без доступа к уже мигрированной runtime БД.
До выполнения последнего условия TypedSQL не является production build gate.

Custom migration SQL остаётся частью Prisma Migrate: ORM не заменяет DDL,
permissions, triggers и PostgreSQL-specific invariants. Любая попытка удалить
такой SQL должна доказать эквивалентность блокировок, affected-row semantics,
идемпотентности, plan и rollback, а не только совпадение happy-path результата.

## 15. Сезонные точки и пользовательское исключение rank-history

`frequency_seasonality_points` принадлежит Core SEO и является append-only.
Уникальность `(workspace, project, job, keyword, type, granularity,
period_start, region, device)` делает повтор persistence безопасным и позволяет
одному job хранить отдельные `BASE|EXACT|FIXED` серии для обратной совместимости;
текущий XMLStock history workflow создаёт только `BASE`. Значение хранится как
`bigint`, доля — `decimal(24,18)`; provider/source mode ограничены CHECK.

`rank_dimension_history_deletions` также append-only и хранит полную identity
dimension, `excluded_through`, actor, idempotency key, SHA-256 request hash и
число затронутых snapshots. Это tombstone продуктовой видимости, а не удаление
финансового либо provider evidence. Обе таблицы включены в
`transfer_seo_project_workspace`, guarded update разрешает только штатный
workspace re-key, DELETE запрещён trigger.

`rank_dimension_merges` принадлежит Core SEO и хранит обратимую
presentation-настройку source/target dimension keys, их сохранённые подписи,
actor, idempotency hash и optimistic version. Уникальность
`(workspace_id, project_id, source_dimension_key)` запрещает два назначения
одного source; индекс target поддерживает объединённые чтения. В отличие от
rank evidence эту строку разрешено удалить для отмены объединения: сами
snapshots при этом не изменяются. Таблица включена в
`transfer_seo_project_workspace`.
