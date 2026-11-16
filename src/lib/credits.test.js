import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateCommission, creditSale, shareOut } from "./commission.js";
import { creditsOf, totalsByWorker, workerNames, workerParts } from "./credits.js";

const settings = { globalMode: "service_percent", globalValue: 0 };
const workers = new Map([
  ["a", { id: "a", name: "Anjo", commissionMode: "inherit", commissionValue: 0 }],
  ["b", { id: "b", name: "Randy", commissionMode: "inherit", commissionValue: 0 }],
  ["f", { id: "f", name: "Fred", commissionMode: "flat_per_order", commissionValue: 50 }],
  ["s", { id: "s", name: "Sam", commissionMode: "flat_per_service", commissionValue: 40 }],
]);

const service = (price, assignments, rate = 30) => ({ price, commissionRate: rate, assignments });

test("shares follow the step weights, or split equally when every weight is 0", () => {
  assert.deepEqual(
    shareOut([{ workerId: "a", weight: 60 }, { workerId: "b", weight: 40 }]).map((p) => p.share),
    [0.6, 0.4]
  );
  assert.deepEqual(
    shareOut([{ workerId: "a" }, { workerId: "b" }, { workerId: "s" }]).map((p) => p.share),
    [1 / 3, 1 / 3, 1 / 3]
  );
  assert.deepEqual(shareOut([{ workerId: "" }]), [], "a step nobody did earns nobody anything");
});

test("one worker on everything earns exactly what the single-worker maths gives", () => {
  const single = calculateCommission({
    services: [{ price: 250, commissionRate: 30 }, { price: 1000, commissionRate: 20 }],
    addOnLines: [{ price: 200, commissionRate: 30, commission: 60 }],
    worker: workers.get("a"),
    commissionSettings: settings,
  });

  const split = creditSale({
    services: [service(250, [{ workerId: "a" }]), service(1000, [{ workerId: "a" }], 20)],
    addOnLines: [{ price: 200, commissionRate: 30, workerId: "a" }],
    workersById: workers,
    commissionSettings: settings,
  });

  assert.equal(split.commission, single.commission);
  assert.equal(split.label, single.label);
  assert.deepEqual(split.services.map((s) => s.commission), single.serviceCommissions);
});

test("a package split by its steps: each worker earns their step's share", () => {
  // 1000 @ 30% = 300: Interior 60% -> 180, Exterior 40% -> 120.
  const result = creditSale({
    services: [
      service(1000, [
        { workerId: "a", process: "Interior", weight: 60 },
        { workerId: "b", process: "Exterior", weight: 40 },
      ]),
    ],
    addOnLines: [],
    workersById: workers,
    commissionSettings: settings,
  });

  const [line] = result.services;
  assert.deepEqual(
    line.credits.map((c) => [c.workerName, c.process, c.share, c.salesAmount, c.commission]),
    [
      ["Anjo", "Interior", 0.6, 600, 180],
      ["Randy", "Exterior", 0.4, 400, 120],
    ]
  );
  assert.equal(result.commission, 300);
});

test("each helper is paid under their own rule; flat per order once per sale", () => {
  // Anjo 250 @ 30% / 2 = 37.50; Sam flat 40 / 2 = 20; Fred flat 50 for the sale.
  const result = creditSale({
    services: [service(250, [{ workerId: "a" }, { workerId: "s" }]), service(100, [{ workerId: "f" }])],
    addOnLines: [{ price: 300, commissionRate: 10, workerId: "f" }],
    workersById: workers,
    commissionSettings: settings,
  });

  assert.deepEqual(result.services[0].credits.map((c) => c.commission), [37.5, 20]);
  assert.equal(result.services[1].commission, 0);
  assert.deepEqual(result.saleCredits.map((c) => [c.workerName, c.commission]), [["Fred", 50]]);
  assert.equal(result.addOnLines[0].credits[0].workerName, "Fred");
  assert.equal(result.commission, 37.5 + 20 + 50 + 30);
  assert.equal(result.label, "Mixed worker rules + add-ons");

  const again = creditSale({
    services: [service(100, [{ workerId: "f" }])],
    addOnLines: [],
    workersById: workers,
    commissionSettings: settings,
    alreadyFlat: ["f"],
  });
  assert.deepEqual(again.saleCredits, [], "already paid the flat amount on this sale");
});

const sale = (fields) => ({
  id: "SO-1",
  workerId: "a",
  washerName: "Anjo",
  services: [],
  addOnLines: [],
  paymentEnabled: { cash: true },
  cash: 0,
  balance: 0,
  commission: 0,
  ...fields,
});

test("a sale recorded before 25 is all its worker's", () => {
  const order = sale({
    services: [{ id: "s1", price: 250, commission: 75 }],
    addOnLines: [{ id: "x1", price: 100, commission: 10 }],
    commission: 135,
  });

  assert.deepEqual(
    creditsOf(order).map((c) => [c.kind, c.workerName, c.commission]),
    [
      ["service", "Anjo", 75],
      ["addon", "Anjo", 10],
      ["sale", "Anjo", 50],
    ]
  );
  const [part] = workerParts(order);
  assert.equal(part.commission, 135);
  assert.equal(part.share, 1);
});

test("splitting a sale by worker never adds or loses a peso of Total Sales", () => {
  const order = sale({
    cash: 900,
    balance: 100,
    commission: 300,
    credits: [
      { kind: "service", workerId: "a", workerName: "Anjo", salesAmount: 600, commission: 180 },
      { kind: "service", workerId: "b", workerName: "Randy", salesAmount: 300, commission: 90 },
      { kind: "addon", workerId: "b", workerName: "Randy", salesAmount: 100, commission: 30 },
    ],
  });

  const totals = [...totalsByWorker([order]).values()];
  assert.deepEqual(totals.map((t) => [t.name, t.cars, t.commission]), [
    ["Anjo", 1, 180],
    ["Randy", 1, 120],
  ]);
  assert.equal(totals.reduce((sum, t) => sum + t.sales, 0), 1000);
  assert.equal(totals[0].sales, 600);
  assert.equal(workerNames(order), "Anjo, Randy");
});
