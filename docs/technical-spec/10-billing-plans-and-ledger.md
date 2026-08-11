# Тарифы, баланс, биллинг и учёт операций

## 1. Принципы

- Финансовые операции append-only.
- Текущий баланс вычисляется из ledger либо поддерживается как проверяемая проекция.
- Любая запись имеет уникальный business reference.
- Деньги хранятся integer minor units + currency.
- Прайс операции версионируется.
- Повтор webhook не создаёт повторное зачисление.
- Пользователь всегда видит estimate до платной операции.

## 2. Тариф

Plan содержит:

- code;
- localized name/description;
- status;
- billing periods;
- base prices by currency;
- included seats;
- included projects;
- semantic keywords;
- tracked keywords;
- monthly platform operations;
- storage;
- history retention;
- worker priority;
- integrations;
- white label;
- reports;
- API/webhooks;
- support level;
- feature flags;
- effective period.

Изменение опубликованного тарифа создаёт новую версию.

## 3. Add-ons

- extra seat;
- extra project;
- extra tracked keywords;
- extra storage;
- longer retention;
- priority processing;
- white label;
- SSO;
- premium integrations.

## 4. Subscription

Поля:

- workspace;
- plan/version;
- status;
- period;
- startedAt;
- currentPeriodStart/End;
- cancelAtPeriodEnd;
- trialEnd;
- graceEnd;
- payment provider;
- external IDs;
- currency;
- tax mode.

Статусы:

- trialing;
- active;
- past_due;
- grace;
- paused;
- cancelling;
- cancelled;
- suspended.

## 5. Usage metering

Измерения:

- active seats;
- projects;
- stored keywords;
- tracked keyword-context pairs;
- provider operation units;
- storage bytes;
- report renders;
- API calls;
- collaboration capacity.

Usage event:

- workspace;
- meter;
- quantity;
- source;
- occurredAt;
- idempotency key;
- metadata;
- price book version.

## 6. Балансы

Workspace может иметь:

- cash/prepaid balance;
- promotional balance;
- included quota;
- credit limit для договорных клиентов.

Порядок списания:

1. included quota;
2. promotional balance с учётом expiry;
3. prepaid balance;
4. credit limit, если разрешён.

Порядок должен быть виден в UI и конфигурируем platform finance.

## 7. Ledger

Типы accounts:

- customer prepaid liability;
- promotional;
- provider cost;
- platform revenue;
- refunds;
- taxes;
- payment clearing;
- reservation.

Transaction содержит debit/credit entries и обязана балансироваться.

Операции:

- top-up;
- reservation;
- capture;
- release;
- refund;
- manual adjustment;
- subscription payment;
- chargeback;
- promo grant;
- promo expiration.

Manual adjustment требует причины, второго подтверждения выше порога и audit.

## 8. Estimate и reservation

1. Job service запрашивает estimate.
2. Billing возвращает line items и срок действия.
3. Пользователь подтверждает.
4. Создаётся reservation.
5. Job стартует.
6. Usage фиксируется по chunks.
7. Завершение создаёт capture.
8. Остаток release.

Если estimate истёк, перед запуском выполняется повторный расчёт и при существенном увеличении требуется новое подтверждение.

## 9. Budgets

Уровни:

- workspace monthly;
- project monthly;
- integration;
- automation;
- user/role;
- single job;
- daily emergency.

Пороговые действия:

- notify;
- require approval;
- block;
- use BYOK only;
- disable fallback.

## 10. Billing UI

Разделы:

- current plan;
- usage;
- balance;
- top up;
- payment methods;
- invoices;
- transactions;
- budgets;
- price book;
- billing details;
- tax data.

Графики:

- spend over time;
- by project;
- by provider;
- by operation;
- BYOK vs platform;
- estimated month end.

## 11. Checkout

- plan and period;
- country;
- legal/person type;
- billing address;
- tax IDs;
- payment method;
- currency;
- promo code;
- order summary;
- Terms acceptance;
- success/pending/failure.

