import assert from "node:assert/strict";
import test from "node:test";
import {
  readCalendarRangeSession,
  sessionCalendarRange,
  writeCalendarRangeSession,
} from "./date-range-session.ts";

const available = { from: "2025-01-01", to: "2026-10-09" };
test("a new session advances only the end date and preserves the start", () => {
  assert.deepEqual(
    sessionCalendarRange({
      value: { from: "2026-08-15", to: "2026-09-18" },
      available,
      today: "2026-10-09",
    }),
    { from: "2026-08-15", to: "2026-10-09" },
  );
});
test("an explicit end is stable across calendar reopen and reload in the same day", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const chosen = { from: "2026-08-15", to: "2026-09-18" };
  writeCalendarRangeSession(
    storage,
    "user1:project1:positions",
    chosen,
    "2026-10-09",
  );
  const session = readCalendarRangeSession(storage, "user1:project1:positions");
  assert.deepEqual(
    sessionCalendarRange({
      value: chosen,
      available,
      session,
      today: "2026-10-09",
    }),
    chosen,
  );
  assert.equal(
    readCalendarRangeSession(storage, "user2:project1:positions"),
    undefined,
  );
  assert.deepEqual(
    sessionCalendarRange({
      value: chosen,
      available: { ...available, to: "2026-10-10" },
      session,
      today: "2026-10-10",
    }),
    chosen,
    "manual dates stay fixed for the tab's entire session",
  );
  assert.deepEqual(
    sessionCalendarRange({
      value: chosen,
      available: { ...available, to: "2026-10-10" },
      today: "2026-10-10",
    }),
    { from: chosen.from, to: "2026-10-10" },
    "a new tab session refreshes only the end",
  );
});
test("complete provider periods and malformed local data remain bounded", () => {
  const providerBounds = { from: "2025-01-01", to: "2026-09-30" };
  assert.deepEqual(
    sessionCalendarRange({
      value: { from: "2025-06-01", to: "2026-09-30" },
      available: providerBounds,
      today: "2026-10-09",
      followToday: false,
    }),
    { from: "2025-06-01", to: "2026-09-30" },
  );
  assert.equal(
    readCalendarRangeSession(
      {
        getItem: () =>
          '{"day":"2026-02-31","from":"2026-01-01","to":"2026-01-02"}',
        setItem: () => undefined,
      },
      "key",
    ),
    undefined,
  );
});
