import assert from "node:assert/strict";
import test from "node:test";
import type {
  TrackingContextSettings,
  TrackingContextSummary
} from "@seo-platform/contracts";
import { stableIdempotencyCommand } from "./idempotency.ts";
import {
  defaultTrackingContextSettingsDraft,
  effectiveTrackingContextRestriction,
  emptyTrackingContextDraft,
  reconcileTrackingContextCreate,
  reconcileTrackingContextEditorRevision,
  trackingContextCreateInput,
  trackingContextDisplayName,
  trackingContextDraft,
  trackingContextDraftDirty,
  trackingContextMatchesDraft,
  trackingContextPayloadSignature,
  trackingContextsApiPath,
  trackingContextsReturnTo,
  validateTrackingContextDraft,
  withTrackingContext
} from "./tracking-contexts.ts";

const context: TrackingContextSummary = {
  id: "context-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  name: "Google US",
  status: "ACTIVE",
  configuration: {
    searchEngine: "GOOGLE",
    countryCode: "US",
    regionCode: "us-ca",
    regionLabel: "California",
    language: "en",
    device: "DESKTOP",
    depth: 100,
    domainMatchRule: { mode: "EXACT_HOST" },
    safeSearch: false,
    configurationVersion: 1,
    createdBy: "user-1",
    createdAt: "2026-07-29T10:00:00.000Z"
  },
  assignedKeywordCount: 3,
  version: 1,
  createdBy: "user-1",
  updatedBy: "user-1",
  createdAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-29T10:00:00.000Z"
};

const settings: TrackingContextSettings = {
  contexts: [context],
  contextsTruncated: false,
  access: {
    canConfigure: true,
    mutationRestriction: "NONE"
  }
};

test("repairs a numeric city segment in a legacy tracking-context name", () => {
  assert.equal(
    trackingContextDisplayName({
      ...context,
      name: "Яндекс · 213 · Десктоп",
      configuration: {
        ...context.configuration,
        searchEngine: "YANDEX",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "213"
      }
    }),
    "Яндекс · Москва · Десктоп"
  );
});

test("normalizes a tracking context draft into the public mutation shape", () => {
  const input = trackingContextCreateInput({
    ...emptyTrackingContextDraft(),
    name: "  Yandex Moscow  ",
    searchEngine: "YANDEX",
    countryCode: "ru",
    regionCode: "  213 ",
    regionLabel: " Москва ",
    language: "ru-RU",
    device: "MOBILE",
    depth: 50,
    domainMatchMode: "URL_PREFIX",
    domainMatchValue: " https://example.test/catalog ",
    safeSearch: true
  });

  assert.deepEqual(input, {
    name: "Yandex Moscow",
    configuration: {
      searchEngine: "YANDEX",
      countryCode: "RU",
      regionCode: "213",
      regionLabel: "Москва",
      language: "ru-RU",
      device: "MOBILE",
      depth: 50,
      domainMatchRule: {
        mode: "URL_PREFIX",
        value: "https://example.test/catalog"
      },
      safeSearch: true
    },
    launchProfile: {
      searchSource: "LIVE",
      includeUntracked: false,
      scope: {
        mode: "KEYWORDS",
        groupIds: [],
        descendantGroupIds: []
      }
    }
  });
});

test("marks only an explicit one-off tracking context as non-reusable", () => {
  const draft = {
    ...defaultTrackingContextSettingsDraft(),
    scopeMode: "ALL" as const
  };
  assert.equal(trackingContextCreateInput(draft).isReusable, undefined);
  assert.equal(
    trackingContextCreateInput(draft, { isReusable: false }).isReusable,
    false
  );
});

test("matches server text and BCP-47 normalization", () => {
  const input = trackingContextCreateInput({
    ...emptyTrackingContextDraft(),
    name: "  Google　US   Mobile  ",
    countryCode: "us",
    language: "EN-us"
  });
  assert.equal(input.name, "Google US Mobile");
  assert.equal(input.configuration.countryCode, "US");
  assert.equal(input.configuration.language, "en-US");
});

test("validates required locale and conditional URL fields", () => {
  assert.deepEqual(
    validateTrackingContextDraft({
      ...emptyTrackingContextDraft(),
      domainMatchMode: "SPECIFIC_URL"
    }),
    {
      name: "Введите название контекста.",
      countryCode: "Укажите двухбуквенный код страны, например US.",
      language: "Укажите язык в формате BCP 47, например en или ru-RU.",
      domainMatchValue: "Укажите URL для выбранного правила."
    }
  );
  assert.deepEqual(
    validateTrackingContextDraft({
      ...emptyTrackingContextDraft(),
      name: "Google US",
      countryCode: "US",
      language: "en",
      domainMatchMode: "SPECIFIC_URL",
      domainMatchValue: "javascript:alert(1)"
    }),
    {
      domainMatchValue:
        "Укажите полный http(s) URL без логина, пароля и #fragment, длиной до 2048 символов."
    }
  );
  assert.deepEqual(
    validateTrackingContextDraft({
      ...emptyTrackingContextDraft(),
      name: "Google US",
      countryCode: "US",
      language: "en",
      domainMatchMode: "URL_PREFIX",
      domainMatchValue: "https://user:pass@example.test/path#section"
    }),
    {
      domainMatchValue:
        "Укажите полный http(s) URL без логина, пароля и #fragment, длиной до 2048 символов."
    }
  );
});

test("requires a canonical region code for display metadata", () => {
  assert.deepEqual(
    validateTrackingContextDraft({
      ...emptyTrackingContextDraft(),
      name: "Google US",
      countryCode: "US",
      language: "en",
      regionLabel: "California"
    }),
    {
      regionLabel:
        "Название региона можно указать только вместе с каноническим кодом."
    }
  );
});

