import type { Locale } from "./locales";

export interface MarketingNavItem {
  readonly href: string;
  readonly label: string;
}

export interface MarketingCapability {
  readonly description: string;
  readonly marker: string;
  readonly points: readonly string[];
  readonly title: string;
}

export interface MarketingStep {
  readonly description: string;
  readonly title: string;
}

export interface MarketingAudience {
  readonly description: string;
  readonly title: string;
}

export interface MarketingIntegration {
  readonly description: string;
  readonly label: string;
  readonly title: string;
}

export interface MarketingFaq {
  readonly answer: string;
  readonly question: string;
}

export interface MarketingPage {
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly navigation: readonly MarketingNavItem[];
  readonly loginLabel: string;
  readonly localeLabel: string;
  readonly eyebrow: string;
  readonly heroTitle: string;
  readonly heroText: string;
  readonly primaryCtaLabel: string;
  readonly secondaryCtaLabel: string;
  readonly proofItems: readonly string[];
  readonly preview: {
    readonly title: string;
    readonly searchVolume: string;
    readonly searchVolumeLabel: string;
    readonly topTen: string;
    readonly topTenLabel: string;
    readonly jobs: string;
    readonly jobsLabel: string;
    readonly chartLabel: string;
    readonly tableRows: readonly [string, string, string][];
  };
  readonly valueItems: readonly [string, string][];
  readonly capabilitiesEyebrow: string;
  readonly capabilitiesTitle: string;
  readonly capabilitiesText: string;
  readonly capabilities: readonly MarketingCapability[];
  readonly workflowEyebrow: string;
  readonly workflowTitle: string;
  readonly workflowText: string;
  readonly workflow: readonly MarketingStep[];
  readonly workspaceEyebrow: string;
  readonly workspaceTitle: string;
  readonly workspaceText: string;
  readonly workspacePoints: readonly [string, string][];
  readonly integrationsEyebrow: string;
  readonly integrationsTitle: string;
  readonly integrationsText: string;
  readonly integrations: readonly MarketingIntegration[];
  readonly comparisonEyebrow: string;
  readonly comparisonTitle: string;
  readonly comparisonText: string;
  readonly comparisonColumns: readonly [string, string, string];
  readonly comparisonRows: readonly [string, string, string][];
  readonly audienceEyebrow: string;
  readonly audienceTitle: string;
  readonly audiences: readonly MarketingAudience[];
  readonly faqEyebrow: string;
  readonly faqTitle: string;
  readonly faqText: string;
  readonly faqs: readonly MarketingFaq[];
  readonly finalEyebrow: string;
  readonly finalTitle: string;
  readonly finalText: string;
  readonly finalCtaLabel: string;
  readonly footerText: string;
  readonly footerLinks: readonly MarketingNavItem[];
}