Платёжный frontend не должен обрабатывать card data напрямую, если можно использовать hosted fields/provider checkout.

## 12. Международные платежи

Платёжный слой абстрагирует:

- ЮKassa как первого провайдера для российского рынка;
- международный card/subscription provider;
- Merchant of Record при выбранной модели;
- локальных провайдеров;
- bank invoices/manual payment.

Юридическая регистрация оператора первого этапа — Российская Федерация. Первый production adapter — ЮKassa.

Ограничения:

- основной checkout первого этапа работает в рублях;
- ЮKassa не считается достаточным единственным способом оплаты для международного SaaS;
- по умолчанию поддержка зарубежных карт ограничена правилами ЮKassa и договором магазина;
- до подключения второго провайдера международный пользователь видит доступные способы оплаты, запрос счёта либо waitlist, но не неработающую форму;
- USD/EUR prices не рассчитываются простым пересчётом RUB в момент оплаты: для них публикуются отдельные versioned prices после появления соответствующего эквайринга;
- платёжные provider IDs и состояния хранятся в общей модели, чтобы подключение второго адаптера не требовало изменения подписок.

ЮKassa должна поддерживать:

- hosted payment flow;
- сохранённый способ оплаты и автоплатёж только после отдельного согласия пользователя;
- idempotency key;
- входящие уведомления;
- полный и частичный возврат;
- payment pending/succeeded/canceled states;
- отключение автоплатежа;
- reconciliation;
- передачу данных для фискализации.

## 13. Счета и документы

- invoice;
- receipt;
- act/локальные документы при необходимости;
- credit note;
- refund document.

Документы immutable после выпуска; исправления создают новые документы.

Для российского оператора до запуска требуется решение бухгалтера по:

- системе налогообложения;
- применимости НДС;
- корректности режима НПД и ограничений для самозанятого;
- моменту признания дохода и формулировкам услуг в чеке «Мой налог»;
- условиям будущего перехода на ИП/ООО, 54-ФЗ и онлайн-кассу;
- предмету и способу расчёта для подписки, пополнения баланса и add-ons;
- B2B-счетам, актам/УПД и ЭДО;
- возвратам неиспользованного баланса.

## 14. Promo codes

Параметры:

- code;
- period;
- usage limit;
- per-customer limit;
- plans;
- countries/currencies;
- fixed/percent;
- first period/all periods;
- eligibility.

Применение идемпотентно и аудитируется.

## 15. Grace и ограничения

При failed renewal:

1. `past_due` и уведомление;
2. retry provider;
3. grace period;
4. read-only/ограничение новых операций;
5. блокировка новых расходов и изменений до восстановления оплаты;
6. сохранение проектов и ранее собранных результатов.

Биллинг не запускает автоматическое удаление проектов. В read-only разрешены:

- просмотр проектов, истории, отчетов и audit;
- скачивание уже готовых artifacts;
- ограниченный экспорт уже хранимых parsed/aggregate данных;
- пополнение баланса и управление оплатой.

Запрещены новые provider calls, crawl/Radar runs, imports, массовые изменения и
создание сущностей сверх текущего тарифа. Удаление возможно только через
отдельный подтверждённый lifecycle пользователя или юридическую процедуру.

## 16. BYOK и биллинг

- Provider cost равен нулю для платформенного ledger, если запрос реально выполнен BYOK.
- Платформа может списывать SaaS operation quota.
- При fallback на platform key пользователь видит отдельную line item.
- Ошибочная конфигурация BYOK не должна автоматически создавать платный fallback без согласия.

## 17. Admin billing

Platform finance может:

- искать workspace;
- просматривать subscription/ledger;
- инициировать refund;
- добавлять adjustment;
- выдавать promo;
- менять plan с effective date;
- отмечать bank payment;
- блокировать spending;
- выгружать reconciliation.

Не может:

- редактировать существующие ledger entries;
- видеть полные API/payment secrets;
- скрывать audit.

## 18. Webhooks платежей

