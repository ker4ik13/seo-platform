# ADR-2026-033: границы tracking context

Статус: принято  
Дата: 29 июля 2026 года

## Контекст

ТЗ исторически перечисляло provider, credential, fallback, budget и schedule
внутри tracking context. После появления project connector binding такое
хранение создало бы несколько источников истины: один и тот же provider
настраивался бы в SEO data, Jobs и automation.

Позиционная история при этом обязана сохранять точную поисковую конфигурацию,
с которой получен каждый snapshot, даже после последующих изменений.

## Решение

`platform-seo-data` владеет tracking context как логической сущностью и его
неизменяемыми configuration versions.

Tracking configuration содержит только:

- search engine;
- country и канонический регион платформы;
- language;
- device;
- result depth;
- domain matching rule;
- safe search.

Остальные данные принадлежат другим агрегатам:

- provider и credential выбираются project connector binding в
  `platform-jobs-integrations`;
- fallback и budget принадлежат connector/job policy;
- schedule, timezone, overlap и missed-run policy принадлежат automation;
- фактически использованные provider, credential mode, provider region ID и
  версии connector/configuration фиксируются в immutable Job/snapshot.

`tracking_contexts.version` используется только для optimistic concurrency.
Каждое изменение поисковой конфигурации создаёт новую строку
`tracking_context_versions`; rename, archive и restore не переписывают
configuration history. Hard delete в пользовательском flow отсутствует.

Keyword assignment является отдельным temporal ресурсом. Повторное назначение
после снятия создаёт новый период, а `keywords.is_tracked` перестаёт быть
источником истины.

## Последствия

- один provider route на capability остаётся в одном владельце данных;
- rank snapshot сможет ссылаться на logical context и точную configuration
  version;
- смена расписания или ключа не создаёт фиктивную поисковую конфигурацию;
- экран может показывать effective provider/schedule рядом с context, но
  получает их отдельными проекциями;
- bulk assignment по filter/view реализуется позднее как асинхронный job;
- до первого provider call требуется отдельная authoritative lifecycle и
  billing precondition в execution path.

## Миграция

Foundation `tracking_contexts` допускается преобразовать только при пустых
legacy tracking/rank tables. При наличии строк migration останавливается:
нужен отдельный expand → inspect → backfill → validate → contract процесс.
Удалять существующие данные ради прохождения migration запрещено.

## Отклонённые варианты

- Хранить provider/schedule в JSON context: дублирует connector binding и
  automation, не даёт строгой целостности.
- Обновлять configuration in place: делает исторический rank snapshot
  неоднозначным.
- Создавать новый logical context при каждом изменении: ломает пользовательскую
  идентичность, назначения и сравнение истории.
