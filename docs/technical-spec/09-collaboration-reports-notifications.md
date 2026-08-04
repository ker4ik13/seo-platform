# Совместная работа, отчёты и уведомления

## 1. Real-time сценарии

- presence в проекте;
- список участников на экране;
- курсоры и выделения ячеек;
- изменения строк;
- комментарии и упоминания;
- совместный редактор документов;
- progress jobs;
- уведомления;
- изменение ролей и отозванный доступ;
- обновление dashboard.

## 2. Источник истины

- PostgreSQL является источником истины для бизнес-данных.
- WebSocket не является хранилищем.
- Presence и курсоры являются эфемерными и хранятся в Redis с TTL.
- Документы используют Yjs updates и периодические snapshots.
- События бизнес-изменений публикуются только после commit через outbox.

## 3. WebSocket connection

- Socket.IO transport: websocket.
- Аутентификация выполняется при handshake.
- Сервер проверяет session и workspace membership.
- При изменении роли rooms пересчитываются.
- Connection имеет heartbeat.
- Reconnect выполняет resubscribe и version sync.
- Ограничивается число соединений на пользователя/план.
- Payload валидируется так же, как HTTP.

## 4. Rooms

Примеры:

- `user:{userId}`;
- `workspace:{workspaceId}`;
- `project:{projectId}`;
- `view:{viewId}`;
- `document:{documentId}`;
- `job:{jobId}`;
- `report:{reportId}`.

Клиент не может самостоятельно подписаться на room без серверной авторизации.

## 5. Presence

Presence state:

- user ID;
- display name;
- avatar;
- color;
- project;
- screen/view;
- status;
- last activity;
- optional current entity.

Правила:

- пользователь считается offline после TTL;
- background tab снижает частоту обновлений;
- sensitive entity details не отправляются пользователям без прав;
- пользователь может скрыть детальный activity status, но не присутствие в общем документе при совместном редактировании.

## 6. Курсоры и выделения в таблице

Передаётся:

- table/view ID;
- row ID;
- column ID;
- selection range;
- editing flag;
- ephemeral sequence.

Требования:

- отправка throttled;
- presence не записывается в audit;
- выделение исчезает при уходе/TTL;
- цвет стабилен в рамках сессии;
- одновременно показывается ограниченное число подписей, остальные объединяются;
- курсор не раскрывает скрытые колонки;
- пользователь видит предупреждение, если коллега редактирует ту же ячейку.

## 7. Конфликты строк

Модель optimistic concurrency:

1. Клиент читает `version`.
2. Отправляет patch и expected version.
3. API выполняет conditional update.
4. При успехе увеличивает version.
5. При конфликте возвращает current entity и changed fields.

UI предлагает:

- принять серверную версию;
- повторно применить свои изменения;
- ручное объединение;
- сохранить как комментарий/черновик.

Last-write-wins без уведомления запрещён для пользовательских полей.

## 8. Комментарии

Комментарий может быть привязан к:

- project;
- keyword;
- cluster;
- group;
- page;
- issue;
- task;
- job;
- report;
- document range.

Функции:

- thread;
- replies;
- mentions;
- attachments;
- edit history;
- resolve/reopen;
- reactions;
- private/internal или client-visible;
- deep link.

Удалённый комментарий сохраняет tombstone и audit согласно policy.

## 9. Упоминания

- autocomplete учитывает доступ к проекту;
- упоминание создаёт notification;
- email/Telegram зависит от предпочтений;
- упомянутый пользователь не получает доступ к ресурсу автоматически;
- при отсутствии доступа автор получает предупреждение.

## 10. Совместные документы

Стек:

- Tiptap;
- Yjs;
- Hocuspocus;
- WebSocket;
- Redis для масштабирования/presence;
- PostgreSQL/object storage для snapshots.

### 10.1. Документ

- Yjs document name включает тип и opaque ID;
- `onAuthenticate` проверяет доступ;
- update log периодически compacted;
- snapshots создаются по времени и значимым событиям;
- JSON/HTML projection создаётся для поиска и экспорта;
- awareness не сохраняется.