- signature verification;
- timestamp/replay protection;
- inbox deduplication;
- raw encrypted/secured payload retention;
- processing status;
- retry;
- reconciliation job.

Для ЮKassa canonical source — результат повторного server-to-server запроса объекта по provider ID, когда webhook недостаточен или неоднозначен. Возврат `2xx` не должен предшествовать надёжной фиксации inbox/processing command.

## 19. Состояния UI

- no subscription;
- trial;
- active;
- usage warning;
- limit reached;
- payment pending;
- payment failed;
- grace;
- suspended;
- top-up pending;
- refund pending;
- invoice generating;
- promo invalid/expired;
- estimate expired;
- insufficient funds;
- reservation active.

## 20. Зафиксированная стартовая коммерческая модель

Используются два независимых вида оплаты:

1. SaaS-подписка — приложение, пользователи, проекты, хранение, история, отчёты и automation capacity.
2. Data balance — фактически использованные системные SEO API.

Количество активных tracked keyword-context pairs в тарифе является лимитом хранения и расписаний, но не означает бесплатный ежедневный съём. Каждый системный сбор оплачивается из included data credits и затем из prepaid balance. При BYOK provider cost оплачивает сам пользователь.

Это обязательное правило не позволяет большим проектам создавать неограниченный внешний расход внутри фиксированной подписки.

Проекты и агрегированные результаты не удаляются при нулевом data balance,
окончании тарифа или downgrade. Если новый тариф ниже текущего объёма, данные
остаются видимыми, а новые additions/runs блокируются до уменьшения объёма,
покупки add-on или смены тарифа.

## 21. Рыночное позиционирование

При формировании стартовой сетки использованы публичные цены июля 2026 года:

- Arsenkin Tools: 850 / 2 190 / 3 990 ₽ в месяц;
- Rush Analytics: 500 / 999 / 3 499 ₽ и более;
- Keys.so: 5 300 / 9 300 / 34 900 ₽ в месяц;
- международные all-in-one продукты находятся существенно выше по цене, например Semrush SEO Toolkit от 139 USD в месяц, Ahrefs Lite от 129 USD в месяц.

Платформа должна находиться:

- выше узкого одиночного парсера;
- около среднего российского профессионального SEO-инструмента на Team;
- ниже стоимости самостоятельного набора нескольких сервисов;
- существенно ниже международных enterprise all-in-one решений на младших тарифах.

Цены являются стартовой гипотезой и пересматриваются после P0 cost benchmark и первых 20–30 платящих workspace, но не могут быть снижены ниже unit-economics floor.

## 22. Стартовые тарифы для России

Все цены — в рублях за рабочую область в месяц. Подписка и её лимиты
принадлежат рабочей области, а не отдельному пользователю. Приглашённый
участник получает возможности тарифа только внутри этой рабочей области и в
рамках выданных ему проектных прав. Платные тарифы продлеваются ежемесячно;
сохранение способа оплаты и автосписание в checkout включены по умолчанию, но
пользователь может явно отключить их до оплаты.

| Параметр | Бесплатный | Старт | Профессиональный | Максимальный |
|---|---:|---:|---:|---:|
| Цена/месяц | 0 | 1 990 ₽ | 5 990 ₽ | 14 990 ₽ |
| Пользователи | 5 | 20 | 50 | 100 |
| Проекты | 2 | 10 | 30 | 100 |
| Keywords в одном проекте | 5 тыс. | 20 тыс. | 50 тыс. | без лимита |
| Одновременно выполняемые задачи | 1 | 5 | 15 | 30 |
| BYOK-интеграции | без лимита | без лимита | без лимита | без лимита |
| Хранилище | 0,5 GB | 5 GB | 30 GB | 100 GB |
| Raw SERP по умолчанию | 7 дней | 30 дней | 90 дней | 365 дней |
| Scheduled automations | 1 | 25 | 250 | 2 000 |
| Guest reports | — | 10 активных | 100 активных | 1 000 активных |
| White label | — | — | — | да |
| Public API/webhooks | sandbox | базовый | базовый | базовый |
| Queue priority | trial | normal | normal+ | high |

