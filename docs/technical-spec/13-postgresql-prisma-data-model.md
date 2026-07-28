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
- `realtime_db`;
- `directus_db`.

На старте базы могут находиться в одном PostgreSQL cluster, но используют отдельных пользователей и databases. Сервису запрещены credentials чужой базы.

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
- revoked_at;
- invited_by;
- created_at.

`project_accesses` в приглашении хранит только проверенный снимок
`[{ projectId, level }]`; после принятия он нормализуется в
`project_member_access`. Открытый invitation token в БД, outbox, очереди и
логах не хранится.

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
- status;
- tags;
- template_id;
- manager_user_id;
- created_at;
- updated_at;
- archived_at;
- deletion_scheduled_at;
- version.

Indexes:

- `(workspace_id, status, updated_at desc)`;
- `(workspace_id, domain_normalized)`;
- `(workspace_id, slug)` unique.

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
- is_tracked;
- group_id;
- cluster_id;
- target_page_id;
- intent;
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
`pg_trgm`. Точный `count` выполняется только для первой страницы; cursor-page
не повторяет его. Каждый query одновременно фильтруется по `workspace_id`,
`project_id` и активному status.

При необходимости строгий dedup заменяется отдельной `keyword_unique_keys`, чтобы поддержать variants.

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

- id;
- workspace_id;
- project_id;
- name;
- search_engine;
- country;
- region_provider_id;
- region_label;
- language;
- device;
- depth;
- domain_rule;
- active;
- config_version;
- created_at;
- updated_at.

#### `keyword_tracking_contexts`

- keyword_id;
- context_id;
- active;
- added_at;
- removed_at.

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
- idempotency;
- provider request ID;
- schedule.

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
- owner;
- secret_ciphertext или vault reference;
- encrypted_data_key;
- scopes;
- capabilities;
- status;
- expires_at;
- last_test_at;
- last_success_at;
- last_error_code;
- version.

Секретные поля никогда не возвращаются Prisma DTO наружу.

#### `project_connector_bindings`

- project ID;
- capability;
- primary credential;
- fallback policy;
- budgets;
- config;
- version.

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

`web_push_subscriptions` хранит endpoint и browser keys зашифрованно,
device label, user agent metadata, last success/error и revoked/expired state.

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

## 8. Directus DB

Управляется Directus migrations/snapshots. Приложение сайта не пишет напрямую в БД и использует Directus API/SDK.

## 9. Prisma schema example

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
  isTracked      Boolean   @default(false) @map("is_tracked")
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
  id             String    @id @db.Uuid
  workspaceId    String    @map("workspace_id") @db.Uuid
  projectId      String?   @map("project_id") @db.Uuid
  type           JobType
  status         JobStatus
  stage          String?   @db.VarChar(64)
  priority       Int       @default(100)
  idempotencyKey String?   @map("idempotency_key") @db.VarChar(128)
  inputSnapshot  Json      @map("input_snapshot")
  current        BigInt    @default(0)
  total          BigInt?
  attempt        Int       @default(0)
  maxAttempts    Int       @default(3) @map("max_attempts")
  version        Int       @default(1)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz
  startedAt      DateTime? @map("started_at") @db.Timestamptz
  finishedAt     DateTime? @map("finished_at") @db.Timestamptz

  @@unique([workspaceId, idempotencyKey])
  @@index([workspaceId, projectId, status, createdAt])
  @@index([status, priority, createdAt])
  @@map("jobs")
}
```

## 10. Optimistic update

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

## 11. Partition management

- Partition creation выполняется maintenance job заранее.
- Default partition допускается только как аварийная защита и мониторится.
- Старые partitions detach/archive/drop по retention.
- Prisma migrations содержат custom SQL.
- Query обязательно включает partition key для истории.
- Partition size и index bloat мониторятся.

## 12. Tenant isolation

- Repository method требует workspace/project context.
- Составные indexes начинаются с project/workspace там, где это полезно.
- Допускается PostgreSQL RLS как defense-in-depth для platform/core tables.
- Service accounts не используют superuser.
- Background job получает ограниченный tenant context.
- Export/delete jobs ведут manifest обработанных сущностей.

## 13. Retention

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

## 14. Backup и восстановление

- ежедневный full backup;
- WAL/PITR с целевым RPO не более 15 минут;
- offsite encrypted copy;
- регулярный restore test;
- object storage versioning/replication;
- отдельный backup Directus;
- документированный порядок восстановления согласованности event projections.