### 10.2. Offline

- допускается IndexedDB persistence;
- при reconnect Yjs объединяет изменения;
- удаление документа блокирует новые изменения и показывает read-only recovery;
- пользователь может экспортировать локальные несинхронизированные изменения.

### 10.3. Версии

- автоматические snapshots;
- именованные версии;
- restore as new version;
- comparison;
- author attribution where possible;
- comments anchored with fallback context.

## 11. Notification center

Категории:

- assignments;
- mentions;
- job completed/failed;
- schedule failed;
- position alerts;
- integration;
- balance/billing;
- report;
- security;
- product/system.

Свойства:

- title;
- body;
- severity;
- actor;
- resource;
- deep link;
- createdAt;
- readAt;
- delivery channels;
- deduplication key.

Первый read-срез центра:

- маршрут `/app/notifications`;
- фильтры `все` и `непрочитанные`;
- глобальный unread count в колокольчике;
- cursor pagination по `createdAt DESC, id DESC`;
- идемпотентные действия `прочитать одно` и `прочитать всё`;
- переход только по валидированному внутреннему deep link `/app`;
- loading, empty, filtered-empty, error/degraded, loading-more и mutation
  pending states.

Центр не получает raw provider payload и произвольный notification `data`.
Публичная модель содержит только allowlist полей: категория, severity, title,
body, безопасные resource references, deep link и timestamps. Уведомление
может оставаться доступным после потери project access, но deep link обязан
повторно пройти текущую авторизацию целевого ресурса.

## 12. Предпочтения уведомлений

Двухуровневая модель:

1. В профиле пользователь задаёт глобальные каналы, timezone, quiet hours,
   instant/digest и значения по умолчанию для новых проектов.
2. В подписке на конкретный проект пользователь включает нужные типы работ и
   может сузить либо переопределить профильные значения.

Проектная настройка не может включить канал, который глобально запрещён или
не подтверждён. Удаление пользователя из проекта немедленно отключает его
проектную подписку.

Настраиваются по:

- типу;
- workspace/project;
- каналу;
- severity;
- instant/digest;
- quiet hours;
- timezone.

Типы проектных работ включают:

- импорт и публикацию семантики;
- сбор частотности, позиций и SERP;
- кластеризацию;
- crawl/Radar и изменения страниц;
- sitemap generation/submission;
- Magnet discovery/publish;
- выполнение или ошибку автоматизации;
- интеграционные ошибки и исчерпание provider limit;
- завершение, частичный результат, отмену и ошибку job.

Security и billing-critical уведомления нельзя полностью отключить владельцу.

### 12.1. Экран профиля

Маршрут `/app/settings/notifications` содержит:

- master-переключатели `in-app`, `email`, `browser push`;
- подтверждённый email и ссылку на его подтверждение;
- timezone, quiet hours и поведение critical-событий в тихие часы;
- режим `instant`, почасовой/дневной digest и время дайджеста;
- матрицу категорий и каналов;
- значения по умолчанию для новых проектов;
- список browser-устройств с названием, браузером, последней доставкой и
  отзывом подписки;
- тестовую отправку отдельно по email и в выбранное browser-устройство.

Обязательные состояния компонентов:

- loading/saving/saved/save failed;
- email unverified/provider disabled;
- Web Push unsupported;
- browser permission `default`, `granted`, `denied`;
- subscription creating/active/expired/revoked;
- server registration disabled, device limit reached и reconciliation required;
- test pending/delivered/failed;
- test unavailable до включения реального sender;
- digest empty;
- conflicting quiet-hours timezone после смены timezone.

Permission Web Push запрашивается только по нажатию пользователя. При
`denied` UI не пытается повторно вызвать browser prompt и показывает
инструкцию для настроек конкретного браузера.

### 12.2. Настройки проекта

Маршрут `/app/projects/{projectId}/settings/notifications` показывает только
проекты, к которым у пользователя есть доступ. Экран содержит:

