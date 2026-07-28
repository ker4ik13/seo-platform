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
- 54-ФЗ;
- онлайн-кассе либо сервису «Чеки от ЮKassa»;
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
4. read-only/ограничение новых платных jobs;
5. suspension;
6. retention до удаления.

Данные не удаляются сразу. Пользователь может экспортировать данные в разумный период.

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

Все цены — в рублях за workspace в месяц. Для B2C checkout показывается итоговая применимая цена. Годовая оплата даёт скидку 15% и оплачивается авансом.

| Параметр | Trial | Solo | Team | Agency | Business |
|---|---:|---:|---:|---:|---:|
| Цена/месяц | 0 | 1 490 ₽ | 4 490 ₽ | 10 990 ₽ | 29 990 ₽ |
| Срок trial | 14 дней | — | — | — | — |
| Пользователи | 1 | 1 | 5 | 15 | 30 |
| Проекты | 1 | 5 | 25 | 75 | 100 |
| Хранимые keywords/workspace | 25 тыс. | 250 тыс. | 2 млн | 10 млн | 30 млн |
| Максимум keywords/project | 25 тыс. | 250 тыс. | 2 млн | 5 млн | 5 млн |
| Active tracked context pairs | 500 | 10 тыс. | 50 тыс. | 250 тыс. | 1 млн |
| Хранилище | 0,5 GB | 5 GB | 30 GB | 100 GB | 300 GB |
| История позиций | 30 дней | 12 месяцев | 24 месяца | 36 месяцев | 36 месяцев |
| Scheduled automations | 1 | 10 | 100 | 500 | 2 000 |
| BYOK | да | да | да | да | да |
| Included data credits/месяц | 0 | 100 ₽ | 500 ₽ | 1 500 ₽ | 5 000 ₽ |
| Client role | — | — | да | да | да |
| Guest reports | — | 1 активный | 20 активных | 200 активных | 1 000 активных |
| White label | — | — | — | да | да |
| Public API/webhooks | — | — | ограниченно | да | да |
| Queue priority | trial | normal | normal+ | high | highest fair-use |
| Поддержка | docs | email | email | priority | priority |

Enterprise:

- от 69 900 ₽/месяц;
- индивидуальные seats/projects/capacity;
- договор, SLA, onboarding;
- SSO/SCIM после реализации;
- изолированные worker pools либо deployment только как отдельная платная опция;
- кредитный лимит только после договора и проверки.

### 22.1. Trial

- Не требует карты.
- Platform-paid integrations отключены.
- Разрешён BYOK.
- Один trial на верифицированный аккаунт/организацию в пределах anti-abuse policy.
- После окончания workspace переходит в read-only на 14 дней, затем сохраняется по общей retention policy.

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
| +12 месяцев доступной истории | 990 ₽/месяц |
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
- 54-ФЗ/чеки;
- полный и частичный refund;
- webhook deduplication;
- ежедневная сверка платежей;
- учёт payment fee как расхода;
- проверка российским бухгалтером налогового резерва.

## 28. Международный checkout

До подключения второго платёжного провайдера:

- сайт и приложение остаются международными;
- цены могут иметь информационное представление на английском;
- автоматический checkout гарантируется только для реально доступных ЮKassa методов;
- иностранным компаниям может быть доступен ручной invoice, если это законно и операционно возможно;
- невозможный способ оплаты не показывается как активный;
- продукт не заявляет глобальное покрытие платежей.

Второй payment adapter выбирается до масштабного продвижения за пределами доступной географии ЮKassa.