test("detects semantic draft changes after normalization", () => {
  const draft = trackingContextDraft(context);
  assert.equal(trackingContextDraftDirty(context, draft), false);
  assert.equal(
    trackingContextDraftDirty(context, {
      ...draft,
      countryCode: "us"
    }),
    false
  );
  assert.equal(
    trackingContextDraftDirty(context, {
      ...draft,
      depth: 50
    }),
    true
  );
});

test("preserves legacy descendant scope while new drafts stay direct", () => {
  const legacy = trackingContextDraft({
    ...context,
    launchProfile: {
      searchSource: "LIVE",
      includeUntracked: false,
      scope: {
        mode: "GROUPS",
        groupIds: ["01900000-0000-7000-8000-000000000099"]
      }
    }
  });

  assert.deepEqual(legacy.descendantGroupIds, [
    "01900000-0000-7000-8000-000000000099"
  ]);
  assert.deepEqual(emptyTrackingContextDraft().descendantGroupIds, []);
});

test("matches a reusable context only against the complete normalized draft", () => {
  const draft = trackingContextDraft(context);
  assert.equal(
    trackingContextMatchesDraft(context, {
      ...draft,
      countryCode: "us",
      name: " Google US "
    }),
    true
  );
  assert.equal(
    trackingContextMatchesDraft(context, {
      ...draft,
      safeSearch: true
    }),
    false
  );
  assert.equal(
    trackingContextMatchesDraft(context, {
      ...draft,
      domainMatchMode: "URL_PREFIX",
      domainMatchValue: "https://example.test/catalog"
    }),
    false
  );
  assert.equal(
    trackingContextMatchesDraft(context, {
      ...draft,
      regionLabel: "Nevada"
    }),
    false
  );
});

test("keeps one idempotency key for the same normalized payload", () => {
  const draft = {
    ...emptyTrackingContextDraft(),
    name: "Google US",
    countryCode: "US",
    language: "en"
  };
  const signature = trackingContextPayloadSignature(draft);
  const first = stableIdempotencyCommand(
    undefined,
    signature,
    () => "key-1"
  );
  const replay = stableIdempotencyCommand(
    first,
    trackingContextPayloadSignature({
      ...draft,
      name: " Google US "
    }),
    () => "key-2"
  );
  const changed = stableIdempotencyCommand(
    replay,
    trackingContextPayloadSignature({ ...draft, depth: 50 }),
    () => "key-3"
  );

  assert.equal(replay.key, "key-1");
  assert.equal(changed.key, "key-3");
});

test("reconciles a replay receipt with the authoritative detail", () => {
  const newer = {
    ...context,
    name: "Renamed by teammate",
    version: 2
  };
  assert.deepEqual(reconcileTrackingContextCreate(context, newer), {
    current: newer,
    superseded: true
  });
  assert.throws(() =>
    reconcileTrackingContextCreate(context, {
      ...newer,
      projectId: "other-project"
    })
  );
});

test("reconciles an open editor with an authoritative status revision", () => {
  const dirtyDraft = {
    ...trackingContextDraft(context),
    name: "Local rename"
  };
  const activeServer = {
    ...context,
    name: "Remote rename",
    version: 2
  };
  assert.deepEqual(
    reconcileTrackingContextEditorRevision(
      { base: context, draft: dirtyDraft },
      activeServer
    ),
    {
      base: activeServer,
      draft: dirtyDraft
    }
  );
  assert.deepEqual(
    reconcileTrackingContextEditorRevision(
      {
        base: context,
        draft: trackingContextDraft(context)
      },
      activeServer
    ),
    {
      base: activeServer,
      draft: trackingContextDraft(activeServer)
    }
  );
  assert.equal(
    reconcileTrackingContextEditorRevision(
      {
        base: context,
        draft: trackingContextDraft(context)
      },
      { ...activeServer, status: "ARCHIVED" }
    ),
    undefined
  );
});

test("replaces context revisions without duplicating logical contexts", () => {
  const newer = { ...context, version: 2 };
  const result = withTrackingContext(settings, newer);
  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0]?.version, 2);
});

test("keeps a newly created context visible in a truncated projection", () => {
  const second = {
    ...context,
    id: "context-2",
    name: "Second context"
  };
  const result = withTrackingContext(
    {
      ...settings,
      contextsTruncated: true
    },
    second
  );
  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0]?.id, "context-2");
});

test("enforces local read-only and project archive restrictions", () => {
  assert.equal(
    effectiveTrackingContextRestriction(
      settings,
      "ACTIVE",
      "ACTIVE"
    ),
    "NONE"
  );
  assert.equal(
    effectiveTrackingContextRestriction(
      settings,
      "ACTIVE",
      "READ_ONLY"
    ),
    "WORKSPACE_READ_ONLY"
  );
  assert.equal(
    effectiveTrackingContextRestriction(
      settings,
      "ARCHIVED",
      "ACTIVE"
    ),
    "PROJECT_ARCHIVED"
  );
  assert.equal(
    effectiveTrackingContextRestriction(
      {
        ...settings,
        access: {
          canConfigure: false,
          mutationRestriction: "WORKSPACE_READ_ONLY"
        }
      },
      "ARCHIVED",
      "ACTIVE"
    ),
    "WORKSPACE_READ_ONLY"
  );
});

test("builds encoded project paths and exact returnTo", () => {
  assert.equal(
    trackingContextsApiPath("project id"),
    "/app/api/projects/project%20id/tracking-contexts"
  );
  assert.equal(
    trackingContextsReturnTo("project id"),
    "/app/projects/project%20id/rankings/contexts"
  );
});