Количество подключений со своими API-ключами и число выполненных через них
операций не тарифицируются отдельно. Любая долгая операция всё равно занимает
один общий слот параллельных задач рабочей области. Проверка проектов,
участников, keywords и активных задач выполняется сервером атомарно;
ограничение нельзя обойти параллельными запросами или импортом.
Число пользовательских папок не является тарифным ресурсом и не ограничено
продуктовым планом. Значение `foldersPerProject = 0` в совместимом внутреннем
контракте означает отсутствие лимита и не отображается в интерфейсе тарифа.

### 22.1. Бесплатный тариф

- Не требует карты и не истекает.
- Включает до 5 участников, два проекта, до 5 тысяч keywords на проект и один
  слот фоновых задач.
- Platform-paid integrations отключены; BYOK разрешён без лимита подключений.
- При переходе на более дешёвый тариф данные сверх лимита не удаляются, но
  создание новых сущностей и запуск новых задач блокируются до освобождения
  capacity или повышения тарифа.

### 22.2. Included data credits

- Номинал соответствует customer price, а не provider себестоимости.
- Начисляется в начале оплаченного периода.
- Сначала тратится included credit, затем prepaid balance.
- Не переносится между периодами.
- Не выводится и не возвращается деньгами.
- Не может использоваться для provider, не разрешившего platform-paid модель.

## 23. Add-ons

Стартовые цены:

| Add-on | Цена |
|---|---:|
| Дополнительный пользователь | 590 ₽/месяц |
| Дополнительный project slot | 390 ₽/месяц |
| +10 тыс. tracked context pairs capacity | 590 ₽/месяц |
| +50 GB storage | 590 ₽/месяц |
| +30 дней Raw SERP retention | 990 ₽/месяц |
| White label для Team | 1 490 ₽/месяц |
| Дополнительные 100 активных guest links | 490 ₽/месяц |

Ограничения:

- add-on не поднимает hard technical maximum одного проекта;
- provider usage не входит в tracked capacity add-on;
- превышение storage не удаляет данные мгновенно: сначала warning/grace;
- цены add-ons также версионируются.

## 24. Предварительный price book системных SEO API

Цены ниже нужны для финансового моделирования и beta. Перед production они синхронизируются с договором и актуальной стоимостью provider.

### 24.1. XMLStock

Ориентиры customer price:

| Операция | Единица | Стартовая цена |
|---|---:|---:|
| Яндекс Search API, TOP-100 | 1 000 keyword-context checks | 120 ₽ |
| Яндекс Live, TOP-30 | 1 000 keyword-context checks | 300 ₽ |
| Google Live, TOP-100 | 1 000 keyword-context checks | 900 ₽ |
| Wordstat request | 1 000 запросов | 120 ₽ |

Причина разницы: в XMLStock получение Google TOP-100 требует до 10 provider requests, Яндекс Live TOP-30 — до 3, а Яндекс Search API TOP-100 — один запрос.

### 24.2. Arsenkin Tools

Только после коммерческого согласования platform-paid режима:

| Операция | Единица | Стартовая цена |
|---|---:|---:|
| Позиция в одном context | 1 000 keywords | 250 ₽ |
| Один вид частотности | 1 000 keywords | 150 ₽ |
| Кластеризация | 1 000 keywords | 200 ₽ |
| Выгрузка TOP-10 | 1 000 keywords | 150 ₽ |

Опции, потребляющие дополнительные provider limits, показываются отдельными line items.

### 24.3. Keys.so

- BYOK включён в SaaS-тариф и не создаёт provider charge платформы.
- Platform-paid price не публикуется до коммерческого договора.
- Публичная подписка Keys.so не считается разрешением перепродавать данные.
- После договора тарификация должна учитывать тип отчёта, API request, полученные строки и месячные fixed commitments.

### 24.4. Округление