const marketingPages: Record<Locale, MarketingPage> = {
  ru: {
    title: "SEO-платформа для семантики и позиций — SEOньорита",
    description:
      "SEOньорита — SEO-платформа для сбора семантического ядра, проверки частотности и мониторинга позиций сайта в Яндексе и Google.",
    keywords: [
      "SEO-платформа",
      "SEO-сервис",
      "сервис для SEO-специалиста",
      "сбор семантического ядра",
      "проверка частотности запросов",
      "мониторинг позиций сайта",
      "проверка позиций Яндекс и Google",
      "управление SEO-проектами",
      "автоматизация SEO",
      "XMLStock",
      "Арсенкин"
    ],
    navigation: [
      { href: "#capabilities", label: "Возможности" },
      { href: "/ru/pricing", label: "Тарифы" },
      { href: "#workflow", label: "Как работает" },
      { href: "#integrations", label: "Интеграции" },
      { href: "#for-whom", label: "Для кого" },
      { href: "#faq", label: "FAQ" }
    ],
    loginLabel: "Войти",
    localeLabel: "EN",
    eyebrow: "Единый онлайн-сервис для SEO-специалиста и агентства",
    heroTitle: "SEO-платформа для семантики и проверки позиций сайта",
    heroText:
      "Собирайте запросы и частотность, ведите семантическое ядро, проверяйте позиции в Яндексе и Google и храните данные проекта в одном рабочем пространстве — без переноса между Excel, Wordstat и разными SEO-сервисами.",
    primaryCtaLabel: "Создать SEO-проект",
    secondaryCtaLabel: "Посмотреть возможности",
    proofItems: [
      "Позиции в Яндексе и Google",
      "Частотность через XMLStock и Арсенкин",
      "Импорт CSV и XLSX"
    ],
    preview: {
      title: "Семантическое ядро",
      searchVolume: "12 846",
      searchVolumeLabel: "Запросов",
      topTen: "3 241",
      topTenLabel: "В топ-10",
      jobs: "3",
      jobsLabel: "Операции",
      chartLabel: "Динамика средней позиции",
      tableRows: [
        ["seo сервис", "5", "8 960"],
        ["сервис для seo специалиста", "8", "3 210"],
        ["проверка позиций сайта", "12", "2 640"]
      ]
    },
    valueItems: [
      ["Один SEO-проект", "Запросы, страницы, частотность, позиции и история связаны между собой."],
      ["Проверяемые данные", "У каждого замера видны поисковая система, регион, устройство, провайдер и время."],
      ["Фоновые операции", "Массовые сборы выполняются асинхронно, а прогресс и результат сохраняются в проекте."]
    ],
    capabilitiesEyebrow: "SEO-инструменты в одном рабочем пространстве",
    capabilitiesTitle: "От семантики до результата в поиске",
    capabilitiesText:
      "SEOньорита объединяет инструменты SEO-специалиста в последовательный процесс. Это не набор несвязанных форм: данные остаются внутри проекта и помогают принимать следующее решение.",
    capabilities: [
      {
        marker: "01",
        title: "Сбор и ведение семантического ядра",
        description:
          "Добавляйте запросы вручную или импортируйте готовую семантику. Структурируйте ядро без отдельных таблиц и потери исходных данных.",
        points: ["CSV/XLSX и проекты Key Collector", "Папки, мультигруппы и минус-слова", "URL, заметки и сохранённые представления"]
      },
      {
        marker: "02",
        title: "Wordstat и проверка частотности запросов",
        description:
          "Запускайте массовый сбор частотности по нужному региону и сохраняйте значения рядом с ключевыми словами.",
        points: ["Базовая, фразовая и точная частотность", "Россия, Москва, Санкт-Петербург и другие регионы", "XMLStock или Арсенкин с вашим API-ключом"]
      },
      {
        marker: "03",
        title: "Мониторинг позиций сайта",
        description:
          "Проверяйте позиции по ключевым словам в Яндексе и Google, сравнивайте замеры и находите запросы, по которым страница перестала ранжироваться.",
        points: ["Яндекс Live, Яндекс XML и Google", "Топ-30, топ-50 и топ-100", "История, динамика URL и топ конкурентов"]
      },
      {
        marker: "04",
        title: "Карта страниц и обход сайта",
        description:
          "Обходите сайт по sitemap и внутренним ссылкам, проверяйте HTTP-статусы и собирайте данные страниц в единой карте.",
        points: ["Цепочки редиректов и коды ответа", "Title, Description, H1 и canonical", "До 5 000 страниц за один обход"]
      },
      {
        marker: "05",
        title: "Управление SEO-проектами",
        description:
          "Ведите несколько сайтов, разделяйте доступы и храните контекст SEO-работ там же, где находятся данные.",
        points: ["Рабочие области, проекты и роли", "Markdown-заметки и история операций", "Передача проекта без передачи API-ключей"]
      },
      {
        marker: "06",
        title: "Автоматизация SEO без чёрного ящика",
        description:
          "Долгие сборы идут в фоне, обновляют таблицу по мере готовности и оставляют воспроизводимый журнал результата.",
        points: ["Параллельные очереди и живой прогресс", "Уведомления о завершении и ошибках", "Публичный API с документацией"]
      }
    ],
    workflowEyebrow: "Понятный рабочий цикл",
    workflowTitle: "Как собрать данные и начать продвижение сайта",
    workflowText:
      "Четыре шага вместо ручного переноса ключей между программой для семантики, Wordstat, сервисом проверки позиций и отчётной таблицей.",
    workflow: [
      { title: "Создайте SEO-проект", description: "Укажите сайт и держите семантику, страницы, подключения и операции в изолированном проекте." },
      { title: "Загрузите запросы", description: "Импортируйте CSV/XLSX, обновите метрики существующих ключей или соберите структуру вручную." },
      { title: "Проверьте спрос", description: "Соберите базовую, фразовую и точную частотность Wordstat для выбранного региона." },
      { title: "Отслеживайте позиции", description: "Запустите съём в Яндексе или Google и изучайте динамику, найденный URL и топ выдачи." }
    ],
    workspaceEyebrow: "Связанные данные вместо разрозненных таблиц",
    workspaceTitle: "Система управления SEO, в которой сохраняется контекст",
    workspaceText:
      "Ключевой объект SEOньориты — проект, а не отдельный запрос. Поэтому семантика сайта, частотность ключевых слов, целевые страницы, история позиций и фоновые операции не расходятся по разным файлам.",
    workspacePoints: [
      ["Запрос → группа → URL", "Сразу видно, к какой странице относится ключ и совпал ли найденный URL с целевым."],
      ["Замер → источник → история", "Позиция хранится вместе с датой, поисковиком, типом выдачи, регионом, устройством и провайдером."],
      ["Операция → прогресс → результат", "Массовая проверка не блокирует интерфейс, а завершённый результат остаётся доступным в журнале."]
    ],
    integrationsEyebrow: "Интеграции без скрытой подмены источника",
    integrationsTitle: "Арсенкин, XMLStock и API платформы",
    integrationsText:
      "Подключите собственные ключи внешних сервисов. Перед каждым запуском видно, какой провайдер будет использован, какой объём отправится на обработку и где появится результат.",
    integrations: [
      { label: "XML", title: "XMLStock", description: "Частотность Wordstat, Яндекс Live/XML и Google. Подходит для массовых замеров с прозрачным расходом собственного баланса." },
      { label: "AT", title: "Арсенкин Tools", description: "Подключение API Арсенкина для доступных сценариев частотности и проверки позиций через ваш аккаунт провайдера." },
      { label: "API", title: "SEO API", description: "Versioned API, идемпотентные команды и журнал фоновых задач для интеграции SEO-процессов с вашими системами." }
    ],
    comparisonEyebrow: "Честное сравнение",
    comparisonTitle: "Онлайн-альтернатива таблицам и отдельным SEO-программам",
    comparisonText:
      "Если вы ищете онлайн-аналог Key Collector или альтернативу Topvisor, важно сравнивать не названия функций, а рабочий процесс. SEOньорита не копирует каждый desktop-сценарий: она переносит ежедневное ведение SEO-проектов в общее онлайн-пространство с ролями, историей и фоновыми операциями.",
    comparisonColumns: ["Рабочий сценарий", "Таблицы + разные сервисы", "SEOньорита"],
    comparisonRows: [
      ["Семантическое ядро", "Файлы, ручные версии и перенос колонок", "Единая таблица, группы, импорт и история"],
      ["Wordstat и позиции", "Разные кабинеты и ручное сопоставление", "Запуск из проекта и сохранение к ключу"],
      ["Источник данных", "Часто остаётся только итоговая цифра", "Провайдер, регион, устройство и дата замера"],
      ["Командная работа", "Копии файлов и общий пароль", "Рабочие области, роли и безопасные доступы"],
      ["Долгие операции", "Открытая вкладка и ручная проверка", "Фоновая очередь, прогресс и уведомления"]
    ],
    audienceEyebrow: "Для самостоятельной и командной работы",
    audienceTitle: "Кому подходит SEO-платформа",
    audiences: [
      { title: "SEO-специалистам", description: "Собирать данные, фильтровать большое ядро, проверять позиции и хранить историю без десятка вкладок." },
      { title: "SEO-агентствам", description: "Разделять проекты клиентов, роли команды, подключения провайдеров и расходы внешних операций." },
      { title: "In-house командам", description: "Связать семантику, страницы и результаты продвижения в одном пространстве с контролем доступа." },
      { title: "Владельцам сайтов", description: "Понимать, какие запросы отслеживаются, как меняются позиции и что происходит с проектом." }
    ],
    faqEyebrow: "Ответы без маркетингового тумана",
    faqTitle: "Частые вопросы о семантике, Wordstat и позициях",
    faqText:
      "Коротко о том, как работает SEO-сервис, какие данные он собирает и чем отличается от привычной связки программ и таблиц.",
    faqs: [
      {
        question: "Что такое SEOньорита и какие SEO-инструменты входят в платформу?",
        answer:
          "SEOньорита — онлайн-система для ведения SEO-проектов. Сейчас в ней доступны семантическое ядро, импорт запросов, сбор частотности, проверка позиций Яндекса и Google, история замеров, карта страниц, обход сайта, заметки, операции и подключения XMLStock и Арсенкин."
      },
      {
        question: "Можно ли собрать и вести семантическое ядро онлайн?",
        answer:
          "Да. Запросы можно добавить через форму или импортировать из CSV, TSV и XLSX, разложить по папкам и группам, дополнить URL и заметками. Импорт умеет обновлять частотность, позиции и другие параметры уже существующих ключей, не создавая новые без вашего разрешения. Прямые профили Key Collector и Топвизора временно отключены."
      },
      {
        question: "Как работает проверка частотности запросов Wordstat?",
        answer:
          "Вы выбираете регион, провайдера и типы частотности. Платформа ставит массовый сбор в фоновую очередь и сохраняет базовую, фразовую и точную частотность рядом с каждым запросом. Для внешнего сбора используется подключённый ключ XMLStock или Арсенкин."
      },
      {
        question: "Как выполняется проверка позиций сайта в Яндексе и Google?",
        answer:
          "Перед запуском выбираются поисковая система, тип выдачи, регион, устройство, глубина и подключение провайдера. Съём выполняется асинхронно, а найденная позиция, URL, топ конкурентов и параметры замера сохраняются в истории ключевого слова."
      },
      {
        question: "Можно ли проверять позиции по регионам и на мобильных устройствах?",
        answer:
          "Да. Контекст замера включает регион и устройство. Разные контексты сохраняются отдельно, поэтому позиции Москвы и другого региона, десктопной и мобильной выдачи не смешиваются в одну цифру."
      },
      {
        question: "Это полный аналог Key Collector или Topvisor?",
        answer:
          "Нет, и мы не скрываем разницу. SEOньорита — веб-платформа для совместного ведения семантики, частотности, позиций и проектных данных. Она может заменить часть ежедневных сценариев Key Collector, таблиц и сервисов мониторинга, но не заявляет готовыми функции, которых в продукте пока нет."
      },
      {
        question: "Подходит ли сервис для SEO-агентства и нескольких проектов?",
        answer:
          "Да. Рабочая область объединяет пользователей и проекты, а роли ограничивают доступ. Подключения внешних провайдеров принадлежат рабочей области; при передаче проекта чужие API-ключи не переходят новому владельцу."
      },
      {
        question: "Безопасно ли подключать API-ключи XMLStock и Арсенкин?",
        answer:
          "Ключи хранятся в защищённом хранилище и не попадают в URL, браузерные ответы, журнал операций или очередь задач. Платформа использует только выбранное подключение и не подменяет его системным ключом без явного правила."
      },
      {
        question: "Есть ли API для проверки позиций и других SEO-операций?",
        answer:
          "Да. Публичная документация описывает versioned API, авторизацию, идемпотентность, ошибки и фоновые операции. API использует те же контракты и обработчики, что и интерфейс проекта."
      }
    ],
    finalEyebrow: "Соберите SEO-процесс в одном месте",
    finalTitle: "Создайте проект и перестаньте переносить данные вручную",
    finalText:
      "Загрузите семантику, подключите свой API-ключ, соберите частотность и запустите мониторинг позиций сайта в едином рабочем пространстве.",
    finalCtaLabel: "Создать SEO-проект",
    footerText: "SEOньорита — единое рабочее пространство для семантики, позиций и SEO-работ.",
    footerLinks: [
      { href: "/ru/pricing", label: "Тарифы" },
      { href: "/ru/help", label: "Помощь" },
      { href: "/ru/terms", label: "Условия" },
      { href: "/ru/privacy", label: "Конфиденциальность" },
      { href: "https://t.me/ker4ik13", label: "Поддержка" },
      { href: "/tools", label: "Инструменты" },
      { href: "/docs/api", label: "API" },
      { href: "#faq", label: "FAQ" }
    ]
  },
  en: {
    title: "SEO platform for keywords and rank tracking — SEOnorita",
    description:
      "SEOnorita brings keyword management, search volume, Yandex and Google rank tracking, projects and provider integrations into one SEO workspace.",
    keywords: [
      "SEO platform",
      "SEO tools",
      "keyword management",
      "search volume checker",
      "rank tracker",
      "Yandex rank tracking",
      "Google rank tracking",
      "SEO project management"
    ],
    navigation: [
      { href: "/en/pricing", label: "Pricing" },
      { href: "#capabilities", label: "Features" },
      { href: "#workflow", label: "Workflow" },
      { href: "#integrations", label: "Integrations" },
      { href: "#for-whom", label: "For teams" },
      { href: "#faq", label: "FAQ" }
    ],
    loginLabel: "Sign in",
    localeLabel: "RU",
    eyebrow: "One online workspace for SEO specialists and agencies",
    heroTitle: "An SEO platform for keyword research and rank tracking",
    heroText:
      "Manage keywords and search volume, track rankings in Yandex and Google, and keep every project signal in one workspace instead of moving data between spreadsheets and separate SEO tools.",
    primaryCtaLabel: "Create an SEO project",
    secondaryCtaLabel: "Explore features",
    proofItems: ["Yandex and Google rankings", "XMLStock and Arsenkin integrations", "CSV and XLSX imports"],
    preview: {
      title: "Keyword workspace",
      searchVolume: "12,846",
      searchVolumeLabel: "Keywords",
      topTen: "3,241",
      topTenLabel: "In top 10",
      jobs: "3",
      jobsLabel: "Operations",
      chartLabel: "Average position trend",
      tableRows: [
        ["seo platform", "5", "8,960"],
        ["seo tools for agencies", "8", "3,210"],
        ["website rank tracker", "12", "2,640"]
      ]
    },
    valueItems: [
      ["One SEO project", "Keywords, pages, volume, rankings and history stay connected."],
      ["Traceable data", "Every measurement retains its engine, region, device, provider and time."],
      ["Background operations", "Large collections run asynchronously while progress and results stay in the project."]
    ],
    capabilitiesEyebrow: "SEO tools in one workspace",
    capabilitiesTitle: "From keywords to search performance",
    capabilitiesText:
      "SEOnorita connects the everyday tools of an SEO specialist into a traceable workflow. Data remains part of the project and informs the next decision.",
    capabilities: [
      { marker: "01", title: "Keyword workspace", description: "Add keywords manually or import an existing semantic core without losing its structure.", points: ["CSV, XLSX and Key Collector projects", "Folders, multi-group views and negative keywords", "Target URLs, notes and saved views"] },
      { marker: "02", title: "Wordstat search volume", description: "Collect search volume in bulk for the required region and keep the values beside each keyword.", points: ["Broad, phrase and exact volume", "Separate regional measurements", "XMLStock or Arsenkin with your API key"] },
      { marker: "03", title: "Yandex and Google rank tracking", description: "Check keyword rankings, compare measurements and identify keywords that stopped ranking.", points: ["Yandex Live, Yandex XML and Google", "Top 30, top 50 and top 100", "History, ranking URL and top competitors"] },
      { marker: "04", title: "Page map and site crawl", description: "Crawl the sitemap and internal links, inspect HTTP responses and build a shared page map.", points: ["Status codes and redirect chains", "Title, Description, H1 and canonical", "Up to 5,000 pages per crawl"] },
      { marker: "05", title: "SEO project management", description: "Manage multiple sites, permissions and project knowledge beside the underlying data.", points: ["Workspaces, projects and roles", "Markdown notes and operation history", "Safe project transfers without API keys"] },
      { marker: "06", title: "Transparent automation", description: "Long-running collections update the table as data arrives and leave a reproducible operation record.", points: ["Parallel queues and live progress", "Completion and error notifications", "Documented public API"] }
    ],
    workflowEyebrow: "A straightforward workflow",
    workflowTitle: "Go from a website to measurable search data",
    workflowText: "Four steps replace manual transfers between keyword software, Wordstat, rank trackers and reporting spreadsheets.",
    workflow: [
      { title: "Create an SEO project", description: "Keep the website, keywords, pages, integrations and operations in one isolated project." },
      { title: "Load your keywords", description: "Import CSV/XLSX, update existing metrics or build the structure manually." },
      { title: "Measure demand", description: "Collect broad, phrase and exact Wordstat volume for the selected region." },
      { title: "Track rankings", description: "Run a Yandex or Google check and inspect trends, ranking URLs and the top results." }
    ],
    workspaceEyebrow: "Connected data instead of disconnected sheets",
    workspaceTitle: "SEO project management that preserves context",
    workspaceText:
      "The project—not an isolated keyword—is the center of SEOnorita. Keywords, search volume, target pages, ranking history and background operations remain linked.",
    workspacePoints: [
      ["Keyword → group → URL", "See which page owns a keyword and whether the ranking URL matches its target."],
      ["Measurement → source → history", "Keep the date, engine, search mode, region, device and provider with every ranking."],
      ["Operation → progress → result", "Bulk checks do not block the UI, and completed results remain in the operation log."]
    ],
    integrationsEyebrow: "Integrations without hidden source switching",
    integrationsTitle: "Arsenkin, XMLStock and the platform API",
    integrationsText:
      "Connect your own provider credentials. Before a run, the product shows which source will be used, the expected scope and where the result will be stored.",
    integrations: [
      { label: "XML", title: "XMLStock", description: "Wordstat volume, Yandex Live/XML and Google data for bulk measurements using your provider balance." },
      { label: "AT", title: "Arsenkin Tools", description: "Use your Arsenkin account for supported search-volume and rank-tracking workflows." },
      { label: "API", title: "SEO API", description: "Versioned contracts, idempotent commands and durable background jobs for your own integrations." }
    ],
    comparisonEyebrow: "An honest comparison",
    comparisonTitle: "An online alternative to spreadsheets and separate SEO apps",
    comparisonText:
      "SEOnorita does not pretend to clone every desktop workflow. It moves daily keyword, volume, ranking and project work into a shared online workspace with roles, history and background operations.",
    comparisonColumns: ["Workflow", "Spreadsheets + separate tools", "SEOnorita"],
    comparisonRows: [
      ["Keyword workspace", "Files, manual versions and copied columns", "One table, groups, imports and history"],
      ["Volume and rankings", "Different accounts and manual matching", "Runs and results attached to the project"],
      ["Data source", "Often reduced to a final number", "Provider, region, device and measurement date"],
      ["Collaboration", "File copies and shared passwords", "Workspaces, roles and scoped access"],
      ["Long operations", "An open tab and manual checks", "Background queue, progress and notifications"]
    ],
    audienceEyebrow: "For independent and collaborative work",
    audienceTitle: "Who the SEO platform is for",
    audiences: [
      { title: "SEO specialists", description: "Collect data, filter large keyword sets and preserve ranking history without juggling tabs." },
      { title: "SEO agencies", description: "Separate client projects, team roles, provider connections and external operation costs." },
      { title: "In-house teams", description: "Connect keywords, pages and search outcomes in one permission-aware workspace." },
      { title: "Website owners", description: "Understand which keywords are tracked, how rankings change and what is happening in the project." }
    ],
    faqEyebrow: "Clear answers",
    faqTitle: "Frequently asked questions",
    faqText: "How the platform handles keywords, Wordstat volume, rank tracking, integrations and project data.",
    faqs: [
      { question: "What is SEOnorita?", answer: "SEOnorita is an online SEO project workspace for keyword management, imports, search volume, Yandex and Google rankings, ranking history, page maps, site crawls, notes, operations and provider integrations." },
      { question: "Can I manage an existing keyword set?", answer: "Yes. Add keywords with the editor or import CSV, TSV and XLSX files. Imports can update metrics on existing keywords without creating missing phrases unless you explicitly allow it. Direct Key Collector and Topvisor profiles are temporarily disabled." },
      { question: "How does Wordstat volume collection work?", answer: "Choose a region, provider and volume types. The platform queues the bulk operation and stores broad, phrase and exact values beside every keyword using your XMLStock or Arsenkin connection." },
      { question: "How are Yandex and Google rankings checked?", answer: "Choose the engine, search mode, region, device, depth and provider route. The asynchronous run stores the ranking, URL, top competitors and full measurement context in keyword history." },
      { question: "Can regions and devices be tracked separately?", answer: "Yes. Region and device belong to a measurement context, so desktop and mobile rankings or different locations are not merged into one ambiguous value." },
      { question: "Is this a complete Key Collector or Topvisor clone?", answer: "No. SEOnorita focuses on collaborative online keyword, volume, ranking and project workflows. It can replace part of a spreadsheet and desktop workflow while clearly marking capabilities that are not available yet." },
      { question: "Does it work for agencies?", answer: "Yes. Workspaces group users and projects, while roles scope access. Provider credentials belong to a workspace and are not transferred with a project to another owner." },
      { question: "Are provider API keys protected?", answer: "Keys stay in a protected vault and are excluded from URLs, browser responses, operation logs and queue payloads. A run uses the explicitly selected route." },
      { question: "Is there an API?", answer: "Yes. Public documentation covers the versioned API, authentication, idempotency, errors and background operations used by the same production workflows as the project UI." }
    ],
    finalEyebrow: "Bring the SEO workflow together",
    finalTitle: "Create a project and stop copying data by hand",
    finalText: "Load your keywords, connect a provider, collect search volume and start rank tracking in one shared workspace.",
    finalCtaLabel: "Create an SEO project",
    footerText: "SEOnorita is one workspace for keywords, rankings and SEO operations.",
    footerLinks: [
      { href: "/en/pricing", label: "Pricing" },
      { href: "/en/help", label: "Help" },
      { href: "/en/terms", label: "Terms" },
      { href: "/en/privacy", label: "Privacy" },
      { href: "https://t.me/ker4ik13", label: "Support" },
      { href: "/tools", label: "Tools" },
      { href: "/docs/api", label: "API" },
      { href: "#faq", label: "FAQ" }
    ]
  }
};

export function getMarketingPage(locale: Locale): MarketingPage {
  return marketingPages[locale];
}
