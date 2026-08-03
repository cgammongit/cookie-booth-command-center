import assert from "node:assert/strict";
import test from "node:test";

import { calculateScoutMenuPlacement } from "../lib/scout-menu-position.ts";

function rect({ left = 100, top = 100, width = 240, height = 44 } = {}) {
  return { left, top, width, right: left + width, bottom: top + height };
}

test("scout menu opens below when the viewport has adequate space", () => {
  const result = calculateScoutMenuPlacement(rect(), { width: 1024, height: 768 }, 300);
  assert.equal(result.side, "below");
  assert.equal(result.top, 150);
  assert.equal(result.maxHeight, 300);
});

test("scout menu opens above when the trigger is near the viewport bottom", () => {
  const result = calculateScoutMenuPlacement(rect({ top: 700 }), { width: 1024, height: 768 }, 300);
  assert.equal(result.side, "above");
  assert.equal(result.top, 394);
  assert.equal(result.maxHeight, 300);
});

test("scout menu height is constrained to available viewport space", () => {
  const result = calculateScoutMenuPlacement(rect({ top: 40 }), { width: 600, height: 240 }, 320);
  assert.equal(result.side, "below");
  assert.equal(result.maxHeight, 142);
});

test("scout menu remains inside the viewport near the right edge", () => {
  const result = calculateScoutMenuPlacement(rect({ left: 450, width: 220 }), { width: 600, height: 700 }, 200);
  assert.equal(result.width, 220);
  assert.equal(result.left, 372);
  assert.ok(result.left >= 8);
  assert.ok(result.left + result.width <= 592);
});

test("scout menu width contracts for a viewport narrower than its trigger", () => {
  const result = calculateScoutMenuPlacement(rect({ left: -20, width: 400 }), { width: 320, height: 640 }, 240);
  assert.equal(result.left, 8);
  assert.equal(result.width, 304);
});
