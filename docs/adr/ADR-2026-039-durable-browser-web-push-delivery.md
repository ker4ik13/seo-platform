# ADR-2026-039: durable browser Web Push delivery

- Статус: принято
- Дата: 31 июля 2026 года
- Затронутые области: `platform-contracts`, `platform-api`,
  `platform-realtime`, `platform-web`, `platform-infrastructure`
- Изменение API/БД: fresh-authorization internal API, per-device delivery
  attempts, persistent key canaries и отдельная sender DB role

## Контекст

ADR-2026-035 определил безопасный lifecycle browser subscription, но оставил
внешнюю доставку заблокированной до появления durable attempt, отдельного
sender, повторной проверки доступа и обработки provider expiry. Source
notification уже поступает в Realtime через durable source outbox/dispatcher
и идемпотентный destination command. Добавление второго broker hop после
локального commit не повышает сохранность, но создаёт две конкурирующие
истины о состоянии доставки.

## Решение

- Realtime одной транзакцией сохраняет notification и отдельный immutable
  `web_push_delivery_attempts` для каждой exact active device generation.
  Unique `notificationId + subscriptionId` делает at-least-once fanout
  идемпотентным. Policy/payload snapshots bounded и не содержат endpoint,
  browser keys, cookies либо provider credentials.
- После приёма source command локальная Realtime DB queue является
  каноническим durable transport доставки. Это уточняет пункт 2 ADR-2026-035:
  source domain events по-прежнему требуют transactional outbox и durable
  dispatcher/JetStream, но второй JetStream hop между Realtime notification и
  Realtime-owned sender не создаётся.
- Отдельный `WEB_PUSH_WORKER` получает только outbound network, VAPID private
  key, subscription keyrings, отдельный `realtime_web_push` login и narrow
  `REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN`. HTTP/API/Web/NATS/Redis/general
  credentials ему запрещены.
- Worker claim-ит due row через `FOR UPDATE SKIP LOCKED`, lease и bounded
  attempt budget. Retry использует exponential backoff, jitter и bounded
  `Retry-After`; terminal outcomes сохраняются. `404/410` атомарно истекают
  только exact device generation, стирают ciphertext/fingerprints и отменяют
  её остальные attempts.
- Непосредственно перед decrypt worker проверяет lease, active device и exact
  subscription version, затем вызывает Platform API fresh authorization.
  Platform повторно проверяет user/workspace/project, permission,
  `membershipId + membershipVersion` и lifecycle. Revoked/stale scope
  отменяется до расшифровки и внешнего вызова; недоступность Platform API
  повторяется как transport failure.
- HTTP Realtime создаёт persistent authenticated canary для каждого
  encryption/HMAC key version. Повторный startup проверяет bytes, а sender
  имеет только SELECT и не может принять отсутствующий canary. Поэтому
  same-version replacement fail-closed обнаруживается до обработки attempt.
- Bounded provider-expiry sweeper работает в sender role. VAPID private key
  никогда не поступает в Realtime HTTP, Platform API или Web.
- `deliveryAvailable=true` допускается только у полностью настроенного HTTP
  registration, когда оператор одновременно запускает sender profile.
  `testDeliveryAvailable` остаётся `false`, пока отдельная rate-limited test
  command не реализована; UI не имитирует test send.

## Доставка и миграция

Порядок rollout: миграция Realtime → runtime grants → запуск Realtime HTTP с
полным immutable keyring и созданием canaries → specialized sender grants →
profile `web-push`. Только после health/smoke включаются
`WEB_PUSH_REGISTRATION_ENABLED=true` и `WEB_PUSH_DELIVERY_AVAILABLE=true`.
Rollback сначала выключает availability/registration и sender, но не удаляет
attempts, canaries, devices или key versions.

## Последствия

Внешний Web Push transport готов к operator-managed production credentials и
не зависит от HTTP process lifetime. SMTP/digest и генерация остальных
source notification events остаются отдельными вертикальными срезами.
Web Push не может гарантировать exactly-once display на browser стороне;
устойчивость достигается идемпотентным attempt, provider topic/tag и
безопасным повтором.