- общий режим `наследовать профиль`, `переопределить`, `пауза до даты`;
- матрицу типов работ, severity и каналов;
- выбор instant/digest для каждого типа;
- предупреждение о глобально запрещённом или неподтверждённом канале;
- `notify on completion` для jobs, созданных текущим пользователем;
- уведомления обо всех jobs проекта только при соответствующем permission;
- preview итоговой effective-настройки;
- сброс к профильным значениям.

Настройка принадлежит конкретному пользователю и не меняет предпочтения
остальных участников. После потери project access она становится неактивной;
повторное добавление пользователя не включает старую подписку автоматически.
Подписка хранит снимок `membershipId + membershipVersion`. Смена версии или
создание нового membership создаёт новый scope, а прежний scope переводится в
`inactive`. Простого совпадения `userId + projectId` недостаточно.

### 12.3. Разрешение правил

Для каждого получателя effective policy вычисляется в порядке:

1. обязательное системное правило security/billing-critical;
2. подтверждённость и глобальный master-switch канала;
3. глобальное правило категории;
4. project override или pause;
5. minimum severity;
6. quiet hours и digest schedule;
7. deduplication/cooldown.

Результат вычисления сохраняется в delivery snapshot, чтобы последующая смена
настроек не меняла объяснение уже созданной доставки. Проверка membership и
доступа повторяется перед формированием deep link и непосредственно перед
отправкой.

### 12.4. Вертикальный срез настроек

Первый рабочий срез обязан включать:

- хранение профильных master-switches, timezone, quiet hours, digest time и
  нормализованной матрицы правил;
- режимы проекта `inherit`, `override`, `paused`, срок паузы и
  `notifyOwnJobs`;
- серверное вычисление effective policy: UI preview не является источником
  истины;
- optimistic locking через `version`/`If-Match`;
- явный пользовательский запрос browser permission без автоматического prompt;
- loading, saving, saved, validation, conflict, error и blocked-channel states.

Текущий repository slice реализует хранение и API профильных/проектных
настроек, effective policy, in-app dropdown и полный центр, lifecycle devices по ADR-2026-035 и
durable browser Web Push delivery по ADR-2026-039. Notification и exact
per-device attempt создаются атомарно; sender имеет lease/retry, fresh
membership authorization, `404/410` expiry, global provider-expiry sweeper и
persistent key canaries. По умолчанию profile выключен, поэтому API честно
возвращает `deliveryAvailable=false`; оператор включает его только вместе с
проверенным VAPID/keyring/profile rollout. `testDeliveryAvailable=false` до
отдельной rate-limited test command.

Terminal Jobs восстанавливаются bounded PostgreSQL reconciler-ом из
authoritative Jobs DB. Для каждого terminal status создаётся не более одного
outbox intent; перед созданием notification Platform API повторно проверяет
actor membership, workspace/project lifecycle и `project.view`. Realtime
применяет profile/project policy и `notifyOwnJobs`, а Web показывает событие
в dropdown/центре, corner toast и best-effort звуковой сигнал. Payload не
содержит query text, URL, provider response или credential material.

Следующий вертикальный срез общего notification-контура:
`остальные redacted domain events → effective policy → idempotent Email/Web
Push attempts`, а также email/digest scheduler и delivery-history UI.

Identity safety leg уже замкнут по ADR-2026-036. Platform API пишет
`identity.session-family.revoked.v1` в той же транзакции с revoke, bounded
publisher подтверждает exact JetStream PubAck, а Realtime durable pull
consumer commit-ит scoped inbox, revoked-family tombstone и terminal device
revoke до source ack. Временные ошибки используют bounded delayed NAK;
permanent invalid либо exhausted messages переходят в redacted DLQ только
после подтверждённого DLQ PubAck. Этот pipeline не создаёт delivery attempts
и не означает, что email/Web Push sender уже включён.

## 13. Каналы

### In-app

Обязателен для всех событий, кроме явно transient.

### Email

