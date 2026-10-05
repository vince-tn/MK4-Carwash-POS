import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The function imports supabase-js the Deno way ("npm:..."), which Node
// cannot load. handle() never touches it, so a stand-in will do.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("npm:")) {
      return {
        url: "data:text/javascript,export const createClient = () => {};",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { handle } = await import("./index.ts");

const ADMIN = "00000000-0000-4000-8000-000000000001";
const OTHER_ADMIN = "00000000-0000-4000-8000-000000000002";
const WORKERS = "00000000-0000-4000-8000-000000000003";
const PAUL = "00000000-0000-4000-8000-0000000000aa";

// A shop like the live one: a personal admin login and the shared worker one.
function shop({ role = "admin", users, employees } = {}) {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push([name, ...args]);
    return name === "createUser" ? { id: "new-id" } : undefined;
  };

  return {
    calls,
    deps: {
      callerRole: async () => role,
      callerUserId: async () => ADMIN,
      listUsers: async () =>
        users ?? [
          { id: ADMIN, email: "owner@shop.ph", createdAt: null, lastSignInAt: null },
          { id: WORKERS, email: "worker@mk4.pos", createdAt: null, lastSignInAt: null },
        ],
      listEmployees: async () =>
        employees ?? [
          { id: "e1", name: "Owner", role: "Admin", status: "Active", login_email: "owner@shop.ph" },
          { id: PAUL, name: "Paul", role: "Worker", status: "Active", login_email: "worker@mk4.pos" },
          { id: "e3", name: "Anjo", role: "Worker", status: "Active", login_email: "worker@mk4.pos" },
        ],
      createUser: record("createUser"),
      setPassword: record("setPassword"),
      deleteUser: record("deleteUser"),
      signOutEverywhere: record("signOutEverywhere"),
      linkEmployee: record("linkEmployee"),
    },
  };
}

async function refused(promise, status, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
}

test("only an admin gets anything done", async () => {
  for (const role of ["secretary", "worker", null]) {
    const { deps, calls } = shop({ role });
    await refused(handle({ action: "list" }, deps), 403, /Only an admin/);
    await refused(
      handle({ action: "delete", userId: WORKERS }, deps),
      403,
      /Only an admin/
    );
    assert.deepEqual(calls, [], `${role} changed nothing`);
  }
});

test("the list shows who uses each login", async () => {
  const { deps } = shop();
  const { logins, employees } = await handle({ action: "list" }, deps);

  assert.deepEqual(
    logins.map((login) => [login.email, login.usedBy.map((e) => e.name)]),
    [
      ["owner@shop.ph", ["Owner"]],
      ["worker@mk4.pos", ["Paul", "Anjo"]],
    ]
  );
  assert.equal(employees.length, 3);
  assert.equal(employees[1].loginEmail, "worker@mk4.pos");
});

test("a new login needs a real email, a fair password and a new address", async () => {
  const { deps, calls } = shop();

  await refused(
    handle({ action: "create", email: "nope", password: "longenough" }, deps),
    400,
    /valid email/
  );
  await refused(
    handle({ action: "create", email: "a@b.ph", password: "short" }, deps),
    400,
    /at least 8/
  );
  await refused(
    handle({ action: "create", email: "a@b.ph", password: "x".repeat(73) }, deps),
    400,
    /too long/
  );
  await refused(
    handle({ action: "create", email: " Worker@MK4.pos ", password: "longenough" }, deps),
    409,
    /already exists/
  );
  assert.deepEqual(calls, []);
});

test("a new login is created confirmed and can be linked to an employee", async () => {
  const { deps, calls } = shop();

  const result = await handle(
    { action: "create", email: " Paul@Shop.PH ", password: "longenough", employeeId: PAUL },
    deps
  );

  assert.deepEqual(result, { id: "new-id", email: "paul@shop.ph" });
  assert.deepEqual(calls, [
    ["createUser", "paul@shop.ph", "longenough"],
    ["linkEmployee", PAUL, "paul@shop.ph"],
  ]);
});

test("a link the database refuses is reported, and the login is kept", async () => {
  const { deps } = shop();
  deps.linkEmployee = async () => {
    throw new Error("Everyone on one login must have the same role.");
  };

  await refused(
    handle({ action: "create", email: "new@shop.ph", password: "longenough", employeeId: PAUL }, deps),
    409,
    /login was created, but could not be linked.*same role/
  );
});

test("a new password logs the login out everywhere unless asked not to", async () => {
  const first = shop();
  await handle({ action: "set_password", userId: WORKERS, password: "newpassword" }, first.deps);
  assert.deepEqual(first.calls, [
    ["setPassword", WORKERS, "newpassword"],
    ["signOutEverywhere", WORKERS],
  ]);

  const second = shop();
  await handle(
    { action: "set_password", userId: WORKERS, password: "newpassword", signOut: false },
    second.deps
  );
  assert.deepEqual(second.calls, [["setPassword", WORKERS, "newpassword"]]);

  const third = shop();
  await refused(
    handle({ action: "set_password", userId: WORKERS, password: "short" }, third.deps),
    400,
    /at least 8/
  );
  await refused(
    handle({ action: "set_password", userId: "worker@mk4.pos", password: "newpassword" }, third.deps),
    400,
    /Missing login/
  );
  assert.deepEqual(third.calls, []);
});

test("log out everywhere", async () => {
  const { deps, calls } = shop();
  await handle({ action: "sign_out", userId: WORKERS }, deps);
  assert.deepEqual(calls, [["signOutEverywhere", WORKERS]]);
});

test("deleting keeps at least one way in", async () => {
  const { deps, calls } = shop();

  await refused(handle({ action: "delete", userId: ADMIN }, deps), 409, /login you are using/);

  // Another admin deleting the only admin login.
  deps.callerUserId = async () => OTHER_ADMIN;
  await refused(handle({ action: "delete", userId: ADMIN }, deps), 409, /last admin login/);

  await refused(
    handle({ action: "delete", userId: "00000000-0000-4000-8000-00000000ffff" }, deps),
    404,
    /no longer exists/
  );
  assert.deepEqual(calls, []);

  await handle({ action: "delete", userId: WORKERS }, deps);
  assert.deepEqual(calls, [["deleteUser", WORKERS]]);
});

test("an admin login can go once another admin can still log in", async () => {
  const { deps, calls } = shop({
    users: [
      { id: ADMIN, email: "owner@shop.ph" },
      { id: OTHER_ADMIN, email: "manager@shop.ph" },
    ],
    employees: [
      { id: "e1", name: "Owner", role: "Admin", status: "Active", login_email: "owner@shop.ph" },
      { id: "e2", name: "Manager", role: "Admin", status: "Active", login_email: "manager@shop.ph" },
      // Not a way in: inactive, or a login that does not exist.
      { id: "e4", name: "Old", role: "Admin", status: "Inactive", login_email: "old@shop.ph" },
      { id: "e5", name: "Ghost", role: "Admin", status: "Active", login_email: "ghost@shop.ph" },
    ],
  });

  await handle({ action: "delete", userId: OTHER_ADMIN }, deps);
  assert.deepEqual(calls, [["deleteUser", OTHER_ADMIN]]);
});

test("an unknown action does nothing", async () => {
  const { deps, calls } = shop();
  await refused(handle({ action: "drop_everything" }, deps), 400, /Unknown action/);
  await refused(handle(null, deps), 400, /Unknown action/);
  assert.deepEqual(calls, []);
});
