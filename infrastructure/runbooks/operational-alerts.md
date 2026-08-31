# Внутренние ошибки в Telegram

## Назначение и граница

Alert receiver работает внутри `backend-core` на private-порту `4004` и
принимает только короткий allowlisted envelope. Он не принимает message,
stack trace, URL, request body, tenant payload или произвольную metadata.
Telegram получает код события, severity, service/source, необратимый
fingerprint, environment, версию и время.

Секреты разделены:

- `TELEGRAM_ALERT_BOT_TOKEN` и destination получает только child process
  `alert.main.js`;
- Frontend, Core/Execution supervisors и VPS watcher используют только
  `OPERATIONAL_ALERT_TOKEN` и private receiver URL;
- browser bundle, provider workers, queues, events и логи не получают bot
  token.

Receiver подавляет одинаковый fingerprint на 5 минут и отправляет не более 20
сообщений за 5 минут. Telegram не является источником истины и не заменяет
structured logs, metrics и incident timeline.

## Создание Telegram destination

1. Создать отдельного bot через официальный BotFather и добавить его только в
   служебный private chat/group.
2. Получить числовой chat ID. Для forum topic дополнительно получить
   положительный `message_thread_id`.
3. Ограничить доступ к группе и отключить ненужные bot permissions.
4. Сохранить значения только в secret storage Dokploy либо mode-600
   `runtime.env`. Не помещать bot token в Git, тикет, URL, shell history,
   build args или вывод CI.

## Dokploy rollout

Заполнить:

```dotenv
TELEGRAM_ALERTS_ENABLED=true
TELEGRAM_ALERT_BOT_TOKEN=<secret>
TELEGRAM_ALERT_CHAT_ID=<numeric-id>
TELEGRAM_ALERT_THREAD_ID=
TELEGRAM_ALERT_ENVIRONMENT=production
```

`OPERATIONAL_ALERT_TOKEN` генерируется через
`pnpm dokploy:env:generate` вместе с остальными distinct service tokens.
После deploy проверить `backend-core:4004/health/ready` только из private
network. Порт нельзя публиковать через Traefik.

Canary выполняется в Terminal контейнера `backend-core`; команда читает token
из environment и не подставляет его в аргументы процесса:

```bash
node --input-type=module -e '
const response = await fetch("http://127.0.0.1:4004/internal/alerts", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.OPERATIONAL_ALERT_TOKEN}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    version: 1,
    service: "backend-core",
    source: "release-canary",
    code: "OPERATIONAL_ALERT_CANARY",
    severity: "ERROR",
    fingerprint: "0000000000000000"
  }),
  redirect: "error",
  signal: AbortSignal.timeout(1500)
});
await response.body?.cancel();
if (response.status !== 202) process.exit(1);
'
```

Проверить одно сообщение в нужном chat/topic и убедиться, что оно не содержит
секретов, пользовательских данных или stack trace. Повтор canary в течение
пяти минут должен быть дедуплицирован.

## VPS rollout

На остановленном runtime выполнить:

```bash
SEO_PLATFORM_TELEGRAM_ALERT_CHAT_ID=-1001234567890 \
  infrastructure/vps/configure-telegram-alerts.sh
infrastructure/vps/start-runtime.sh
infrastructure/vps/status-runtime.sh
```

Bot token вводится без echo. Конфигуратор сначала отправляет canary и только
после успешного ответа атомарно обновляет `runtime.env`. Status должен показать
`http://127.0.0.1:4004/health/ready` со статусом `200`.

## Проверка отказов

- Остановить canary child process только в staging: supervisor должен
  отправить `UNEXPECTED_PROCESS_EXIT` и перезапустить component.
- Сгенерировать synthetic error log без пользовательских данных: сообщение
  должно содержать только `CHILD_ERROR_LOG` и fingerprint.
- Повторить одинаковое событие: Telegram не должен получить storm.
- Временно заблокировать outbound к Telegram в staging: application остаётся
  доступным, а локальный log содержит только generic
  `telegram delivery unavailable`.
- Запрос receiver без token, с duplicate Authorization, лишним JSON-полем или
  телом больше 2 KiB должен быть отклонён.

## Ротация и incident

`OPERATIONAL_ALERT_TOKEN` сейчас не имеет overlap keyring. Его ротация требует
координированного restart receiver и всех трёх application supervisors.
Bot token вращается через BotFather и затем меняется только у receiver.

При подозрении на утечку:

1. отозвать bot token;
2. временно установить `TELEGRAM_ALERTS_ENABLED=false`, не ослабляя internal
   receiver auth;
3. заменить оба секрета, проверить process environment boundaries и access
   logs без копирования значений в incident artifacts;
4. выполнить новый canary и удалить старые значения из secret storage.
