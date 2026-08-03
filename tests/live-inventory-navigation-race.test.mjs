import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  HydrationSession,
  OwnedAbortRequestSlot,
  RequestOwnership,
} from "../lib/request-ownership.ts";

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

test("WebSocket connection cleanup cannot cancel the separate initial hydration", async () => {
  const hydrationTask = deferred();
  const pollingTask = deferred();
  const hydration = new HydrationSession(1);
  let hydrationSignal;
  let pollingSignal;
  const hydrationPromise = hydration.run((signal) => {
    hydrationSignal = signal;
    return hydrationTask.promise;
  });
  const polling = new OwnedAbortRequestSlot();
  const pollingPromise = polling.start(1, (signal) => {
    pollingSignal = signal;
    return pollingTask.promise;
  });

  // This is the production transition that used to abort both responsibilities:
  // the live socket becomes healthy and disables ordinary fallback polling.
  polling.cancel(1);
  assert.equal(pollingSignal.aborted, true);
  assert.equal(hydrationSignal.aborted, false);
  hydrationTask.resolve();
  pollingTask.resolve();
  assert.deepEqual(await hydrationPromise, { status: "completed", attempts: 1 });
  await pollingPromise;
});

test("unexpected same-activation abort retries once with a fresh request", async () => {
  const hydration = new HydrationSession(7);
  const signals = [];
  const outcome = await hydration.run(async (signal, requestNumber) => {
    signals.push(signal);
    if (requestNumber === 1) {
      throw new DOMException("browser cancelled", "AbortError");
    }
  }, 1);
  assert.deepEqual(outcome, { status: "completed", attempts: 2 });
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
});

test("unexpected hydration abort recovery is bounded", async () => {
  const hydration = new HydrationSession(8);
  const outcome = await hydration.run(async () => {
    throw new DOMException("browser cancelled", "AbortError");
  }, 1);
  assert.deepEqual(outcome, {
    status: "abort-retries-exhausted",
    attempts: 2,
  });
});

test("leaving an activation cancels hydration without replacement", async () => {
  const hydration = new HydrationSession(9);
  let attempts = 0;
  const outcomePromise = hydration.run((signal) => {
    attempts += 1;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("left booth", "AbortError")), { once: true });
    });
  }, 1);
  hydration.cancel("left-booth");
  assert.deepEqual(await outcomePromise, {
    status: "cancelled",
    attempts: 1,
    reason: "left-booth",
  });
  assert.equal(attempts, 1);
});

test("dashboard always hydrates each activation independently of WebSocket status", async () => {
  const dashboard = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /const activation = boothRequestOwnershipRef\.current\.activate\(\)/);
  assert.match(dashboard, /setBoothActivation\(activation\)/);
  assert.match(dashboard, /const session = new HydrationSession\(activation\)/);
  assert.match(dashboard, /\.run\(\(signal\) => loadSelectedBooth\(signal, true\), 1\)/);
  assert.match(dashboard, /hydrationSettledActivation === boothActivation/);
  assert.match(dashboard, /hydratedActivation !== boothActivation \|\| liveSyncStatus !== "connected"/);
  assert.match(dashboard, /await hydration\.promise/);
  assert.match(dashboard, /detailRequestGenerationRef\.current === requestGeneration/);
  assert.match(dashboard, /session\.cancel\("superseded-activation"\)/);
  assert.match(dashboard, /session\.cancel\("left-booth"\)/);
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
