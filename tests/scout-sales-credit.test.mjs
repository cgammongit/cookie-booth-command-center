import assert from "node:assert/strict";
import test from "node:test";
import { allocateScoutCredits, eligibleScouts, isValidAttendance, sumRational } from "../lib/scout-credit.ts";

const boothEnd = "2026-02-01T20:00:00.000Z";
const assignments = [
  { scoutId: 1, attendanceStart: "2026-02-01T18:00:00.000Z", attendanceEnd: "2026-02-01T19:00:00.000Z", stayedThroughClose: false },
  { scoutId: 2, attendanceStart: "2026-02-01T18:00:00.000Z", attendanceEnd: boothEnd, stayedThroughClose: true },
  { scoutId: 3, attendanceStart: "2026-02-01T18:00:00.000Z", attendanceEnd: boothEnd, stayedThroughClose: true },
];

test("attendance uses half-open boundaries", () => {
  assert.deepEqual(eligibleScouts("2026-02-01T18:59:59.999Z", boothEnd, assignments).map((item) => item.scoutId), [1, 2, 3]);
  assert.deepEqual(eligibleScouts("2026-02-01T19:00:00.000Z", boothEnd, assignments).map((item) => item.scoutId), [2, 3]);
});

test("sales exactly at and after booth close use durable stayed-through-close intent", () => {
  assert.deepEqual(eligibleScouts(boothEnd, boothEnd, assignments).map((item) => item.scoutId), [2, 3]);
  assert.deepEqual(eligibleScouts("2026-02-01T20:15:00.000Z", boothEnd, assignments).map((item) => item.scoutId), [2, 3]);
});

test("five boxes split between two scouts remains exact fractional credit", () => {
  const result = allocateScoutCredits([{ saleId: "sale-1", transactionId: "line-1", productId: 10, quantity: 5, createdAt: "2026-02-01T19:30:00.000Z" }], boothEnd, assignments);
  assert.deepEqual(result.allocations.map((item) => [item.scoutId, item.numerator, item.denominator]), [[2, 5, 2], [3, 5, 2]]);
  assert.equal(sumRational(result.allocations).value, 5);
});

test("multiple varieties allocate per sale line and always balance", () => {
  const lines = [
    { saleId: "sale-2", transactionId: "line-a", productId: 10, quantity: 30, createdAt: "2026-02-01T18:30:00.000Z" },
    { saleId: "sale-3", transactionId: "line-b", productId: 11, quantity: 25, createdAt: "2026-02-01T19:30:00.000Z" },
  ];
  const result = allocateScoutCredits(lines, boothEnd, assignments);
  assert.equal(sumRational(result.allocations.filter((item) => item.transactionId === "line-a")).value, 30);
  assert.equal(sumRational(result.allocations.filter((item) => item.transactionId === "line-b")).value, 25);
  assert.equal(sumRational(result.allocations).value, 55);
});

test("uncovered sales are flagged and invalid attendance is rejected", () => {
  const result = allocateScoutCredits([{ saleId: "sale-4", transactionId: "line-c", productId: 10, quantity: 1, createdAt: "2026-02-01T17:00:00.000Z" }], boothEnd, assignments);
  assert.deepEqual(result.unallocatedTransactionIds, ["line-c"]);
  assert.equal(isValidAttendance({ attendanceStart: boothEnd, attendanceEnd: "2026-02-01T21:00:00.000Z" }, { startsAt: "2026-02-01T18:00:00.000Z", endsAt: boothEnd }), false);
});
