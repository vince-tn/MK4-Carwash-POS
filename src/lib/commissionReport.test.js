import { test } from "node:test";
import assert from "node:assert/strict";
import { addUp, byEmployee, commissionRow } from "./commissionReport.js";

const sale = (fields) => ({
  id: "SO-1",
  dbId: "1",
  date: "2026-10-20",
  washerName: "Anjo",
  workerId: "w1",
  plateNumber: "ABC 123",
  services: [],
  addOnLines: [],
  commission: 0,
  ...fields,
});

test("a sale's commission splits into services and add-ons, and they add back up", () => {
  // Premium Wash 200 @ 30% = 60, Spray 200 @ 30% = 60, Labor 800 @ 12% = 96.
  const row = commissionRow(
    sale({
      services: [{ category: "Premium Wash", size: "Medium", price: 200, commission: 60 }],
      addOnLines: [
        { name: "Spray", price: 200, commission: 60 },
        { name: "Labor", price: 800, commission: 96, details: "Buffing" },
      ],
      commission: 216,
    })
  );

  assert.deepEqual(row.services, ["Premium Wash - Medium"]);
  assert.deepEqual(row.addOns, ["Spray", "Labor: Buffing"]);
  assert.equal(row.serviceAmount, 200);
  assert.equal(row.addOnAmount, 1000);
  assert.equal(row.serviceCommission, 60);
  assert.equal(row.addOnCommission, 156);
  assert.equal(row.serviceCommission + row.addOnCommission, row.commission);
});

test("a flat per-order amount is counted with the services", () => {
  const row = commissionRow(
    sale({
      services: [{ category: "Wash", size: "Small", price: 150, commission: 0 }],
      addOnLines: [{ name: "Wax", price: 100, commission: 12 }],
      commission: 112,
    })
  );

  assert.equal(row.serviceCommission, 100);
  assert.equal(row.addOnCommission, 12);
});

test("each employee's figures add up, and the report total matches every sale", () => {
  const rows = [
    commissionRow(sale({ dbId: "1", id: "SO-1", commission: 60, services: [{ category: "A", size: "S", price: 200, commission: 60 }] })),
    commissionRow(sale({ dbId: "2", id: "SO-2", date: "2026-10-19", commission: 30, services: [{ category: "B", size: "S", price: 100, commission: 30 }] })),
    commissionRow(sale({ dbId: "3", id: "SO-3", washerName: "Randy", workerId: "w2", commission: 120 })),
  ];

  const groups = byEmployee(rows);

  assert.deepEqual(groups.map((group) => group.employee), ["Randy", "Anjo"], "highest commission first");
  assert.deepEqual(groups[1].rows.map((row) => row.salesOrder), ["SO-2", "SO-1"], "oldest sale first");
  assert.equal(groups[1].totals.cars, 2);
  assert.equal(groups[1].totals.commission, 90);
  assert.equal(addUp(rows).commission, 210);
});

test("a sale whose worker was deleted is still reported under their name", () => {
  const row = commissionRow(sale({ workerId: "", washerName: "Former Worker", commission: 50 }));
  const [group] = byEmployee([row]);

  assert.equal(group.employee, "Former Worker");
  assert.equal(group.totals.commission, 50);
});
