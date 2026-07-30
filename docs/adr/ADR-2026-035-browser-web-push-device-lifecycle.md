# ADR-2026-035: lifecycle browser Web Push devices

Дата: 29 июля 2026 года  
Статус: принято  
Затронутые репозитории: `platform-contracts`, `platform-api`,
`platform-realtime`, `platform-web`, `platform-infrastructure`

## Контекст

Профильные и membership-bound проектные правила уведомлений уже принадлежат
`realtime_db`, но browser subscription содержит bearer endpoint и
криптографические browser keys. Эти данные нельзя принимать как доверенный
tenant context, хранить открыто, логировать или передавать через общий
межсервисный credential.

Фактическая отправка Web Push ещё не включена: нет durable consumer,
идемпотентных delivery attempts, sender process и одобренной production-
зависимости `web-push`. Наличие browser subscription поэтому не должно
создавать ложное состояние «доставка работает».

## Решение

### Владение и публичная граница

- `platform-realtime` владеет таблицей `web_push_subscriptions`, encryption и
  lifecycle устройства.
- Browser обращается только к Platform API:
  - `GET /api/v1/me/push-subscriptions`;
  - `PUT /api/v1/me/push-subscriptions/{installationId}`;
  - `PATCH /api/v1/me/push-subscriptions/{installationId}`;
  - `DELETE /api/v1/me/push-subscriptions/{installationId}`.
- `installationId` — случайный UUID конкретной установки приложения,
  создаваемый Web один раз и сохраняемый в IndexedDB. Он не заменяет user ID,
  session ID или browser credential.
- Platform API извлекает `userId` и `sessionFamilyId` только из проверенной
  session, нормализует недоверенную user-agent metadata и передаёт их во
  внутреннюю границу. Публичное body не может задавать actor/session/status.
- Внутренний lifecycle принимает только отдельный
  `PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN`, отличный от общего
  `PLATFORM_API_TO_REALTIME_TOKEN`; legacy `INTERNAL_API_TOKEN` удалён и
  отклоняется при startup. Секрет выдают только Platform API и Realtime.

### Validation и хранение

- Регистрация требует recent authentication, CSRF и secure browser context;
  rename/revoke требуют CSRF, а rename — optimistic `If-Match`.
- Endpoint принимается только по HTTPS и только при точном совпадении origin
  с `WEB_PUSH_ENDPOINT_ORIGINS`; credentials, fragment, IP literal и custom
  port запрещены.
- `p256dh` и `auth` принимаются только в canonical unpadded base64url.
  `p256dh` обязан быть валидной uncompressed P-256 point, `auth` — ровно
  16 bytes.
- Label нормализуется в NFC, ограничен 80 символами и не содержит control
  characters.
- Endpoint, `p256dh` и `auth` шифруются единым versioned payload через
  AES-256-GCM. AAD связывает ciphertext с subscription, user,
  installation, session family, VAPID version и encryption key version.
- Поиск дубликата использует отдельный versioned HMAC-SHA-256 keyring.
  Encryption и fingerprint key material никогда не совпадают. Partial unique
  index защищает только конкретный HMAC digest, поэтому межверсионная
  уникальность дополнительно требует all-keyring lookup под стабильным
  endpoint advisory lock.
- Startup coverage guard проверяет, что все используемые active rows имеют
  доступные encryption/fingerprint versions. Отображение
  `keyVersion → key bytes` immutable. Fingerprint-ротация выполняется строго
  `expand одинакового overlap keyring на всех replicas → drain старых
  replicas → switch active version`; mixed-keyring rollout небезопасен.
- Один endpoint не может молча перейти к другому аккаунту. Endpoint conflict
  возвращается как нейтральная ошибка; пользователь должен отозвать browser
  subscription и создать новую.
- Active devices bounded значением `WEB_PUSH_MAX_ACTIVE_DEVICES`, default 20.
- При revoke/expiry секретный ciphertext, nonce/tag и fingerprints
  уничтожаются атомарно; сохраняется только безопасный tombstone lifecycle.

### Browser lifecycle

- VAPID public key и immutable version возвращаются сервером; VAPID private
  key не поступает в Platform API, Realtime HTTP или Web.
- Service Worker публикуется same-origin, регистрируется со scope `/app/` и
  `updateViaCache: none`. Он не содержит `fetch` handler и не кэширует private
  API.
- Push payload допускает только bounded safe preview, dedupe tag и
  same-origin deep link внутри `/app`. Ошибка validation приводит к
  нейтральному preview и `/app/notifications`.
- `pushsubscriptionchange` не пытается отправить secrets без session: он
  атомарно повышает `reconcileGeneration` в IndexedDB schema v2, который
  foreground UI согласует с сервером. Успешный PUT завершает marker только
  generation-CAS и только если отправленная subscription всё ещё точно
  совпадает с текущей browser subscription. Более новое событие другой
  вкладки/Service Worker не очищается; delayed PUT со stale material повторно
  повышает generation.
- Запись неизвестной будущей версии, повреждённая запись или owner conflict
  обрабатываются fail-closed. Recovery требует явного подтверждения,
  успешного browser unsubscribe и нового installation UUID; молчаливый
  overwrite или перенос installation между аккаунтами запрещён.
- Permission запрашивается только после явного действия пользователя.
- Project notification rules выбирают события и каналы; browser device
  принадлежит профилю, а не проекту.

### Честная доступность

HTTP lifecycle может быть включён через
`WEB_PUSH_REGISTRATION_ENABLED=true`, но API продолжает возвращать
`deliveryAvailable=false` и `testDeliveryAvailable=false` до появления
реального sender. UI не показывает успешную test/delivery.

Текущий startup coverage guard проверяет наличие номеров key versions, но не
неизменность bytes. Подмена AES/HMAC material под прежней version может
сломать расшифровку и межверсионный поиск endpoint. Same-version replacement
операционно запрещён; до `WEB_PUSH_REGISTRATION_ENABLED=true` в production
нужен persistent authenticated canary/manifest для каждой encryption и
fingerprint version. Staging lifecycle допускается только с immutable
keyring и контролируемым rollout.

Перед production-доставкой обязательны:

1. durable identity event об отзыве session family и consumer, атомарно
   переводящий связанные active devices в terminal state — реализованы по
   ADR-2026-036;
2. transactional outbox, JetStream durable consumer, delivery snapshot,
   retry/DLQ и идемпотентные attempts;
3. отдельный sender role с VAPID private key и повторной проверкой active
   generation непосредственно перед decrypt/send;
4. обработка `404/410` push service как terminal expiry;
5. bounded global sweeper для provider expiry; текущий lifecycle очищает due
   rows только в user-scoped list/upsert;
6. persistent key verifier/decrypt-canary, описанный выше;
7. явное одобрение production-зависимости `web-push`; `@nats-io/jetstream`
   уже используется только для identity safety transport и не включает sender.

## Последствия

- Dependency-free lifecycle можно развернуть и проверить без имитации
  внешней доставки.
- Компрометация general `PLATFORM_API_TO_REALTIME_TOKEN` не открывает
  управление push devices.
- Потеря encryption key делает active subscription невосстановимой; удалять
  используемую key version до coverage=0 запрещено.
- До реализации session-family revoke event и sender внешняя доставка остаётся
  release-blocked, даже если browser registration включена.

## Миграция и обратная совместимость

Добавляется новая таблица в `realtime_db`; cross-database FK нет. Миграция
рассчитана на pre-release окружение и не меняет существующие preference или
notification center rows. При disabled registration прежние экраны и in-app
уведомления продолжают работать, а lifecycle API честно сообщает
`SERVER_NOT_CONFIGURED`.
