import type { Locale } from "./locales";

export interface LandingFeature {
  readonly code:
    | "SEM"
    | "RANK"
    | "TECH"
    | "CONTENT"
    | "RIVALS"
    | "AUTO"
    | "TEAM"
    | "REPORT"
    | "API"
    | "COST";
  readonly title: string;
  readonly description: string;
  readonly highlights: readonly string[];
  readonly tone: "coral" | "violet" | "mint" | "sand";
}

export interface LandingContent {
  readonly brand: string;
  readonly brandDescriptor: string;
  readonly metadata: {
    readonly title: string;
    readonly description: string;
    readonly keywords: readonly string[];
  };
  readonly navigation: {
    readonly product: string;
    readonly capabilities: string;
    readonly roadmap: string;
    readonly about: string;
    readonly subscribe: string;
    readonly languageLabel: string;
  };
  readonly hero: {
    readonly status: string;
    readonly titleBefore: string;
    readonly titleAccent: string;
    readonly titleAfter: string;
    readonly text: string;
    readonly primaryCta: string;
    readonly secondaryCta: string;
    readonly note: string;
    readonly audience: readonly string[];
  };
  readonly preview: {
    readonly ariaLabel: string;
    readonly label: string;
    readonly project: string;
    readonly period: string;
    readonly visibility: string;
    readonly visibilityValue: string;
    readonly topKeywords: string;
    readonly topKeywordsValue: string;
    readonly tasks: string;
    readonly tasksValue: string;
    readonly chartTitle: string;
    readonly chartDelta: string;
    readonly taskTitle: string;
    readonly taskItems: readonly [string, string][];
    readonly signal: string;
    readonly signalText: string;
  };
  readonly problem: {
    readonly eyebrow: string;
    readonly title: string;
    readonly text: string;
    readonly cards: readonly {
      readonly number: string;
      readonly title: string;
      readonly text: string;
    }[];
  };
  readonly system: {
    readonly eyebrow: string;
    readonly title: string;
    readonly text: string;
    readonly flow: readonly {
      readonly label: string;
      readonly detail: string;
    }[];
    readonly caption: string;
  };
  readonly capabilities: {
    readonly eyebrow: string;
    readonly title: string;
    readonly text: string;
    readonly items: readonly LandingFeature[];
  };
  readonly integrations: {
    readonly eyebrow: string;
    readonly title: string;
    readonly text: string;
    readonly plannedLabel: string;
    readonly items: readonly string[];
    readonly byokTitle: string;
    readonly byokText: string;
  };
  readonly audiences: {
    readonly eyebrow: string;
    readonly title: string;
    readonly items: readonly {
      readonly label: string;
      readonly title: string;
      readonly text: string;
    }[];
  };
  readonly roadmap: {
    readonly eyebrow: string;
    readonly title: string;
    readonly text: string;
    readonly currentLabel: string;
    readonly items: readonly {
      readonly stage: string;
      readonly title: string;
      readonly text: string;
      readonly status: "current" | "next" | "later";
    }[];
  };
  readonly principles: {
    readonly eyebrow: string;
    readonly title: string;
    readonly items: readonly {
      readonly title: string;
      readonly text: string;
    }[];
  };
  readonly about: {
    readonly eyebrow: string;
    readonly title: string;
    readonly paragraphs: readonly string[];
    readonly quote: string;
  };
  readonly faq: {
    readonly eyebrow: string;
    readonly title: string;
    readonly items: readonly {
      readonly question: string;
      readonly answer: string;
    }[];
  };
  readonly waitlist: {
    readonly eyebrow: string;
    readonly title: string;
    readonly text: string;
    readonly cta: string;
    readonly privacy: string;
  };
  readonly footer: {
    readonly tagline: string;
    readonly navigationLabel: string;
    readonly developer: string;
    readonly rights: string;
  };
}

