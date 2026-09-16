import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicDocumentShell } from "../../../components/public-document-shell";
import { isLocale } from "../../../lib/locales";
import "../documents.css";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const en = locale === "en";
  return {
    title: en
      ? "Keyword and ranking imports · SEOnorita"
      : "Импорт семантики и позиций · SEOньорита",
    description: en
      ? "Supported file formats, column mapping, duplicate handling and ranking history examples."
      : "Поддерживаемые форматы, сопоставление колонок, обработка дублей и примеры истории позиций.",
    alternates: {
      canonical: `/${locale}/imports`,
      languages: { ru: "/ru/imports", en: "/en/imports" }
    }
  };
}

export default async function ImportDocumentationPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const en = locale === "en";

  return (
    <PublicDocumentShell locale={locale} slug="imports">
      <main className="public-document-main public-import-main">
        <header className="public-document-title">
          <p>{en ? "SEOnorita · documentation" : "SEOньорита · документация"}</p>
          <h1>{en ? "Keyword and ranking imports" : "Импорт семантики и позиций"}</h1>
          <p>
            {en
              ? "Upload a file, verify detected columns and conflicts, then explicitly publish the reviewed result."
              : "Загрузите файл, проверьте распознанные колонки и конфликты, затем явно подтвердите публикацию результата."}
          </p>
        </header>

        <div className="public-document-layout">
          <aside className="public-document-toc">
            <strong>{en ? "On this page" : "На этой странице"}</strong>
            <nav>
              <a href="#available">{en ? "Available formats" : "Доступные форматы"}</a>
              <a href="#steps">{en ? "Import steps" : "Порядок импорта"}</a>
              <a href="#key-collector">Key Collector</a>
              <a href="#columns">{en ? "Columns" : "Колонки"}</a>
              <a href="#duplicates">{en ? "Existing keywords" : "Существующие запросы"}</a>
              <a href="#rankings">{en ? "Ranking history" : "История позиций"}</a>
              <a href="#examples">{en ? "Example files" : "Примеры файлов"}</a>
            </nav>
          </aside>

          <article className="public-document-copy public-import-copy">
            <aside className="public-import-notice" role="note">
              <strong>{en ? "Topvisor is coming later" : "Топвизор появится позже"}</strong>
              <p>
                {en
                  ? "Native Key Collector projects are available now. The dedicated Topvisor profile remains disabled while compatibility is finalized."
                  : "Нативные проекты Key Collector уже доступны. Отдельный профиль Топвизора пока отключён на время проверки совместимости."}
              </p>
            </aside>

            <section id="available">
              <h2>{en ? "Available formats" : "Доступные форматы"}</h2>
              <ul>
                <li>{en ? "Key Collector: one native, unencrypted .kc4 project up to 1 GB." : "Key Collector: нативный незашифрованный проект .kc4 до 1 ГБ."}</li>
                <li>{en ? "File: CSV, TSV or XLSX with a header row." : "Файл: CSV, TSV или XLSX с заголовками в первой строке."}</li>
                <li>{en ? "Rankings: a wide date table or one observation per row." : "Позиции: широкая таблица по датам или отдельная строка для каждого замера."}</li>
              </ul>
              <p>
                {en
                  ? "To add a plain list without a file, use Add in the Semantics toolbar. It has its own duplicate review and is separate from file imports."
                  : "Чтобы добавить обычный список без файла, используйте кнопку «Добавить» в панели Семантики. Там действует отдельная проверка дублей; это не файловый импорт."}
              </p>
            </section>

            <section id="steps">
              <h2>{en ? "Import steps" : "Порядок импорта"}</h2>
              <ol>
                <li>{en ? "Choose Key Collector, File or Rankings and upload a supported file." : "Выберите Key Collector, «Файл» или «Позиции» и загрузите поддерживаемый файл."}</li>
                <li>{en ? "Wait for malware inspection and format detection." : "Дождитесь антивирусной проверки и распознавания формата."}</li>
                <li>{en ? "Review every detected column and change incorrect mappings." : "Проверьте назначение каждой колонки и исправьте неверные совпадения."}</li>
                <li>{en ? "Choose how to handle new and existing keywords." : "Выберите правила для новых и уже существующих запросов."}</li>
                <li>{en ? "Run validation, review warnings, then publish." : "Запустите проверку, изучите предупреждения и только затем подтвердите импорт."}</li>
              </ol>
            </section>

            <section id="key-collector">
              <h2>Key Collector</h2>
              <p>
                {en
                  ? "Upload the original .kc4 project. The importer reads its SQLite database in read-only mode and preserves the active folder tree, empty folders, colors, keyword notes, populated metrics, current and historical Yandex and Google rankings, relevant URLs and saved SERP rows when present. Trash and removed folders are skipped."
                  : "Загрузите исходный проект .kc4. Импорт читает его SQLite-базу только для чтения и сохраняет активное дерево, пустые папки, цвета, заметки запросов, заполненные показатели, текущую и историческую выдачу Яндекса и Google, релевантные URL и сохранённые строки SERP, если они есть. Корзина и удалённые папки пропускаются."}
              </p>
              <p>
                {en
                  ? "Missing optional tables or damaged optional SERP text do not stop the remaining project data. Review detected columns and duplicate handling before publishing."
                  : "Отсутствие необязательной таблицы или повреждённый необязательный текст SERP не останавливают перенос остальных данных. Перед публикацией проверьте найденные колонки и правила обработки дублей."}
              </p>
            </section>

            <section id="columns">
              <h2>{en ? "Columns and values" : "Колонки и значения"}</h2>
              <p>
                {en
                  ? "Only the keyword column is required. Supported fields include language, priority, favorite, tracking, note, intent, group path, target URL, tags, search volume, rankings and custom columns."
                  : "Обязательна только колонка запроса. Можно импортировать язык, приоритет, избранное, отслеживание, заметку, интент, путь группы, целевой URL, теги, частотности, позиции и пользовательские колонки."}
              </p>
              <p>
                {en
                  ? "Unknown columns can be kept as custom fields or explicitly ignored. CSV and TSV support UTF-8 and Windows-1251. XLSX must contain one unencrypted worksheet."
                  : "Неизвестную колонку можно сохранить как пользовательскую или явно не импортировать. CSV и TSV поддерживают UTF-8 и Windows-1251. XLSX должен содержать один незашифрованный лист."}
              </p>
            </section>

            <section id="duplicates">
              <h2>{en ? "Existing keywords" : "Существующие запросы"}</h2>
              <ul>
                <li>{en ? "Skip existing: keep the project row unchanged." : "Пропустить существующие: оставить строку проекта без изменений."}</li>
                <li>{en ? "Fill empty fields: write only values missing in the project." : "Заполнить пустые поля: записать только отсутствующие в проекте значения."}</li>
                <li>{en ? "Update mapped fields: replace only fields explicitly mapped from the file." : "Обновить сопоставленные поля: заменить только явно назначенные колонки файла."}</li>
              </ul>
              <p>
                {en
                  ? "File imports create missing keywords by default. Ranking imports start in update-only mode; enable new keywords there only when unmatched rows should be created."
                  : "В режиме «Файл» создание отсутствующих запросов включено по умолчанию. Импорт позиций начинает в режиме обновления существующих; включайте новые запросы там только для строк без совпадений."}
              </p>
            </section>

            <section id="rankings">
              <h2>{en ? "Ranking history" : "История позиций"}</h2>
              <p>{en ? "Wide format:" : "Широкий формат:"}</p>
              <pre><code>{en ? "Keyword,Ranking URL,01.09.2026,08.09.2026\nbuy a bike,https://example.com/bikes,12,9" : "Запрос,URL из выдачи,01.09.2026,08.09.2026\nкупить велосипед,https://example.ru/velosipedy,12,9"}</code></pre>
              <p>{en ? "Row format:" : "Построчный формат:"}</p>
              <pre><code>{en ? "Keyword,Date,Search engine,Position,Ranking URL\nbuy a bike,08.09.2026,Yandex,9,https://example.com/bikes" : "Запрос,Дата,Поисковик,Позиция,URL из выдачи\nкупить велосипед,08.09.2026,Яндекс,9,https://example.ru/velosipedy"}</code></pre>
              <p>
                {en
                  ? "Ranking URL is stored on the imported observation and does not replace the keyword target URL. An empty cell means no observation. A dash or zero means the site was checked but not found. Verify the search engine, city, language and device before publishing."
                  : "URL из выдачи сохраняется в импортированном снимке и не заменяет целевой URL запроса. Пустая ячейка означает отсутствие замера. Дефис или ноль означает, что проверка была, но сайт не найден. Перед публикацией проверьте поисковик, город, язык и устройство."}
              </p>
            </section>

            <section id="examples">
              <h2>{en ? "Example files" : "Примеры файлов"}</h2>
              <div className="public-import-examples">
                <a download href="/examples/imports/keywords.csv">
                  <strong>{en ? "Universal keywords" : "Универсальная семантика"}</strong>
                  <span>keywords.csv</span>
                </a>
                <a download href="/examples/imports/positions-wide.csv">
                  <strong>{en ? "Wide ranking history" : "Широкая история позиций"}</strong>
                  <span>positions-wide.csv</span>
                </a>
                <a download href="/examples/imports/positions-long.csv">
                  <strong>{en ? "Row ranking history" : "Построчная история позиций"}</strong>
                  <span>positions-long.csv</span>
                </a>
              </div>
            </section>
          </article>
        </div>
      </main>
    </PublicDocumentShell>
  );
}
