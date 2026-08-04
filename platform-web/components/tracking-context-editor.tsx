import { CustomSelect } from "./custom-select";
import { SearchableRegionSelect } from "./searchable-region-select";
import type {
  TrackingDepth,
  TrackingDevice,
  TrackingDomainMatchMode,
  TrackingSearchEngine
} from "@seo-platform/contracts";
import {
  trackingDepths,
  trackingDevices,
  trackingDomainMatchModes,
  trackingSearchEngines
} from "@seo-platform/contracts";
import {
  cloneElement,
  isValidElement,
  useId,
  type AriaAttributes,
  type FormEvent,
  type ReactNode,
  type RefObject
} from "react";
import {
  domainMatchNeedsValue,
  type TrackingContextDraft,
  type TrackingContextDraftErrors
} from "../lib/tracking-contexts";
import {
  trackingDeviceLabel,
  trackingDomainMatchModeLabel,
  trackingSearchEngineLabel
} from "../lib/tracking-context-presentation";

export function TrackingContextEditor({
  draft,
  errors,
  errorSummaryRef,
  mode,
  onCancel,
  onChange,
  onSubmit,
  saving,
  submitDisabled
}: Readonly<{
  draft: TrackingContextDraft;
  errors: TrackingContextDraftErrors;
  errorSummaryRef: RefObject<HTMLDivElement | null>;
  mode: "create" | "edit";
  onCancel: () => void;
  onChange: (draft: TrackingContextDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  submitDisabled: boolean;
}>) {
  const hasErrors = Object.keys(errors).length > 0;
  return (
    <form
      aria-busy={saving}
      className="panel tracking-context-editor"
      noValidate
      onSubmit={onSubmit}
    >
      <header className="security-card-header">
        <div>
          <p className="eyebrow">
            {mode === "create" ? "Новый профиль" : "Новая версия"}
          </p>
          <h2>
            {mode === "create"
              ? "Создать профиль съёма"
              : `Изменить «${draft.name || "профиль"}»`}
          </h2>
          <p>
            Выберите поисковик, регион, устройство и глубину. Подключение
            провайдера и расписание настраиваются отдельно.
          </p>
        </div>
      </header>

      {hasErrors && (
        <div
          className="inline-alert danger tracking-context-error-summary"
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
        >
          <strong>Проверьте поля формы</strong>
          <span>
            Исправьте отмеченные значения. Введённые данные сохранены в
            черновике.
          </span>
        </div>
      )}

      <fieldset
        className="tracking-context-editor-fieldset"
        disabled={saving}
      >
      <div className="tracking-context-form-grid">
        <DraftField
          error={errors.name}
          label="Название профиля"
          wide
        >
          <input
            aria-invalid={Boolean(errors.name)}
            autoComplete="off"
            maxLength={160}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
            placeholder="Например, Google US · Desktop"
            required
            value={draft.name}
          />
        </DraftField>

        <DraftField label="Поисковая система">
          <CustomSelect
            onChange={(event) =>
              onChange({
                ...draft,
                searchEngine: event.target
                  .value as TrackingSearchEngine,
                regionCode: "",
                regionLabel: ""
              })
            }
            value={draft.searchEngine}
          >
            {trackingSearchEngines.map((engine) => (
              <option key={engine} value={engine}>
                {trackingSearchEngineLabel(engine)}
              </option>
            ))}
          </CustomSelect>
        </DraftField>

        <DraftField label="Устройство">
          <CustomSelect
            onChange={(event) =>
              onChange({
                ...draft,
                device: event.target.value as TrackingDevice
              })
            }
            value={draft.device}
          >
            {trackingDevices.map((device) => (
              <option key={device} value={device}>
                {trackingDeviceLabel(device)}
              </option>
            ))}
          </CustomSelect>
        </DraftField>

        <DraftField
          error={errors.countryCode}
          hint="ISO 3166-1 alpha-2"
          label="Страна"
        >
          <input
            aria-invalid={Boolean(errors.countryCode)}
            autoCapitalize="characters"
            maxLength={2}
            onChange={(event) =>
              onChange({
                ...draft,
                countryCode: event.target.value
              })
            }
            placeholder="US"
            required
            value={draft.countryCode}
          />
        </DraftField>

        <DraftField
          error={errors.language}
          hint="BCP 47"
          label="Язык"
        >
          <input
            aria-invalid={Boolean(errors.language)}
            maxLength={16}
            onChange={(event) =>
              onChange({ ...draft, language: event.target.value })
            }
            placeholder="en"
            required
            value={draft.language}
          />
        </DraftField>

        <DraftField
          error={errors.regionCode ?? errors.regionLabel}
          hint="Поиск по названию или коду"
          label="Регион"
          wide
        >
          <SearchableRegionSelect
            kind={
              draft.searchEngine === "YANDEX"
                ? "YANDEX_RANK"
                : "GOOGLE_RANK"
            }
            onChange={(region) =>
              onChange({
                ...draft,
                regionCode: region.code,
                regionLabel: region.label
              })
            }
            value={draft.regionCode}
            valueLabel={draft.regionLabel}
          />
        </DraftField>

        <DraftField label="Глубина выдачи">
          <CustomSelect
            onChange={(event) =>
              onChange({
                ...draft,
                depth: Number(event.target.value) as TrackingDepth
              })
            }
            value={draft.depth}
          >
            {trackingDepths.map((depth) => (
              <option key={depth} value={depth}>
                TOP-{depth}
              </option>
            ))}
          </CustomSelect>
        </DraftField>

        <DraftField label="Правило сопоставления домена">
          <CustomSelect
            onChange={(event) =>
              onChange({
                ...draft,
                domainMatchMode: event.target
                  .value as TrackingDomainMatchMode,
                domainMatchValue: ""
              })
            }
            value={draft.domainMatchMode}
          >
            {trackingDomainMatchModes.map((domainMode) => (
              <option key={domainMode} value={domainMode}>
                {trackingDomainMatchModeLabel(domainMode)}
              </option>
            ))}
          </CustomSelect>
        </DraftField>

        {domainMatchNeedsValue(draft.domainMatchMode) && (
          <DraftField
            error={errors.domainMatchValue}
            label={
              draft.domainMatchMode === "SPECIFIC_URL"
                ? "Точный URL"
                : "Префикс URL"
            }
            wide
          >
            <input
              aria-invalid={Boolean(errors.domainMatchValue)}
              inputMode="url"
              maxLength={2048}
              onChange={(event) =>
                onChange({
                  ...draft,
                  domainMatchValue: event.target.value
                })
              }
              placeholder="https://example.com/catalog"
              required
              type="url"
              value={draft.domainMatchValue}
            />
          </DraftField>
        )}
      </div>

      <label className="tracking-context-safe-search">
        <span>
          <strong>SafeSearch</strong>
          <small>
            Применяется ко всем будущим проверкам этого профиля.
          </small>
        </span>
        <input
          checked={draft.safeSearch}
          onChange={(event) =>
            onChange({ ...draft, safeSearch: event.target.checked })
          }
          type="checkbox"
        />
      </label>
      </fieldset>

      <footer className="tracking-context-editor-actions">
        <span>
          {mode === "edit"
            ? "Изменение поисковых параметров создаст новую версию профиля и не перепишет прошлые результаты."
            : "После создания назначьте профилю запросы из семантического ядра."}
        </span>
        <button
          className="secondary-button"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Отмена
        </button>
        <button
          className="primary-button"
          disabled={submitDisabled}
          type="submit"
        >
          {saving
            ? "Сохраняем…"
            : mode === "create"
              ? "Создать"
              : "Сохранить изменения"}
        </button>
      </footer>
    </form>
  );
}

function DraftField({
  children,
  error,
  hint,
  label,
  wide = false
}: Readonly<{
  children: ReactNode;
  error?: string | undefined;
  hint?: string;
  label: string;
  wide?: boolean;
}>) {
  const errorId = useId();
  const control = isValidElement<AriaAttributes>(children)
    ? cloneElement(children, {
        "aria-describedby": error
          ? [
              children.props["aria-describedby"],
              errorId
            ]
              .filter(Boolean)
              .join(" ")
          : children.props["aria-describedby"]
      })
    : children;
  return (
    <label
      className={`form-field tracking-context-field ${
        wide ? "wide" : ""
      }`}
    >
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {control}
      {error && <em id={errorId}>{error}</em>}
    </label>
  );
}
