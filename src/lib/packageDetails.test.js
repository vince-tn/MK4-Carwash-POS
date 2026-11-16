import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detailCommissions,
  detailsProblem,
  detailsToSave,
  equalShares,
  isCustomSplit,
} from "./packageDetails.js";

const details = (shares) =>
  shares.map((sharePercent, i) => ({ id: `d${i}`, name: `Detail ${i + 1}`, sharePercent }));

test("an equal split in whole percentages adds up to 100", () => {
  assert.deepEqual(equalShares(3), [34, 33, 33]);
  assert.deepEqual(equalShares(4), [25, 25, 25, 25]);
  assert.deepEqual(equalShares(0), []);
});

test("shares of 0 everywhere are an equal split", () => {
  assert.equal(isCustomSplit(details([0, 0, 0])), false);
  assert.equal(isCustomSplit(details([40, 40, 20])), true);
});

test("set % per detail must add up to exactly 100", () => {
  assert.equal(detailsProblem({ mode: "custom", details: details([40, 40, 20]) }), "");
  assert.match(detailsProblem({ mode: "custom", details: details([40, 40, 10]) }), /add up to 90%/);
  assert.match(detailsProblem({ mode: "custom", details: details([40, "", 60]) }), /0% or more/);
  assert.equal(detailsProblem({ mode: "equal", details: details([40, 40, 10]) }), "", "ignored when split equally");
  assert.match(
    detailsProblem({ mode: "equal", details: [{ id: "x", name: "  ", sharePercent: 0 }] }),
    /needs a name/
  );
});

test("an equal split is stored as shares of 0", () => {
  assert.deepEqual(
    detailsToSave({ mode: "equal", details: details([40, 40, 20]) }).map((d) => d.sharePercent),
    [0, 0, 0]
  );
  assert.deepEqual(
    detailsToSave({ mode: "custom", details: details([40, 40, 20]) }).map((d) => d.sharePercent),
    [40, 40, 20]
  );
});

test("the peso amount per detail, for each size", () => {
  const category = {
    commissionRate: 20,
    items: [
      { size: "Medium", price: 5000 },
      { size: "Large", price: 6000 },
    ],
  };

  assert.deepEqual(detailCommissions(category, { mode: "custom", details: details([40, 40, 20]) }), [
    { size: "Medium", commission: 1000, details: [400, 400, 200] },
    { size: "Large", commission: 1200, details: [480, 480, 240] },
  ]);
  assert.deepEqual(
    detailCommissions(category, { mode: "equal", details: details([0, 0, 0]) })[0].details,
    [333.33, 333.33, 333.33]
  );
});
