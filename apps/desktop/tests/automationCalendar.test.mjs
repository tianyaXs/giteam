import assert from "node:assert/strict";
import test from "node:test";

import {
  rescheduleOccurrence,
  tasksToCalendarEvents,
  dateForWeekDay,
} from "../src/lib/automationCalendar.ts";

function dailyTask(overrides = []) {
  return {
    id: "atm_daily",
    title: "每日简报",
    goalPrompt: "x",
    repoPath: "/tmp",
    sessionMode: "new",
    scheduleKind: "cron",
    scheduleExpr: "0 10 * * *",
    scheduleOverrides: overrides,
    timezone: "local",
    notifyOnSuccess: true,
    notifyOnFailure: true,
    notifyChannel: "desktop",
    enabled: true,
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

const anchor = new Date(2026, 10, 18); // 周三

test("daily expands to 7 days at base hour", () => {
  const events = tasksToCalendarEvents([dailyTask()], anchor);
  assert.equal(events.length, 7);
  assert.ok(events.every((e) => e.hour === 10 && !e.originDate));
});

test("move one day onto next day keeps both cards", () => {
  const wed = 3;
  const thu = 4;
  const originDate = dateForWeekDay(anchor, wed);
  const yyyy = originDate.getFullYear();
  const mm = String(originDate.getMonth() + 1).padStart(2, "0");
  const dd = String(originDate.getDate()).padStart(2, "0");
  const origin = `${yyyy}-${mm}-${dd}`;

  const moved = rescheduleOccurrence(dailyTask(), thu, 14, anchor, wed, null);
  assert.equal(moved.mode, "override");
  assert.equal(moved.scheduleOverrides.length, 1);
  assert.equal(moved.scheduleOverrides[0].originDate, origin);
  assert.equal(moved.scheduleOverrides[0].dayOffset, 1);
  assert.equal(moved.scheduleOverrides[0].hour, 14);

  const events = tasksToCalendarEvents(
    [dailyTask(moved.scheduleOverrides)],
    anchor
  );
  const thuCards = events.filter((e) => e.day === thu);
  assert.equal(thuCards.length, 2, "源周四 + 例外卡应并存");
  assert.ok(thuCards.some((e) => !e.originDate && e.hour === 10));
  assert.ok(thuCards.some((e) => e.originDate === origin && e.hour === 14));
  assert.equal(events.filter((e) => e.day === wed).length, 0);
});

test("drag exception back to base slot removes override and restores day", () => {
  const wed = 3;
  const thu = 4;
  const originDate = dateForWeekDay(anchor, wed);
  const origin = `${originDate.getFullYear()}-${String(originDate.getMonth() + 1).padStart(2, "0")}-${String(originDate.getDate()).padStart(2, "0")}`;
  const withOvr = dailyTask([
    { originDate: origin, dayOffset: 1, hour: 14, minute: 0 },
  ]);

  const back = rescheduleOccurrence(withOvr, wed, 10, anchor, thu, origin);
  assert.equal(back.mode, "override");
  assert.equal(back.scheduleOverrides.length, 0);

  const events = tasksToCalendarEvents([dailyTask(back.scheduleOverrides)], anchor);
  assert.equal(events.filter((e) => e.day === wed).length, 1);
  assert.equal(events.filter((e) => e.day === thu).length, 1);
  assert.ok(events.every((e) => !e.originDate));
});

test("same-day hour change only moves that occurrence", () => {
  const wed = 3;
  const moved = rescheduleOccurrence(dailyTask(), wed, 15, anchor, wed, null);
  assert.equal(moved.mode, "override");
  assert.equal(moved.scheduleOverrides[0].dayOffset, 0);
  assert.equal(moved.scheduleOverrides[0].hour, 15);

  const events = tasksToCalendarEvents([dailyTask(moved.scheduleOverrides)], anchor);
  assert.equal(events.length, 7);
  const wedCard = events.find((e) => e.day === wed);
  assert.equal(wedCard.hour, 15);
  assert.ok(wedCard.originDate);
  assert.ok(events.filter((e) => e.day !== wed).every((e) => e.hour === 10));
});
