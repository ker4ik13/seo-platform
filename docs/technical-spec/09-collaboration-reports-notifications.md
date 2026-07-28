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

## 12. Предпочтения уведомлений

Настраиваются по:

- типу;
- workspace/project;
- каналу;
- severity;
- instant/digest;
- quiet hours;
- timezone.

Security и billing-critical уведомления нельзя полностью отключить владельцу.

## 13. Каналы

### In-app

Обязателен для всех событий, кроме явно transient.

### Email

- локализованные шаблоны;
- instant/digest;
- delivery tracking;
- bounce handling.

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