- локализованные шаблоны;
- instant/digest;
- delivery tracking;
- bounce handling.
- unsubscribe управляет отключаемыми категориями, но не security-critical;
- provider message ID сохраняется без содержимого письма;
- temporary failure повторяется с exponential backoff и jitter;
- hard bounce отключает email-канал, создаёт in-app предупреждение и не
  блокирует остальные каналы.

### Browser / Web Push

- используется стандарт Web Push через Service Worker;
- permission запрашивается только после явного действия пользователя;
- browser subscription принадлежит пользователю и конкретному устройству;
- device является частью профиля; project rule выбирает события и канал, но
  не владеет browser subscription;
- endpoint и keys шифруются/защищаются как credentials;
- подписку можно назвать, протестировать и отозвать из профиля;
- expired/`410 Gone` subscription отключается автоматически;
- push содержит только безопасный preview и deep link, без API-ключей,
  финансовых деталей и закрытого содержимого;
- клик повторно проверяет session и доступ к проекту.

Service Worker должен:

- показывать локализованный заголовок и безопасный preview;
- объединять повторные события по `tag`/deduplication key;
- фокусировать существующую вкладку либо открывать same-origin deep link;
- не кэшировать private API response;
- поддерживать новую версию приложения без потери действующей subscription.

Device lifecycle следует ADR-2026-035:

- Web создаёт случайный installation UUID и сохраняет его в IndexedDB;
- Service Worker регистрируется со scope `/app/`, не содержит `fetch` handler
  и не создаёт private cache;
- endpoint проходит точный allowlist HTTPS origins; redirects и эвристическое
  совпадение hostname запрещены;
- endpoint/browser keys хранятся единым AES-256-GCM ciphertext с versioned
  AAD, а deduplication использует отдельный versioned HMAC-SHA-256 keyring;
- active device count bounded server-side, default — 20;
- terminal revoke/expiry атомарно стирает ciphertext, nonce/tag и
  fingerprints, сохраняя безопасный tombstone;
- VAPID private key отсутствует в HTTP/API/Web process и доступен только
  isolated sender role;
- смена browser subscription атомарно повышает локальную
  `reconcileGeneration` в IndexedDB schema v2; Service Worker не передаёт
  credentials без активной session;
- foreground завершает marker только generation-CAS и после exact-сравнения
  отправленной и текущей browser subscription. Новая генерация другой
  вкладки/Service Worker не очищается, а delayed PUT со stale material
  повторно взводит reconciliation;
- corrupt/future local record и owner conflict обрабатываются fail-closed;
  recovery требует явного подтверждения, успешного browser unsubscribe и
  нового installation UUID без молчаливого переноса между аккаунтами.
- Realtime handler `identity.session-family.revoked.v1` идемпотентно и в
  одной локальной транзакции записывает scoped inbox receipt и revoked-family
  tombstone, а также terminal-отзывает все active devices с совпавшими
  `userId + registration session family`. Durable pull consumer вызывает
  handler только для exact subject и ack-ит source после committed handler;
  runtime fail-closed проверяет exact source/DLQ streams и consumer topology.
- Device registration/upsert под тем же user/device lock проверяет durable
  tombstone до записи. Это закрывает reorder, когда event обработан раньше
  уже начатого запроса регистрации старой family; такой запрос fail-closed не
  может воскресить device.
- Notification fanout сохраняет bounded policy/payload snapshot и exact
  device version в `web_push_delivery_attempts`. Sender непосредственно перед
  decrypt повторно проверяет device generation и authoritative Platform
  membership/project permission. `404/410` и provider expiry terminal-очищают
  только соответствующее устройство; временные ошибки получают bounded retry.
- Каждый encryption/HMAC key version защищён persistent canary. Realtime HTTP
  создаёт canary при первом expand, последующие HTTP/sender startups проверяют
  bytes; sender не имеет права создавать или менять canaries.

### Telegram

- привязка аккаунта/чата;
- test message;
- выбор проектов;
- commands/interactive buttons только с повторной проверкой доступа;
- ссылка ведёт в приложение;
- Telegram message не содержит секретов.

### Webhook

