# Удалённый воркер на чистом Windows-ПК

Нужен Windows 10/11 x64 с включённой аппаратной виртуализацией, минимум 8 ГБ
ОЗУ и исходящий HTTPS-доступ к центральному серверу. Входящий IP, открытые
порты и локальная PostgreSQL не нужны. Для длительных операций отключите сон
ПК и включите автозапуск Docker Desktop после входа в Windows.

## 1. Windows, WSL и Docker

1. Откройте PowerShell **от администратора**, выполните `wsl --install` и
   перезагрузите ПК. Затем выполните `wsl --update`. Если виртуализация
   выключена, включите её в BIOS/UEFI.
2. Установите [Docker Desktop для Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
   Выберите backend **WSL 2** и режим Linux containers; запустите Docker
   Desktop и дождитесь состояния «Engine running».
3. В обычном PowerShell проверьте `docker version` и
   `docker compose version`. Если команды недоступны, перезапустите терминал.

## 2. Git и доступ к репозиторию

Установите [Git for Windows](https://git-scm.com/install/windows). Для
приватного репозитория вход выполняется через окно браузера Git Credential
Manager; GitHub-пароль и токен воркера **не** вставляйте в команду клонирования.

```powershell
New-Item -ItemType Directory -Path C:\seo-worker -Force
Set-Location C:\seo-worker
git clone https://github.com/ker4ik13/seo-platform.git
Set-Location .\seo-platform
git switch main
```

Для предварительной проверки тестовой ветки вместо `git switch main`
выполните `git switch codex/worker-fleet-db-pilot`.

## 3. Зарегистрировать узел и заполнить конфигурацию

На **том центре, к которому будет подключаться ПК**, откройте
`/admin` → «Воркеры» → «Создать воркер». Создайте отдельную запись для этого
ПК и сохраните показанные один раз `WORKER_NODE_ID` и `WORKER_NODE_TOKEN`.
Первое включение узла в админке отложите до проверки связи.

```powershell
Copy-Item .\infrastructure\.env.worker.example .\infrastructure\.env.worker
notepad .\infrastructure\.env.worker
```

Замените ID, токен и адрес центра. Для тестового стенда используйте
`WORKER_CONTROL_URL=https://144.31.221.28:3000`; для продакшна —
`WORKER_CONTROL_URL=https://seonorita.ru` **после проверки**, что маршрут
`/worker/v1/*` включён на продовом HTTPS-входе. Токен не копируйте в
`.env` основного сервера и не добавляйте файл в Git.

Для первого запуска рекомендуемые пределы на одном офисном ПК: HTTP 32,
позиции 32, Wordstat 10, CPU 2, контейнеру 4 CPU и 8 ГБ памяти. Это
верхние пределы, а не постоянное потребление; один физический Wordstat-ключ
всё равно ограничен десятью одновременными запросами XMLStock. После
проверки ресурсы можно увеличить в `.env.worker` и админке.

`WORKER_LOG_QUERIES=false` оставляет в логах только тип, ID, провайдера,
длительность и безопасный код результата. На доверенном ПК можно поставить
`true`, чтобы видеть ограниченный текст поисковой фразы. Docker logs доступны
локальным администраторам; после диагностики верните `false` и пересоздайте
контейнер. API-ключи в лог не пишутся.

## 4. Собрать и запустить

Из каталога `C:\seo-worker\seo-platform` в PowerShell:

```powershell
docker compose --env-file .\infrastructure\.env.worker -f .\infrastructure\worker.compose.yml config --quiet
docker compose --env-file .\infrastructure\.env.worker -f .\infrastructure\worker.compose.yml up -d --build
docker compose --env-file .\infrastructure\.env.worker -f .\infrastructure\worker.compose.yml ps
docker compose --env-file .\infrastructure\.env.worker -f .\infrastructure\worker.compose.yml logs --tail=100 -f execution-worker
```

Первая сборка и обновление антивирусных сигнатур могут занять несколько
минут. В логах должно появиться «Воркер … на связи». Затем в админке
убедитесь, что heartbeat свежий и слоты соответствуют `.env.worker`, и
включите узел. Проверьте небольшой заранее оценённой операцией; не публикуйте
в чат токен и полные логи при `WORKER_LOG_QUERIES=true`.

## 5. Обновить или плавно остановить

```powershell
git pull --ff-only
docker compose --env-file .\infrastructure\.env.worker -f .\infrastructure\worker.compose.yml up -d --build
```

Перед ручной остановкой нажмите в админке «Остановить плавно» и дождитесь
завершения активных задач. Один Docker Compose узел при обновлении не даёт
строго нулевого простоя: старый контейнер завершает уже полученную работу,
после чего запускается новый; новые задания в это время берёт другой узел
либо основной сервер. Для бесшовных обновлений нужны минимум два узла.
Не запускайте `docker compose down -v`: `-v` удаляет локальные volumes.

Если узел не подключается, проверьте исходящий HTTPS, совпадение ID/токена,
адрес `WORKER_CONTROL_URL` и статус узла в админке. Если Docker Desktop
остановлен или ПК ушёл в сон, центр перестанет выдавать ему новые задачи.