- Estimate рассчитывается с точностью внутренних micros.
- Пользовательский line item округляется только на итоговом допустимом уровне.
- Минимальная стоимость одной job может составлять 1 ₽.
- Partial failure списывает только фактически полученные пригодные результаты и невозвратимые provider costs, заранее описанные пользователю.

## 25. Формула защиты от отрицательной маржи

Для каждой операции:

`customerPrice >= (providerCost + variableInfrastructure + riskReserve) / (1 - paymentFeeReserve - taxReserve - targetContributionMargin)`

Стартовые параметры:

- `paymentFeeReserve = 4.5%`;
- `taxReserve = 10%` до заключения бухгалтера;
- `targetContributionMargin = 55%` для platform-paid data;
- `riskReserve` покрывает сгорающие пакеты, курсовую разницу и provider price changes.

При этих параметрах безопасный customer price обычно не ниже примерно `3.3 × direct variable cost`.

Для SaaS-подписки целевая contribution margin после included data credits и variable infrastructure:

- Solo/Team/Agency — не ниже 70%;
- Business — не ниже 65% на старте и 70% после оптимизации;
- Enterprise — рассчитывается индивидуально.

Расчёт не включает payroll и маркетинг: они покрываются оставшейся contribution margin. До публикации цены финансовая модель должна добавить фактические fixed costs.

## 26. Provider activation gates

Platform-paid provider не включается, пока:

- юридически не разрешена выбранная схема;
- нет актуального cost contract;
- не реализован hard spending cap;
- не протестированы reservation/settlement/refund;
- не настроен provider balance alert;
- месячный forecasted revenue не покрывает fixed provider commitment минимум в 1,5 раза;
- worst-case retry/failure не создаёт повторного расхода;
- цену можно отключить или обновить с effective date.

Для первых интеграций:

- XMLStock — первый кандидат platform-paid благодаря developer integration и поштучной стоимости;
- Arsenkin Tools — сначала BYOK, затем договор;
- Keys.so — BYOK до отдельного письменного соглашения.

## 27. ЮKassa и unit economics

В финансовой модели используется не только заявленная комиссия, но и НДС на комиссию. Для базовой карточной ставки 3,5% и НДС 22% от комиссии эффективный расход составляет примерно 4,27% платежа. В модели используется резерв 4,5%.

До production обязательны:

- договорная ставка ЮKassa;
- тест автоплатежа;
- явное согласие и управление сохранённым способом оплаты;
- НПД receipt workflow для текущего статуса самозанятого; 54-ФЗ применяется
  только после смены юридического/налогового статуса;
- полный и частичный refund;
- webhook deduplication;
- ежедневная сверка платежей;
- учёт payment fee как расхода;
- проверка российским бухгалтером налогового резерва.

## 28. Чеки НПД для платежей ЮKassa

### 28.1. Область применения

На первом этапе оператор является плательщиком налога на профессиональный
доход. Receipt workflow запускается только для входящего платежа:

- `paymentProvider = YOOKASSA`;
- payment прошёл webhook verification и reconciliation;
- итоговый статус ЮKassa — `succeeded`;
- доход относится к облагаемой НПД услуге платформы.

Банковские переводы, ручные ledger adjustments и будущие payment adapters не
создают чек через этот workflow. Для них до отдельного решения показывается
`NPD_RECEIPT_NOT_MANAGED`.

Квитанция/уведомление ЮKassa об оплате не считается чеком НПД. С 29 декабря
2025 года ЮKassa не предоставляет автоматическую регистрацию чеков
самозанятых в «Мой налог». Поэтому вызов API чеков ЮKassa по 54-ФЗ для этого
сценария запрещён.

### 28.2. Допустимые режимы

Первый production-режим — `MANUAL_MY_TAX`:

1. verified `payment.succeeded` идемпотентно создаёт receipt obligation;
2. система подготавливает сумму, дату, описание услуги и данные покупателя;
3. владелец открывает задачу в собственной billing/admin панели;
4. чек создаётся владельцем в официальном приложении или web-кабинете
   «Мой налог»;
