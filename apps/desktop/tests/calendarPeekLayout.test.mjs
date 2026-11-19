import assert from "node:assert/strict";
import test from "node:test";

import {
  CALENDAR_PEEK,
  layoutPeekStacks,
  peekCellKey,
  peekPositionCalc,
  placeholderPeekLayout,
  sortPeekEvents,
} from "../src/lib/calendarPeekLayout.ts";

test("single event keeps full-width geometry with content", () => {
  const { cards, overflows } = layoutPeekStacks([
    { id: "a", day: 1, hour: 10, title: "A", enabled: true },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].offsetPx, 0);
  assert.equal(cards[0].shrinkPx, 0);
  assert.equal(cards[0].showContent, true);
  assert.equal(overflows.length, 0);
  const pos = peekPositionCalc(1, 0, 0);
  assert.match(pos.left, /\+ 3px\)$/);
  assert.match(pos.width, /- 6px\)$/);
});

test("collapsed two events: only front shows content", () => {
  const { cards } = layoutPeekStacks([
    { id: "b", day: 2, hour: 9, title: "B", enabled: true },
    { id: "a", day: 2, hour: 9, title: "A", enabled: true },
  ]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, "a");
  assert.equal(cards[0].showContent, false);
  assert.equal(cards[1].id, "b");
  assert.equal(cards[1].showContent, true);
  assert.equal(cards[1].offsetPx, CALENDAR_PEEK.peekPx);
});

test("expanded cell fans all cards with content", () => {
  const key = peekCellKey(0, 11);
  const { cards, overflows } = layoutPeekStacks(
    [
      { id: "a", day: 0, hour: 11, title: "A", enabled: true },
      { id: "b", day: 0, hour: 11, title: "B", enabled: true },
      { id: "c", day: 0, hour: 11, title: "C", enabled: true },
    ],
    { expandedKey: key }
  );
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => c.showContent && c.expanded));
  assert.equal(cards[2].topOffsetPx, CALENDAR_PEEK.expandStepPx * 2);
  assert.equal(overflows.length, 0);
});

test("collapsed three plus shows maxVisible and +N", () => {
  const { cards, overflows } = layoutPeekStacks([
    { id: "a", day: 0, hour: 11, title: "A", enabled: true },
    { id: "b", day: 0, hour: 11, title: "B", enabled: true },
    { id: "c", day: 0, hour: 11, title: "C", enabled: true },
    { id: "d", day: 0, hour: 11, title: "D", enabled: true },
  ]);
  assert.equal(cards.length, CALENDAR_PEEK.maxVisible);
  assert.equal(overflows.length, 1);
  assert.equal(overflows[0].count, 4 - CALENDAR_PEEK.maxVisible);
});

test("excludeId reflows remaining card to full width", () => {
  const { cards } = layoutPeekStacks(
    [
      { id: "a", day: 3, hour: 12, title: "A", enabled: true },
      { id: "b", day: 3, hour: 12, title: "B", enabled: true },
    ],
    { excludeId: "a" }
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, "b");
  assert.equal(cards[0].shrinkPx, 0);
  assert.equal(cards[0].showContent, true);
});

test("placeholder takes next peek lane in occupied cell", () => {
  const events = [{ id: "a", day: 4, hour: 14, title: "A", enabled: true }];
  const dragged = { id: "b", day: 1, hour: 10, title: "B", enabled: true };
  const layout = placeholderPeekLayout(events, dragged, 4, 14);
  assert.equal(layout.lane, 1);
  assert.equal(layout.offsetPx, CALENDAR_PEEK.peekPx);
});

test("enabled events sort before disabled", () => {
  const sorted = sortPeekEvents([
    { id: "z", day: 0, hour: 8, enabled: false },
    { id: "m", day: 0, hour: 8, enabled: true },
  ]);
  assert.equal(sorted[0].id, "m");
});
