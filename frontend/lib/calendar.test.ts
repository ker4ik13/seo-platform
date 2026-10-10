import assert from "node:assert/strict";
import test from "node:test";
import { calendarDays, dateFromKey, dateKey, validCalendarValue } from "./calendar.ts";

test("local calendar rejects impossible dates and keeps leap days without UTC conversion", () => {
  assert.equal(validCalendarValue("2024-02-29", "date"), true);
  assert.equal(validCalendarValue("2026-02-29", "date"), false);
  assert.equal(validCalendarValue("2026-04-31", "date"), false);
  assert.equal(validCalendarValue("0000-01-01", "date"), false);
  assert.equal(dateKey(dateFromKey("0099-03-07")), "0099-03-07");
  const days = calendarDays(dateFromKey("2024-02-29"));
  assert.equal(days.length, 42);
  assert.equal(days[0]!.date.getDay(), 1);
  assert.equal(days.filter((day) => day.inMonth).length, 29);
});

test("date and time controls preserve their canonical form values", () => {
  assert.equal(validCalendarValue("2026-10-10T23:59", "datetime-local"), true);
  assert.equal(validCalendarValue("2026-10-10T23:59:12", "datetime-local"), true);
  assert.equal(validCalendarValue("2026-10-10T24:00", "datetime-local"), false);
  assert.equal(validCalendarValue("2026-10-10 23:59", "datetime-local"), false);
  assert.equal(validCalendarValue("09:15", "time"), true);
  assert.equal(validCalendarValue("9:15", "time"), false);
  assert.equal(validCalendarValue("12:60", "time"), false);
});
