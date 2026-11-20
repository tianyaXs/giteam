import assert from "node:assert/strict";
import test from "node:test";
import { normalizePetSettings } from "../src/lib/petSettings.ts";
import { gazeClientPoint, resolvePetState } from "../src/lib/petState.ts";

const minute = 60_000;

test("running session stays busy even after a long idle", () => {
  assert.equal(resolvePetState({
    busy: true,
    lastActivityAt: 0,
    now: 30 * minute,
    sleepMinutes: 5,
  }), "working");
});

test("idle under the threshold stays on standby", () => {
  assert.equal(resolvePetState({
    busy: false,
    lastActivityAt: 1_000,
    now: 1_000 + 5 * minute - 1,
    sleepMinutes: 5,
  }), "default");
});

test("idle at the threshold falls asleep", () => {
  assert.equal(resolvePetState({
    busy: false,
    lastActivityAt: 1_000,
    now: 1_000 + 5 * minute,
    sleepMinutes: 5,
  }), "sleeping");
});

test("custom sleep minutes replace the five minute default", () => {
  assert.equal(resolvePetState({
    busy: false,
    lastActivityAt: 0,
    now: 2 * minute,
    sleepMinutes: 3,
  }), "default");
  assert.equal(resolvePetState({
    busy: false,
    lastActivityAt: 0,
    now: 3 * minute,
    sleepMinutes: 3,
  }), "sleeping");
});

test("gaze keeps the cursor direction inside one body width", () => {
  const near = gazeClientPoint({ cursorX: 140, cursorY: 130, width: 252, height: 252 });
  assert.equal(near.x, 140);
  assert.equal(near.y, 130);
  const far = gazeClientPoint({ cursorX: 252 + 800, cursorY: 126, width: 252, height: 252 });
  const faceX = 126;
  const faceY = 126 + (252 / 1.5) * 0.1;
  const reach = (252 / 1.5) * 0.85;
  assert.ok(far.x > faceX);
  assert.ok(Math.hypot(far.x - faceX, far.y - faceY) <= reach + 0.001);
});

test("pet settings keep supported shapes and clamp sleep time", () => {
  const settings = normalizePetSettings({
    enabled: false,
    type: "nope",
    shading: "plastic",
    face: "mouth",
    hat: "crown",
    glasses: "shades",
    headphones: true,
    bowTie: true,
    color: "#A1B2C3",
    accessoryColor: "blue",
    size: 12,
    sleepMinutes: 0,
  });
  assert.equal(settings.enabled, false);
  assert.equal(settings.type, "circle");
  assert.equal(settings.shading, "plastic");
  assert.equal(settings.face, "mouth");
  assert.equal(settings.hat, "crown");
  assert.equal(settings.glasses, "shades");
  assert.equal(settings.headphones, true);
  assert.equal(settings.bowTie, true);
  assert.equal(settings.color, "#a1b2c3");
  assert.equal(settings.accessoryColor, "");
  assert.equal(settings.size, 112);
  assert.equal(settings.sleepMinutes, 1);
});
