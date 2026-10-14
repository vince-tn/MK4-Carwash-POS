import test from "node:test";
import assert from "node:assert/strict";

import { summarise, moneyTaken, amountFor } from "./totals.js";

function sale(fields) {
  return {
    paymentEnabled: {
      cash: false,
      gcash: false,
      credit: false,
      bank: false,
      discount: false,
    },
    cash: "",
    gcash: "",
    credit: "",
    bank: "",
    discount: "",
    balance: 0,
    commission: 0,
    total: 0,
    ...fields,
  };
}

test("an amount only counts when its box was ticked", () => {
  const untouched = sale({ cash: 500 });
  assert.equal(amountFor(untouched, "cash"), 0);

  const taken = sale({
    paymentEnabled: { cash: true },
    cash: 500,
  });
  assert.equal(amountFor(taken, "cash"), 500);
});

test("money taken adds the four payment methods, not the discount", () => {
  const split = sale({
    paymentEnabled: { cash: true, gcash: true, credit: true, bank: true, discount: true },
    cash: 100,
    gcash: 200,
    credit: 300,
    bank: 400,
    discount: 50,
  });

  assert.equal(moneyTaken(split), 1000);
});

test("a sale from before bank existed still totals correctly", () => {
  // Rows written before the bank column have no "bank" key at all.
  const old = {
    paymentEnabled: { cash: true, gcash: true },
    cash: 8410,
    gcash: 3480,
    balance: 0,
    commission: 0,
  };

  assert.equal(moneyTaken(old), 11890);
});

test("the discount and an unpaid balance are reported, never folded in", () => {
  const discounted = sale({
    paymentEnabled: { cash: true, discount: true },
    cash: 220,
    discount: 80,
    balance: 0,
  });

  const partPaid = sale({
    paymentEnabled: { cash: true },
    cash: 100,
    balance: 160,
  });

  const totals = summarise([discounted, partPaid]);

  assert.equal(totals.sales, 320, "sales is what was taken");
  assert.equal(totals.discount, 80, "discount reported separately");
  assert.equal(totals.balance, 160, "unpaid reported separately");
  assert.equal(totals.cars, 2);
});

test("the shop's own figures for 2026-10-07 come out right", () => {
  // 38 cars, 8,410 cash and 3,480 GCash: 11,890 taken, with 280 of discount
  // given and 160 still owed. These are the live numbers the change was
  // checked against.
  const orders = [
    sale({ paymentEnabled: { cash: true }, cash: 8410 }),
    sale({ paymentEnabled: { gcash: true }, gcash: 3480 }),
    sale({ paymentEnabled: { discount: true }, discount: 280 }),
    sale({ balance: 160 }),
  ];

  const totals = summarise(orders);

  assert.equal(totals.sales, 11890);
  assert.equal(totals.cash, 8410);
  assert.equal(totals.gcash, 3480);
  assert.equal(totals.discount, 280);
  assert.equal(totals.balance, 160);
});

test("no sales totals zero rather than throwing", () => {
  const totals = summarise([]);

  assert.equal(totals.sales, 0);
  assert.equal(totals.cars, 0);
  assert.equal(totals.balance, 0);
});

test("payments made after the sale count by their own method", () => {
  // 1,000 billed: 300 cash at the sale, then 500 GCash and 200 bank later.
  const paidOff = sale({
    paymentEnabled: { cash: true },
    cash: 300,
    payments: [
      { method: "gcash", amount: 500, paidAt: "2026-10-15T02:00:00Z" },
      { method: "bank", amount: 200, paidAt: "2026-10-16T02:00:00Z" },
    ],
  });

  assert.equal(amountFor(paidOff, "cash"), 300);
  assert.equal(amountFor(paidOff, "gcash"), 500);
  assert.equal(amountFor(paidOff, "bank"), 200);
  assert.equal(moneyTaken(paidOff), 1000);

  const totals = summarise([paidOff]);
  assert.equal(totals.sales, 1000);
  assert.equal(totals.gcash, 500);
});

test("a removed later payment stops counting", () => {
  const corrected = sale({
    paymentEnabled: { cash: true },
    cash: 300,
    payments: [
      { method: "cash", amount: 200, removedAt: "2026-10-15T03:00:00Z" },
      { method: "cash", amount: 150 },
    ],
  });

  assert.equal(amountFor(corrected, "cash"), 450);
  assert.equal(moneyTaken(corrected), 450);
});

test("a later payment never counts as a discount, and no box need be ticked", () => {
  const laterOnly = sale({
    payments: [{ method: "gcash", amount: 250 }],
  });

  assert.equal(amountFor(laterOnly, "discount"), 0);
  assert.equal(amountFor(laterOnly, "gcash"), 250);
  assert.equal(summarise([laterOnly]).sales, 250);
});

test("sales from before later payments existed total exactly as before", () => {
  const before = sale({
    paymentEnabled: { cash: true, gcash: true },
    cash: 8410,
    gcash: 3480,
  });

  assert.equal(moneyTaken(before), 11890);
  assert.equal(moneyTaken({ ...before, payments: [] }), 11890);
});