export const landingContent: Record<Locale, LandingContent> = {
  ru: {
    brand: "SEOньорита",
    brandDescriptor: "SEO-платформа",
    metadata: {
      title: "SEOньорита — единая платформа для системного SEO",
      description:
        "Будущая SEO-платформа для семантики, позиций, SERP, контента, аналитики, автоматизаций и командной работы. Следите за разработкой SEOньориты.",
      keywords: [
        "SEO платформа",
        "сервис для SEO",
        "семантическое ядро",
        "мониторинг позиций",
        "анализ конкурентов",
        "SEO автоматизация",
        "SEOньорита"
      ]
    },
    navigation: {
      product: "Продукт",
      capabilities: "Возможности",
      roadmap: "План запуска",
      about: "О проекте",
      subscribe: "Ждать релиз",
      languageLabel: "English version"
    },
    hero: {
      status: "Платформа в разработке · открытый roadmap",
      titleBefore: "SEO без хаоса.",
      titleAccent: "Одна система",
      titleAfter: "для всей работы.",
      text:
        "SEOньорита объединит семантику, позиции, SERP, контент, конкурентов, задачи и отчётность — с прозрачными источниками данных, историей изменений и автоматизациями.",
      primaryCta: "Следить за запуском",
      secondaryCta: "Посмотреть возможности",
      note: "Без спама. Только прогресс разработки, ранний доступ и дата запуска.",
      audience: ["SEO-специалистам", "Агентствам", "In-house командам"]
    },
    preview: {
      ariaLabel: "Концепт интерфейса SEOньориты",
      label: "Концепт интерфейса",
      project: "Проект / Север",
      period: "Последние 30 дней",
      visibility: "Видимость",
      visibilityValue: "38,4%",
      topKeywords: "Запросы в топ-10",
      topKeywordsValue: "6 284",
      tasks: "Активные задачи",
      tasksValue: "12",
      chartTitle: "Поисковая видимость",
      chartDelta: "+6,8% за период",
      taskTitle: "Поток работ",
      taskItems: [
        ["Съём позиций", "готово"],
        ["Кластеризация", "68%"],
        ["Технический аудит", "в очереди"]
      ],
      signal: "Найден новый сигнал",
      signalText: "Страница /catalog выросла на 9 позиций"
    },
    problem: {
      eyebrow: "Зачем ещё одна платформа",
      title: "SEO-процесс не должен рассыпаться между десятком сервисов",
      text:
        "Когда данные, решения и задачи живут отдельно, команда теряет контекст. SEOньорита строится вокруг единой цепочки — от запроса до измеримого результата.",
      cards: [
        {
          number: "01",
          title: "Меньше ручной склейки",
          text:
            "Импорты, таблицы, парсеры и отчёты связаны в одном проекте, а рутинные шаги превращаются в повторяемые сценарии."
        },
        {
          number: "02",
          title: "Больше доверия к данным",
          text:
            "У каждой метрики видны источник, свежесть и история. Изменения не исчезают, а результаты можно воспроизвести и проверить."
        },
        {
          number: "03",
          title: "Команда видит общую картину",
          text:
            "Роли, комментарии, задачи, клиентские отчёты и стоимость операций находятся рядом с данными, к которым относятся."
        }
      ]
    },
    system: {
      eyebrow: "Главная идея",
      title: "От запроса до результата — одна прослеживаемая цепочка",
      text:
        "Не просто набор инструментов, а рабочая система, которая сохраняет контекст SEO-решений на каждом шаге.",
      flow: [
        { label: "Запрос", detail: "интент и спрос" },
        { label: "Кластер", detail: "структура семантики" },
        { label: "Страница", detail: "целевая URL" },
        { label: "Данные", detail: "SERP и метрики" },
        { label: "Изменение", detail: "гипотеза и действие" },
        { label: "Результат", detail: "история и эффект" }
      ],
      caption:
        "Вся история остаётся в проекте: кто, когда и почему принял решение — и что изменилось после."
    },
    capabilities: {
      eyebrow: "Будущие возможности",
      title: "Всё, что нужно для ежедневной SEO-работы",
      text:
        "Модули будут запускаться поэтапно. Ниже — целевое направление продукта, а не обещание доступности каждой функции в первом релизе.",
      items: [
        {
          code: "SEM",
          title: "Семантика и кластеры",
          description:
            "Единое семантическое ядро вместо хрупких файлов и бесконечных копий таблиц.",
          highlights: [
            "Импорт CSV, TSV и XLSX",
            "Группы, интенты и дедупликация",
            "Частотности, теги и история"
          ],
          tone: "coral"
        },
        {
          code: "RANK",
          title: "Позиции и SERP",
          description:
            "Регулярный мониторинг выдачи с понятной свежестью, источником и историей каждого наблюдения.",
          highlights: [
            "Расписания и регионы",
            "Динамика URL и каннибализация",
            "Снимки выдачи и конкуренты"
          ],
          tone: "violet"
        },
        {
          code: "TECH",
          title: "Технический аудит",
          description:
            "Контроль индексируемости, метаданных, sitemap, robots.txt, редиректов и технических сигналов.",
          highlights: [
            "Мониторинг критичных страниц",
            "Приоритеты и история проблем",
            "Проверки после исправлений"
          ],
          tone: "mint"
        },
        {
          code: "CONTENT",
          title: "Страницы и контент",
          description:
            "Связь запросов, целевых страниц, контентных задач и измеримого эффекта от изменений.",
          highlights: [
            "Карта посадочных страниц",
            "Контентные брифы и задачи",
            "Версии, согласования и эффект"
          ],
          tone: "sand"
        },
        {
          code: "RIVALS",
          title: "Конкуренты",
          description:
            "Сравнение поисковой видимости, пересечений семантики, сильных страниц и изменений в нише.",
          highlights: [
            "Доли видимости",
            "Контентные разрывы",
            "Новые игроки и аномалии"
          ],
          tone: "sand"
        },
        {
          code: "AUTO",
          title: "Автоматизации",
          description:
            "Расписания, очереди и сценарии, которые продолжают работать без открытой вкладки браузера.",
          highlights: [
            "Повторяемые workflow",
            "Retry и контроль ошибок",
            "Уведомления о результате"
          ],
          tone: "coral"
        },
        {
          code: "TEAM",
          title: "Команда и клиенты",
          description:
            "Рабочие области, роли, комментарии, аудит изменений и безопасный клиентский доступ.",
          highlights: [
            "Гибкие права и проекты",
            "Совместная работа",
            "White-label отчёты"
          ],
          tone: "violet"
        },
        {
          code: "REPORT",
          title: "Отчёты и сигналы",
          description:
            "Дашборды, регулярные отчёты и важные изменения без потока бессмысленных уведомлений.",
          highlights: [
            "Настраиваемые дашборды",
            "Email, Telegram и Web Push",
            "Экспорт и гостевые ссылки"
          ],
          tone: "mint"
        },
        {
          code: "API",
          title: "Интеграции и API",
          description:
            "Собственные ключи провайдеров, прозрачная маршрутизация данных и публичный API платформы.",
          highlights: [
            "BYOK без передачи ключей в браузер",
            "Webhooks и API-токены",
            "Источники и provenance"
          ],
          tone: "mint"
        },
        {
          code: "COST",
          title: "Лимиты и стоимость",
          description:
            "Оценка объёма и цены до запуска платной операции — без неожиданных списаний после.",
          highlights: [
            "Estimate до подтверждения",
            "Бюджеты проектов",
            "История использования"
          ],
          tone: "coral"
        }
      ]
    },
    integrations: {
      eyebrow: "Экосистема",
      title: "Подключайте привычные источники. Сохраняйте контроль.",
      text:
        "SEOньорита проектируется как открытая система: с BYOK-ключами, API и понятным происхождением каждого набора данных.",
      plannedLabel: "В плане интеграций",
      items: [
        "Keys.so",
        "Arsenkin Tools",
        "XMLStock",
        "Google Search Console",
        "Google Analytics 4",
        "Яндекс Вебмастер",
        "Telegram",
        "Public API"
      ],
      byokTitle: "Ваши ключи — ваши лимиты",
      byokText:
        "BYOK позволит подключать собственные аккаунты провайдеров. Платформа будет заранее показывать маршрут, оценку объёма и стоимость операции."
    },
    audiences: {
      eyebrow: "Для кого",
      title: "Один продукт — разные рабочие процессы",
      items: [
        {
          label: "Solo",
          title: "Самостоятельным специалистам",
          text:
            "Быстрее собирать данные, поддерживать порядок в проектах и автоматизировать рутину без собственного набора скриптов."
        },
        {
          label: "Agency",
          title: "SEO-агентствам",
          text:
            "Разделять клиентов и доступы, контролировать расходы, масштабировать процессы и выпускать понятные отчёты."
        },
        {
          label: "In-house",
          title: "Внутренним командам",
          text:
            "Связывать SEO с контентом и разработкой, сохранять историю решений и видеть эффект изменений в одном месте."
        }
      ]
    },
    roadmap: {
      eyebrow: "Путь к запуску",
      title: "Разрабатываем открыто и выпускаем по частям",
      text:
        "Дата публичного релиза будет объявлена после прохождения ключевых проверок качества. Подписчики Telegram узнают о раннем доступе первыми.",
      currentLabel: "Сейчас",
      items: [
        {
          stage: "Этап 01",
          title: "Надёжный фундамент",
          text:
            "Аккаунты, рабочие области, проекты, права, импорт семантики, фоновые задания и безопасные интеграции.",
          status: "current"
        },
        {
          stage: "Этап 02",
          title: "Рабочий SEO-контур",
          text:
            "Позиции, SERP, история, расписания, дашборды, уведомления и первые реальные provider-интеграции.",
          status: "next"
        },
        {
          stage: "Этап 03",
          title: "Закрытый ранний доступ",
          text:
            "Пилотные команды, обратная связь, нагрузочные проверки и доработка сценариев ежедневного использования.",
          status: "next"
        },
        {
          stage: "Этап 04",
          title: "Публичный запуск",
          text:
            "Самостоятельная регистрация, тарифы, биллинг, публичный API, документация и масштабирование платформы.",
          status: "later"
        }
      ]
    },
    principles: {
      eyebrow: "Принципы продукта",
      title: "Не магия. Инженерная ясность.",
      items: [
        {
          title: "Честные состояния",
          text:
            "Ошибка, отсутствие данных и расчёт в процессе — разные состояния. Интерфейс не будет выдавать предположение за готовый результат."
        },
        {
          title: "Безопасность по умолчанию",
          text:
            "Изоляция рабочих областей, минимальные права, защищённые ключи и журналирование значимых действий закладываются до запуска."
        },
        {
          title: "Прозрачная стоимость",
          text:
            "Платная операция сначала получает оценку и подтверждение, а уже затем уходит внешнему провайдеру."
        },
        {
          title: "Данные остаются вашими",
          text:
            "Экспорт, понятные источники и история изменений не должны зависеть от того, открыт ли сейчас платный доступ к новым операциям."
        }
      ]
    },
    about: {
      eyebrow: "О проекте",
      title: "SEOньорита начинается с простой мысли: профессиональный SEO-инструмент может быть цельным",
      paragraphs: [
        "Сегодня специалист часто сам становится интеграционной платформой: переносит данные между сервисами, чинит формулы, следит за лимитами и вручную объясняет команде, откуда взялась цифра.",
        "Мы строим рабочее пространство, где данные, решения и действия остаются связанными. Без обещаний «одной кнопки в топ», зато с вниманием к воспроизводимости, безопасности и реальным процессам SEO-команд."
      ],
      quote: "Меньше времени на обслуживание инструментов. Больше — на решения, которые двигают проект."
    },
    faq: {
      eyebrow: "Вопросы",
      title: "Что важно знать до запуска",
      items: [
        {
          question: "Когда выйдет SEOньорита?",
          answer:
            "Точную дату объявим после того, как основной SEO-контур пройдёт функциональные, security- и нагрузочные проверки. В Telegram будут короткие отчёты о прогрессе и приглашения в ранний доступ."
        },
        {
          question: "Можно уже зарегистрироваться?",
          answer:
            "Публичная регистрация пока закрыта. Сейчас можно подписаться на обновления и первым получить условия закрытого тестирования."
        },
        {
          question: "Какие функции войдут в первый релиз?",
          answer:
            "Фокус первого рабочего релиза — проекты и команды, импорт семантики, позиции и история, фоновые задания, первые BYOK-интеграции, уведомления и базовая отчётность. Остальные модули будут добавляться поэтапно."
        },
        {
          question: "Будет ли версия для агентств?",
          answer:
            "Да. В целевой версии предусмотрены несколько рабочих областей и проектов, роли, клиентский доступ, лимиты, расходы, гостевые и white-label отчёты без собственных доменов."
        },
        {
          question: "Можно будет подключить свои API-ключи?",
          answer:
            "Да, BYOK — один из базовых сценариев. Ключи будут храниться в защищённом контуре, а перед внешней операцией платформа покажет источник, объём и оценку."
        },
        {
          question: "Будет ли интерфейс на английском?",
          answer:
            "Да. Продукт изначально проектируется для русского и английского языков с возможностью добавлять новые локали."
        }
      ]
    },
    waitlist: {
      eyebrow: "Не пропустите запуск",
      title: "Наблюдайте, как SEOньорита становится продуктом",
      text:
        "Подпишитесь на Telegram: там появятся демо, заметки о разработке, набор пилотных команд и дата публичного старта.",
      cta: "Подписаться на обновления",
      privacy: "Откроется Telegram. Отписаться можно в любой момент."
    },
    footer: {
      tagline: "Системное SEO начинается с ясного процесса.",
      navigationLabel: "Навигация в подвале",
      developer: "Разработчик",
      rights: "Проект находится в разработке."
    }
  },
  en: {
    brand: "SEOnorita",
    brandDescriptor: "SEO platform",
    metadata: {
      title: "SEOnorita — one platform for systematic SEO",
      description:
        "An upcoming SEO platform for semantic cores, rankings, SERP, content, analytics, automation and teamwork. Follow the development of SEOnorita.",
      keywords: [
        "SEO platform",
        "SEO workspace",
        "keyword management",
        "rank tracking",
        "competitor analysis",
        "SEO automation",
        "SEOnorita"
      ]
    },
    navigation: {
      product: "Product",
      capabilities: "Capabilities",
      roadmap: "Roadmap",
      about: "About",
      subscribe: "Join waitlist",
      languageLabel: "Русская версия"
    },
    hero: {
      status: "Platform in development · open roadmap",
      titleBefore: "SEO without chaos.",
      titleAccent: "One system",
      titleAfter: "for the entire workflow.",
      text:
        "SEOnorita will connect keywords, rankings, SERP, content, competitors, tasks and reporting — with transparent data sources, change history and automation.",
      primaryCta: "Follow the launch",
      secondaryCta: "Explore capabilities",
      note: "No spam. Only development progress, early access and the launch date.",
      audience: ["SEO specialists", "Agencies", "In-house teams"]
    },
    preview: {
      ariaLabel: "SEOnorita interface concept",
      label: "Interface concept",
      project: "Project / North",
      period: "Last 30 days",
      visibility: "Visibility",
      visibilityValue: "38.4%",
      topKeywords: "Keywords in top 10",
      topKeywordsValue: "6,284",
      tasks: "Active jobs",
      tasksValue: "12",
      chartTitle: "Search visibility",
      chartDelta: "+6.8% this period",
      taskTitle: "Workflow",
      taskItems: [
        ["Rank tracking", "done"],
        ["Clustering", "68%"],
        ["Technical audit", "queued"]
      ],
      signal: "New signal found",
      signalText: "Page /catalog moved up 9 positions"
    },
    problem: {
      eyebrow: "Why another platform",
      title: "SEO operations should not fall apart across a dozen tools",
      text:
        "When data, decisions and tasks live separately, teams lose context. SEOnorita is built around one connected chain — from a query to a measurable outcome.",
      cards: [
        {
          number: "01",
          title: "Less manual stitching",
          text:
            "Imports, spreadsheets, data providers and reports live in one project, while routine steps become repeatable workflows."
        },
        {
          number: "02",
          title: "More trust in data",
          text:
            "Every metric keeps its source, freshness and history. Changes remain traceable and results can be reproduced."
        },
        {
          number: "03",
          title: "A shared team context",
          text:
            "Roles, comments, tasks, client reports and operational costs stay next to the data they refer to."
        }
      ]
    },
    system: {
      eyebrow: "The core idea",
      title: "From query to outcome — one traceable chain",
      text:
        "Not just a collection of tools, but a working system that preserves the context of every SEO decision.",
      flow: [
        { label: "Query", detail: "intent and demand" },
        { label: "Cluster", detail: "semantic structure" },
        { label: "Page", detail: "target URL" },
        { label: "Data", detail: "SERP and metrics" },
        { label: "Change", detail: "hypothesis and action" },
        { label: "Outcome", detail: "history and impact" }
      ],
      caption:
        "The full history stays in the project: who made a decision, when and why — and what changed afterwards."
    },
    capabilities: {
      eyebrow: "Future capabilities",
      title: "Everything needed for day-to-day SEO work",
      text:
        "Modules will launch in stages. The list below describes the product direction, not a promise that every feature will ship in the first release.",
      items: [
        {
          code: "SEM",
          title: "Keywords and clusters",
          description:
            "A durable semantic core instead of fragile files and endless spreadsheet copies.",
          highlights: [
            "CSV, TSV and XLSX imports",
            "Groups, intents and deduplication",
            "Volumes, tags and history"
          ],
          tone: "coral"
        },
        {
          code: "RANK",
          title: "Rankings and SERP",
          description:
            "Scheduled search monitoring with clear freshness, provenance and history for every observation.",
          highlights: [
            "Schedules and locations",
            "URL movement and cannibalization",
            "SERP snapshots and competitors"
          ],
          tone: "violet"
        },
        {
          code: "TECH",
          title: "Technical audits",
          description:
            "Indexability, metadata, sitemaps, robots.txt, redirects and technical signals under control.",
          highlights: [
            "Critical page monitoring",
            "Priorities and issue history",
            "Post-fix verification"
          ],
          tone: "mint"
        },
        {
          code: "CONTENT",
          title: "Pages and content",
          description:
            "A direct link between queries, landing pages, content tasks and the measurable impact of changes.",
          highlights: [
            "Landing page map",
            "Content briefs and tasks",
            "Versions, approvals and impact"
          ],
          tone: "sand"
        },
        {
          code: "RIVALS",
          title: "Competitors",
          description:
            "Compare search visibility, keyword overlaps, winning pages and changes across your market.",
          highlights: [
            "Share of visibility",
            "Content gaps",
            "New players and anomalies"
          ],
          tone: "sand"
        },
        {
          code: "AUTO",
          title: "Automation",
          description:
            "Schedules, queues and workflows that continue running after the browser tab is closed.",
          highlights: [
            "Repeatable workflows",
            "Retries and error control",
            "Outcome notifications"
          ],
          tone: "coral"
        },
        {
          code: "TEAM",
          title: "Teams and clients",
          description:
            "Workspaces, roles, comments, audit history and secure client access.",
          highlights: [
            "Granular access control",
            "Live collaboration",
            "White-label reports"
          ],
          tone: "violet"
        },
        {
          code: "REPORT",
          title: "Reports and signals",
          description:
            "Dashboards, scheduled reports and meaningful change alerts without notification noise.",
          highlights: [
            "Configurable dashboards",
            "Email, Telegram and Web Push",
            "Exports and guest links"
          ],
          tone: "mint"
        },
        {
          code: "API",
          title: "Integrations and API",
          description:
            "Bring your own provider keys, retain transparent data routing and automate through a public API.",
          highlights: [
            "BYOK with server-side secrets",
            "Webhooks and API tokens",
            "Source provenance"
          ],
          tone: "mint"
        },
        {
          code: "COST",
          title: "Limits and cost",
          description:
            "Know the volume and price before a paid operation starts — never after the bill arrives.",
          highlights: [
            "Estimate before approval",
            "Project budgets",
            "Usage history"
          ],
          tone: "coral"
        }
      ]
    },
    integrations: {
      eyebrow: "Ecosystem",
      title: "Connect familiar sources. Stay in control.",
      text:
        "SEOnorita is designed as an open system with BYOK credentials, a public API and transparent provenance for every dataset.",
      plannedLabel: "Planned integrations",
      items: [
        "Keys.so",
        "Arsenkin Tools",
        "XMLStock",
        "Google Search Console",
        "Google Analytics 4",
        "Yandex Webmaster",
        "Telegram",
        "Public API"
      ],
      byokTitle: "Your keys, your limits",
      byokText:
        "BYOK will let you connect your own provider accounts. The platform will show routing, estimated volume and cost before the operation begins."
    },
    audiences: {
      eyebrow: "Built for",
      title: "One product, different workflows",
      items: [
        {
          label: "Solo",
          title: "Independent specialists",
          text:
            "Collect data faster, keep projects organized and automate routine work without maintaining a private collection of scripts."
        },
        {
          label: "Agency",
          title: "SEO agencies",
          text:
            "Separate clients and permissions, control costs, scale processes and deliver reports people can understand."
        },
        {
          label: "In-house",
          title: "Internal teams",
          text:
            "Connect SEO with content and engineering, preserve decision history and see the impact of changes in one place."
        }
      ]
    },
    roadmap: {
      eyebrow: "Path to launch",
      title: "Building in the open, shipping in stages",
      text:
        "The public release date will be announced after the core quality gates are complete. Telegram subscribers will hear about early access first.",
      currentLabel: "Now",
      items: [
        {
          stage: "Stage 01",
          title: "Reliable foundation",
          text:
            "Accounts, workspaces, projects, permissions, semantic imports, background jobs and secure integrations.",
          status: "current"
        },
        {
          stage: "Stage 02",
          title: "Working SEO loop",
          text:
            "Rankings, SERP, history, schedules, dashboards, notifications and the first live provider integrations.",
          status: "next"
        },
        {
          stage: "Stage 03",
          title: "Closed early access",
          text:
            "Pilot teams, structured feedback, load testing and refinement of everyday workflows.",
          status: "next"
        },
        {
          stage: "Stage 04",
          title: "Public launch",
          text:
            "Self-service signup, plans, billing, public API, documentation and platform scaling.",
          status: "later"
        }
      ]
    },
    principles: {
      eyebrow: "Product principles",
      title: "No magic. Engineering clarity.",
      items: [
        {
          title: "Honest states",
          text:
            "An error, missing data and a calculation in progress are different states. The UI will never present a guess as a finished result."
        },
        {
          title: "Secure by default",
          text:
            "Workspace isolation, least privilege, protected credentials and audit trails are being built before launch."
        },
        {
          title: "Transparent cost",
          text:
            "A paid operation receives an estimate and approval before it reaches an external provider."
        },
        {
          title: "Your data remains yours",
          text:
            "Exports, clear provenance and history should remain available even when new paid operations are limited."
        }
      ]
    },
    about: {
      eyebrow: "About the project",
      title: "SEOnorita starts with a simple idea: a professional SEO tool can feel coherent",
      paragraphs: [
        "Today, an SEO specialist often becomes the integration platform: moving data between services, fixing formulas, watching limits and explaining where every number came from.",
        "We are building a workspace where data, decisions and actions stay connected. No promises of a one-click path to the top — just careful work on reproducibility, security and the real workflows of SEO teams."
      ],
      quote: "Less time maintaining tools. More time making decisions that move the project forward."
    },
    faq: {
      eyebrow: "Questions",
      title: "What to know before launch",
      items: [
        {
          question: "When will SEOnorita launch?",
          answer:
            "We will announce the date once the core SEO loop passes functional, security and load testing. Telegram will have concise progress updates and early-access invitations."
        },
        {
          question: "Can I sign up now?",
          answer:
            "Public registration is not open yet. You can follow the updates now and be among the first invited to the closed beta."
        },
        {
          question: "What will be in the first release?",
          answer:
            "The first working release focuses on projects and teams, semantic imports, rankings and history, background jobs, initial BYOK integrations, notifications and essential reporting. Other modules will follow in stages."
        },
        {
          question: "Will there be an agency edition?",
          answer:
            "Yes. The target product includes multiple workspaces and projects, roles, client access, limits, cost control, guest and white-label reports without custom domains."
        },
        {
          question: "Can I use my own API credentials?",
          answer:
            "Yes, BYOK is a core scenario. Credentials will stay in a protected server-side vault, while every external operation shows its source, volume and estimate."
        },
        {
          question: "Will the interface support Russian?",
          answer:
            "Yes. The product is designed for both English and Russian from day one, with room for additional locales."
        }
      ]
    },
    waitlist: {
      eyebrow: "Do not miss the launch",
      title: "Watch SEOnorita become a real product",
      text:
        "Join the Telegram channel for demos, development notes, pilot recruitment and the public launch date.",
      cta: "Follow the updates",
      privacy: "Opens Telegram. You can unsubscribe at any time."
    },
    footer: {
      tagline: "Systematic SEO starts with a clear process.",
      navigationLabel: "Footer navigation",
      developer: "Developer",
      rights: "This product is currently in development."
    }
  }
};
