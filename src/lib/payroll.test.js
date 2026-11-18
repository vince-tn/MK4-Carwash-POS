import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayslip, payWeek, payslipFromWeek, payslipsFor, quotaFor } from "./payroll.js";

// 2026-11-16 is a Monday.
const settings = [
  { effectiveFrom: "2000-01-01", weekdayQuota: 60, weekendQuota: 80, weekdayBonus: 150, weekendBonus: 150 },
  { effectiveFrom: "2026-11-19", weekdayQuota: 2, weekendQuota: 3, weekdayBonus: 200, weekendBonus: 250 },
];

test("a pay week runs Monday to Sunday and is paid the next Monday", () => {
  assert.deepEqual(payWeek("2026-11-16"), { start: "2026-11-16", end: "2026-11-22", payday: "2026-11-23" });
  assert.deepEqual(payWeek("2026-11-22"), { start: "2026-11-16", end: "2026-11-22", payday: "2026-11-23" });
  assert.equal(payWeek("2026-11-23").start, "2026-11-23");
  assert.equal(payWeek("2027-01-01").start, "2026-12-28", "across the new year");
});

test("the quota rule in force: weekdays, weekends, and from its effective date", () => {
  assert.deepEqual(
    [quotaFor("2026-11-18", settings).quota, quotaFor("2026-11-18", settings).bonus],
    [60, 150]
  );
  assert.deepEqual([quotaFor("2026-11-19", settings).quota, quotaFor("2026-11-19", settings).bonus], [2, 200]);
  assert.deepEqual([quotaFor("2026-11-21", settings).quota, quotaFor("2026-11-21", settings).bonus], [3, 250]);
  assert.equal(quotaFor("2026-11-18", []).quota, 60, "the shop's own rule when none is stored");
});

const day = (date, shopCars, cars, commission) => ({ day: date, shopCars, cars, commission });

test("bonus only on days the shop reached its quota and the worker worked", () => {
  const slip = buildPayslip({
    start: "2026-11-16",
    settings,
    days: [
      day("2026-11-16", 60, 3, 225), // reached, worked: 150
      day("2026-11-17", 59, 4, 300), // one short
      day("2026-11-18", 70, 0, 0), // reached, did not work
      day("2026-11-19", 2, 1, 75), // new rule: reached, 200
      day("2026-11-20", 1, 1, 75),
      day("2026-11-21", 3, 2, 150), // weekend under the new rule: 250
      day("2026-11-22", 0, 0, 0),
    ],
    requests: [
      { kind: "vale", requestDate: "2026-11-17", amount: 500, status: "approved" },
      { kind: "cash_advance", requestDate: "2026-11-20", amount: 100, status: "approved" },
      { kind: "vale", requestDate: "2026-11-21", amount: 999, status: "pending" },
      { kind: "vale", requestDate: "2026-11-21", amount: 999, status: "rejected" },
      { kind: "vale", requestDate: "2026-11-23", amount: 999, status: "approved" }, // next week
    ],
  });

  assert.deepEqual(slip.days.map((d) => d.bonus), [150, 0, 0, 200, 0, 250, 0]);
  assert.equal(slip.cars, 11);
  assert.equal(slip.commission, 825);
  assert.equal(slip.bonus, 600);
  assert.equal(slip.bonusDays, 3);
  assert.equal(slip.gross, 1425);
  assert.deepEqual([slip.vale, slip.cashAdvance, slip.deductions], [500, 100, 600]);
  assert.equal(slip.net, 825);
  assert.equal(slip.pending.length, 1);
  assert.equal(slip.payday, "2026-11-23");
});

const order = (date, credits) => ({ date, credits, services: [], addOnLines: [] });
const credit = (workerId, workerName, commission) => ({ kind: "service", workerId, workerName, commission, salesAmount: 1 });

test("from the sales: a shared car counts for each worker, and the shop's cars once", () => {
  const orders = [
    order("2026-11-19", [credit("a", "Anjo", 60), credit("b", "Randy", 40), credit("a", "Anjo", 10)]),
    order("2026-11-19", [credit("a", "Anjo", 75)]),
    order("2026-11-25", [credit("a", "Anjo", 999)]), // next week
  ];
  const workers = [
    { id: "a", name: "Anjo", status: "Active" },
    { id: "b", name: "Randy", status: "Active" },
    { id: "c", name: "Idle", status: "Active" },
    { id: "z", name: "Gone", status: "Inactive" },
  ];
  const requests = [{ workerId: "b", workerName: "Randy", kind: "vale", requestDate: "2026-11-20", amount: 100, status: "approved" }];

  const slips = payslipsFor({ orders, workers, settings, requests, start: "2026-11-16" });
  const by = Object.fromEntries(slips.map((slip) => [slip.name, slip]));

  assert.deepEqual(Object.keys(by), ["Anjo", "Idle", "Randy"], "inactive with nothing that week is left out");
  assert.equal(by.Anjo.cars, 2);
  assert.equal(by.Anjo.commission, 145);
  assert.equal(by.Anjo.days[3].shopCars, 2);
  assert.equal(by.Anjo.bonus, 200, "2 cars reached the new quota of 2");
  assert.equal(by.Randy.cars, 1);
  assert.equal(by.Randy.bonus, 200);
  assert.equal(by.Randy.net, 40 + 200 - 100);
  assert.equal(by.Idle.bonus, 0, "did not work that day");
});

test("a worker's own week from the database gives the same payslip", () => {
  const slip = payslipFromWeek({
    start: "2026-11-16",
    quotaSettings: settings,
    requests: [{ kind: "cash_advance", requestDate: "2026-11-16", amount: 50, status: "approved" }],
    days: [
      { date: "2026-11-16", shopCars: 61, cars: 1, commission: 75 },
      ...["17", "18", "19", "20", "21", "22"].map((d) => ({ date: `2026-11-${d}`, shopCars: 0, cars: 0, commission: 0 })),
    ],
  });

  assert.deepEqual([slip.commission, slip.bonus, slip.cashAdvance, slip.net], [75, 150, 50, 175]);
});
