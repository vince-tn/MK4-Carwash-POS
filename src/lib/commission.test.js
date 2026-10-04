import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateCommission, centavos } from "./commission.js";

const globalServicePercent = { globalMode: "service_percent", globalValue: 0 };
const inherit = { commissionMode: "inherit", commissionValue: 0 };
const wash = (price, rate = 30) => ({ price, commissionRate: rate });
const addOn = (price, rate) => ({ price, commissionRate: rate, commission: centavos(price * (rate / 100)) });

test("service percentage plus add-ons, as the client specified", () => {
  // Premium Wash 200 @ 30%, Spray 200 @ 30%, Wheel Decontamination 1000 @ 12%,
  // Premium Shampoo 50 @ 0%.
  const result = calculateCommission({
    services: [wash(200)],
    addOnLines: [addOn(200, 30), addOn(1000, 12), addOn(50, 0)],
    worker: inherit,
    commissionSettings: globalServicePercent,
  });

  assert.deepEqual(result.serviceCommissions, [60]);
  assert.equal(result.commission, 240);
  assert.equal(result.label, "Service percentage + add-ons");
});

test("labor only: the add-on's rate on the amount the worker entered", () => {
  const result = calculateCommission({
    services: [wash(200)],
    addOnLines: [addOn(800, 12)],
    worker: inherit,
    commissionSettings: globalServicePercent,
  });

  assert.equal(result.commission, 60 + 96);
});

test("no add-on commission keeps the plain label", () => {
  const result = calculateCommission({
    services: [wash(250)],
    addOnLines: [addOn(50, 0)],
    worker: inherit,
    commissionSettings: globalServicePercent,
  });

  assert.equal(result.commission, 75);
  assert.equal(result.label, "Service percentage");
});

test("flat per order belongs to the order, not to any service line", () => {
  const result = calculateCommission({
    services: [wash(200), wash(500)],
    addOnLines: [],
    worker: { commissionMode: "flat_per_order", commissionValue: 100 },
    commissionSettings: globalServicePercent,
  });

  assert.deepEqual(result.serviceCommissions, [0, 0]);
  assert.equal(result.commission, 100);
  assert.match(result.label, /^Flat per order: /);
});

test("flat per service pays the amount once per service", () => {
  const result = calculateCommission({
    services: [wash(200), wash(500), wash(900)],
    addOnLines: [],
    worker: { commissionMode: "flat_per_service", commissionValue: 50 },
    commissionSettings: globalServicePercent,
  });

  assert.deepEqual(result.serviceCommissions, [50, 50, 50]);
  assert.equal(result.commission, 150);
});

test("custom percentage ignores each service's own rate", () => {
  const result = calculateCommission({
    services: [wash(250, 30), wash(300, 20)],
    addOnLines: [],
    worker: { commissionMode: "custom_percent", commissionValue: 40 },
    commissionSettings: globalServicePercent,
  });

  assert.deepEqual(result.serviceCommissions, [100, 120]);
  assert.equal(result.commission, 220);
});

test("a worker on the global rule follows the global setting", () => {
  const result = calculateCommission({
    services: [wash(200), wash(300)],
    addOnLines: [],
    worker: inherit,
    commissionSettings: { globalMode: "flat_per_service", globalValue: 25 },
  });

  assert.equal(result.commission, 50);
});

test("the breakdown always adds up to the total, to the centavo", () => {
  const result = calculateCommission({
    services: [wash(333, 12), wash(1250, 30)],
    addOnLines: [addOn(333, 12), addOn(777, 30)],
    worker: inherit,
    commissionSettings: globalServicePercent,
  });

  const lines =
    result.serviceCommissions.reduce((sum, amount) => sum + amount, 0) +
    centavos(333 * 0.12) +
    centavos(777 * 0.3);

  assert.equal(result.commission, centavos(lines));
});