- подписка на типы;
- signing secret;
- delivery log;
- retries;
- disable after repeated failures with notification.

## 14. Правила уведомлений о позициях

Условия:

- падение/рост на N;
- вход/выход TOP;
- high-frequency only;
- priority keywords;
- URL changed;
- cannibalization;
- group visibility threshold;
- competitor overtook.

Антиспам:

- grouping window;
- cooldown;
- digest;
- minimum affected count;
- no duplicate for same snapshot.

## 15. Отчёты

### 15.1. Типы

- interactive dashboard;
- PDF;
- XLSX;
- CSV;
- share link;
- scheduled email/Telegram;
- API report.

### 15.2. Templates

- SEO summary;
- rankings;
- semantics;
- technical issues;
- content progress;
- agency client;
- executive;
- custom.

### 15.3. Report builder

Шаги:

1. template;
2. projects/scope;
3. period/comparison;
4. sections;
5. filters/contexts;
6. branding;
7. visibility;
8. recipients;
9. schedule;
10. preview/publish.

## 16. Report snapshot

Опубликованный отчёт должен быть воспроизводим.

Сохраняются:

- report config version;
- data cutoff;
- query/filter snapshot;
- formula versions;
- generated artifacts;
- missing data warnings;
- publisher;
- publication time.

Динамическая share link может обновляться, но явно помечается как live.

## 17. White label

Без custom domain поддерживаются:

- logo;
- agency name;
- colors within accessible palette;
- contact details;
- footer;
- hide platform branding по тарифу;
- localized report labels.

Нельзя менять системные security и legal notices.

## 18. Клиентский отчёт

- краткое summary;
- цели;
- KPI;
- позиции;
- трафик/conversions;
- выполненные работы;
- проблемы;
- план;
- комментарии;
- methodology.

Скрываются:

- provider credentials;
- внутренние costs;
- private tasks/comments;
- служебные errors;
- непроверенные AI recommendations.

## 19. Генерация PDF

- выполняется worker;
- использует print-specific layout;
- фиксирует locale/timezone;
- проверяет missing fonts;
- графики рендерятся детерминированно;
- артефакт имеет checksum;
- large reports разбиваются разумно;
- failure содержит section;
- PDF проходит visual regression tests на шаблонах.

## 20. Публичные ссылки

- opaque token;
- expiration;
- password optional;
- email allowlist optional;
- view/download permissions;
- watermark optional;
- revoke;
- access log;
- brute-force rate limit;
- robots `noindex`;
- no navigation into app.

## 21. Состояния

- connected;
- reconnecting;
- offline;
- resyncing;
- conflict;
- remote edit;
- access revoked;
- document compacting;
- report generating;
- report partial;
- report failed;
- delivery pending;
- delivered;
- bounced;
- webhook retrying;
- public link expired.

## 22. Критерии приёмки уведомлений

- Пользователь может глобально отключить email и Web Push, а project override
  не обходит этот запрет.
- Пользователь может включить разные типы работ для разных проектов.
- Завершение и ошибка job создают не более одного уведомления на получателя
  при повторной доставке одного domain event.
- Quiet hours откладывают обычную instant-доставку, но не теряют событие.
- Digest не содержит ресурс, к которому пользователь потерял доступ.
- Web Push permission не запрашивается без явного клика.
- Browser device принадлежит профилю, имеет client installation UUID и не
  привязывается напрямую к проекту.
- Endpoint принимается только из exact HTTPS origin allowlist; публичные
  ответы не содержат endpoint, browser keys, fingerprints или session family.
- Revoke/expiry стирает secret material; active devices ограничены server-side.
- До включения sender UI и API явно показывают, что delivery/test недоступны.
- `410 Gone` отключает только конкретную browser subscription.
- Hard bounce не отключает in-app и browser channels.
- Удаление участника немедленно прекращает проектные доставки.
- Test email/push имеет отдельный rate limit и не создаёт production alert.
- Notification payload, delivery log и telemetry не содержат provider keys,
  signed URLs, cookies, платёжные реквизиты или закрытый текст ресурса.
