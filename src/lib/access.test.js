import { test } from "node:test";
import assert from "node:assert/strict";
import { accessFor, isSalesWorker } from "./access.js";

const legacy = { installed: false, role: null };
const role = (name) => ({ installed: true, role: name });

test("each role opens exactly the pages the client specified", () => {
  const cases = [
    ["still checking", null, false, [], null],
    ["before roles, signed out", legacy, false, ["form", "login"], "form"],
    ["before roles, signed in", legacy, true, ["form", "dashboard", "records", "workers", "services"], "dashboard"],
    ["signed out", role(null), false, ["login"], "login"],
    ["admin", role("admin"), true, ["dashboard", "records", "workers", "services"], "dashboard"],
    ["secretary", role("secretary"), true, ["records", "workers"], "records"],
    ["worker", role("worker"), true, ["form"], "form"],
    ["login with no active employee", role(null), true, [], null],
  ];

  for (const [name, access, signedIn, pages, home] of cases) {
    const can = accessFor(access, signedIn);
    assert.deepEqual(can.pages, pages, `${name}: pages`);
    assert.equal(can.home, home, `${name}: home page`);
  }
});

test("each role loads and edits only what it can open", () => {
  assert.equal(accessFor(role("admin"), true).pages.includes("form"), false);
  assert.equal(accessFor(role("worker"), true).loadOrders, false);
  assert.equal(accessFor(role("worker"), true).loadWorkers, "mine");
  assert.equal(accessFor(role("worker"), true).seed, false);
  assert.equal(accessFor(role("secretary"), true).editPricing, false);
  assert.equal(accessFor(role("secretary"), true).manageAdmins, false);
  assert.equal(accessFor(role("secretary"), true).editCommission, true);
  assert.equal(accessFor(role(null), false).loadPricing, false);
  assert.equal(accessFor(legacy, false).loadWorkers, "public");
});

test("admins and secretaries are left out of worker lists", () => {
  assert.equal(isSalesWorker({ role: "Worker" }), true);
  assert.equal(isSalesWorker({ role: "Washer" }), true);
  assert.equal(isSalesWorker({ role: "Admin" }), false);
  assert.equal(isSalesWorker({ role: "Secretary" }), false);
});
