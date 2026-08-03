import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { OwnedAbortRequestSlot, RequestOwnership } from "../lib/request-ownership.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("same-booth reentry owns a new activation and rejects stale completion", () => {
  const ownership = new RequestOwnership();
  const first = ownership.activate();
  ownership.invalidate();
  const reopened = ownership.activate();
  assert.notEqual(reopened, first);
  assert.equal(ownership.owns(first), false);
  assert.equal(ownership.owns(reopened), true);
});

test("old request cleanup cannot abort or clear a replacement request", async () => {
  const slot = new OwnedAbortRequestSlot();
  const firstTask = deferred();
  const secondTask = deferred();
  let firstSignal;
  let secondSignal;
  const first = slot.start(1, (signal) => { firstSignal = signal; return firstTask.promise; });
  slot.cancel(1);
  assert.equal(firstSignal.aborted, true);
  const second = slot.start(2, (signal) => { secondSignal = signal; return secondTask.promise; });
  assert.notEqual(second, first);
  firstTask.resolve();
  await first;
  assert.equal(slot.promise, second);
  assert.equal(secondSignal.aborted, false);
  secondTask.resolve();
  await second;
  assert.equal(slot.promise, null);
});

test("owner-scoped cleanup ignores a newer activation", async () => {
  const slot = new OwnedAbortRequestSlot();
  const task = deferred();
  let signal;
  const request = slot.start(2, (requestSignal) => { signal = requestSignal; return task.promise; });
  slot.cancel(1);
  assert.equal(signal.aborted, false);
  assert.equal(slot.promise, request);
  task.resolve();
  await request;
});

test("different-booth navigation applies only the current activation", () => {
  const ownership = new RequestOwnership();
  const boothA = ownership.activate();
  const boothB = ownership.activate();
  const applied = [];
  if (ownership.owns(boothA)) applied.push("A");
  if (ownership.owns(boothB)) applied.push("B");
  assert.deepEqual(applied, ["B"]);
});

test("dashboard always hydrates each activation independently of WebSocket status", async () => {
  const dashboard = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /const activation = boothRequestOwnershipRef\.current\.activate\(\)/);
  assert.match(dashboard, /setBoothActivation\(activation\)/);
  assert.match(dashboard, /void refreshSelectedBooth\(true\)/);
  assert.match(dashboard, /\[boothActivation, refreshSelectedBooth, selectedBoothId\]/);
  assert.match(dashboard, /boothRequestOwnershipRef\.current\.owns\(requestActivation, signal\)/);
  assert.match(dashboard, /activateBooth\(booth\)/);
  assert.match(dashboard, /leaveBooth\(\)/);
});

test("polling cancels owned requests synchronously and preserves visibility recovery", async () => {
  const polling = await readFile(new URL("../app/use-active-polling.ts", import.meta.url), "utf8");
  assert.match(polling, /requestSlotRef\.current\.cancel\(owner\)/);
  assert.match(polling, /forcePendingRef\.current = true/);
  assert.match(polling, /synchronize\(force\)/);
  assert.match(polling, /Math\.max\(intervalMs, retryDelay\)/);
});