5. владелец сохраняет в платформе официальный receipt ID/URL/QR или файл;
6. система отправляет чек клиенту и фиксирует доставку.

Будущие автоматические режимы:

- `FNS_PARTNER_API`;
- `AUTHORIZED_OPERATOR`.

Они включаются только после официального подключения ФНС как оператора
электронной площадки/партнёра либо договора с уполномоченным оператором.
Использование неофициальных библиотек, reverse-engineered mobile API,
хранение логина/пароля «Мой налог» и browser automation запрещены.

### 28.3. Receipt obligation

Поля:

- `id`;
- `paymentId` и `yookassaPaymentId` — unique;
- `workspaceId` плательщика при необходимости аналитики;
- gross amount до вычета комиссии ЮKassa;
- currency `RUB`;
- payment succeeded timestamp;
- service line/description snapshot;
- buyer type: individual, individual entrepreneur, legal entity;
- buyer name и ИНН для ИП/ЮЛ;
- delivery email/phone, предоставленные до оплаты;
- registration mode;
- status;
- official receipt ID, URL/QR и registeredAt;
- delivery status/attempts/deliveredAt;
- cancellation reason и replacement receipt relation;
- audit/request/provider event IDs.

Сумма receipt obligation должна совпадать с подтверждённой gross-суммой
платежа, а не с суммой после комиссии эквайринга. Описание услуги берётся из
versioned billing catalog и доступно для проверки перед ручной регистрацией.

Статусы:

- `PENDING`;
- `AWAITING_MANUAL_REGISTRATION`;
- `REGISTERING`;
- `REGISTERED`;
- `DELIVERY_PENDING`;
- `DELIVERED`;
- `FAILED_RETRYABLE`;
- `FAILED_FINAL`;
- `CANCELLATION_PENDING`;
- `CANCELLED`;
- `REPLACEMENT_REQUIRED`.

### 28.4. Сроки и контроль

Для оплаты электронным средством система считает чек требующим немедленной
регистрации и доставки после `succeeded`, не откладывая его до крайнего
законного срока. Панель показывает age/SLA, просроченные задачи и escalation.
Отсутствие автоматического adapter не должно скрывать обязательство.

Webhook и receipt creation идемпотентны. Повторное событие ЮKassa не создаёт
второй чек. Reconciliation job находит успешные платежи без receipt obligation
и создаёт incident/task.

### 28.5. Доставка клиенту

После регистрации:

- чек доступен в billing history аккаунта;
- email отправляется через transactional email adapter;
- письмо содержит официальный URL и прикреплённый/ссылочный PDF только при
  наличии достоверного artifact;
- доставка повторяется с bounded retry;
- bounce не отменяет чек и создаёт задачу сменить канал;
- в audit фиксируется доставка без записи полного содержимого письма.

### 28.6. Возвраты и исправления

- действие начинается только после успешного YooKassa refund;
- полный возврат создаёт задачу аннулировать чек с причиной «Возврат средств»;
- ошибка в данных требует аннулирования ошибочного чека и немедленного
  создания replacement;
- частичный возврат переводит obligation в `REPLACEMENT_REQUIRED`: исходный
  чек аннулируется и создаётся корректный чек на оставшийся доход;
- receipt нельзя аннулировать только из-за chargeback/dispute без
  подтверждённого возврата и проверки финансового администратора;
- все связи payment → refund → cancelled receipt → replacement сохраняются.

## 29. Международный checkout

До подключения второго платёжного провайдера:

- сайт и приложение остаются международными;
- цены могут иметь информационное представление на английском;
- автоматический checkout гарантируется только для реально доступных ЮKassa методов;
- иностранным компаниям может быть доступен ручной invoice, если это законно и операционно возможно;
- невозможный способ оплаты не показывается как активный;
- продукт не заявляет глобальное покрытие платежей.

Второй payment adapter выбирается до масштабного продвижения за пределами доступной географии ЮKassa.
