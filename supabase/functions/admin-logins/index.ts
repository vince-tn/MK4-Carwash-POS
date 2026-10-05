// Admin-only login management for the MK4 POS: list logins, create one,
// change a password, sign a login out everywhere, delete one.
//
// Creating logins and setting passwords needs Supabase's secret key, which
// must never reach the browser, so it happens in this Edge Function. Every
// request is checked first: the caller's own login must belong to an active
// Admin (my_access, the same check the database uses), or nothing happens.
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function ->
// Via Editor, name it "admin-logins", paste this whole file, Deploy. Then
// switch off "Verify JWT with legacy secret" in its details: this function
// checks the caller itself, and that setting can refuse valid logins on
// projects using the newer signing keys. Needs 17_sign_out_everywhere.sql.
//
// The rules live in handle() below, apart from the Supabase calls, so they
// can be tested without deploying (admin-logins.test.js, `npm test`).

import { createClient } from "npm:@supabase/supabase-js@2";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type AuthUser = {
  id: string;
  email: string;
  createdAt: string | null;
  lastSignInAt: string | null;
};

export type Employee = {
  id: string;
  name: string;
  role: string;
  status: string;
  login_email: string | null;
};

export type Deps = {
  callerRole: () => Promise<string | null>;
  callerUserId: () => Promise<string | null>;
  listUsers: () => Promise<AuthUser[]>;
  listEmployees: () => Promise<Employee[]>;
  createUser: (email: string, password: string) => Promise<{ id: string }>;
  setPassword: (userId: string, password: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  signOutEverywhere: (userId: string) => Promise<void>;
  linkEmployee: (employeeId: string, email: string) => Promise<void>;
};

const lower = (value: string | null | undefined) => (value || "").trim().toLowerCase();

function checkEmail(value: unknown): string {
  const email = lower(String(value ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address for the login.");
  }
  return email;
}

// Supabase stores passwords with bcrypt, which reads at most 72 bytes.
function checkPassword(value: unknown): string {
  const password = String(value ?? "");
  if (password.length < 8) {
    throw new HttpError(400, "Use a password of at least 8 characters.");
  }
  if (new TextEncoder().encode(password).length > 72) {
    throw new HttpError(400, "That password is too long (72 bytes at most).");
  }
  return password;
}

function checkId(value: unknown, what: string): string {
  const id = String(value ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, `Missing ${what}.`);
  return id;
}

// Each login with the employees on it, and every employee for the "link to"
// choice when creating a login.
async function list(deps: Deps) {
  const [users, employees] = await Promise.all([deps.listUsers(), deps.listEmployees()]);

  return {
    logins: users
      .map((user) => ({
        ...user,
        usedBy: employees
          .filter((employee) => lower(employee.login_email) === lower(user.email))
          .map(({ id, name, role, status }) => ({ id, name, role, status })),
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    employees: employees.map(({ id, name, role, status, login_email }) => ({
      id,
      name,
      role,
      status,
      loginEmail: login_email || "",
    })),
  };
}

async function create(args: Record<string, unknown>, deps: Deps) {
  const email = checkEmail(args.email);
  const password = checkPassword(args.password);
  const employeeId = args.employeeId ? checkId(args.employeeId, "employee") : null;

  const users = await deps.listUsers();
  if (users.some((user) => lower(user.email) === email)) {
    throw new HttpError(409, "A login with that email already exists.");
  }

  const { id } = await deps.createUser(email, password);

  if (employeeId) {
    try {
      await deps.linkEmployee(employeeId, email);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(
        409,
        `The login was created, but could not be linked to that employee: ${message}`
      );
    }
  }

  return { id, email };
}

async function setPassword(args: Record<string, unknown>, deps: Deps) {
  const userId = checkId(args.userId, "login");
  const password = checkPassword(args.password);

  await deps.setPassword(userId, password);

  // A new password does not end sessions already open, so a device that was
  // logged in would carry on. Signing out everywhere makes the change bite.
  if (args.signOut !== false) await deps.signOutEverywhere(userId);

  return { ok: true };
}

async function signOut(args: Record<string, unknown>, deps: Deps) {
  await deps.signOutEverywhere(checkId(args.userId, "login"));
  return { ok: true };
}

async function remove(args: Record<string, unknown>, deps: Deps) {
  const userId = checkId(args.userId, "login");
  const [users, employees, callerId] = await Promise.all([
    deps.listUsers(),
    deps.listEmployees(),
    deps.callerUserId(),
  ]);

  const target = users.find((user) => user.id === userId);
  if (!target) throw new HttpError(404, "That login no longer exists.");

  if (userId === callerId) {
    throw new HttpError(409, "You cannot delete the login you are using.");
  }

  // Logins that can still open the admin pages: an active Admin employee is
  // linked to them and the login exists.
  const existing = new Set(users.map((user) => lower(user.email)));
  const adminLogins = new Set(
    employees
      .filter(
        (employee) =>
          employee.role === "Admin" &&
          employee.status === "Active" &&
          existing.has(lower(employee.login_email))
      )
      .map((employee) => lower(employee.login_email))
  );

  if (adminLogins.has(lower(target.email)) && adminLogins.size === 1) {
    throw new HttpError(
      409,
      "This is the last admin login. Create another admin login first."
    );
  }

  await deps.deleteUser(userId);
  return { ok: true };
}

export async function handle(body: unknown, deps: Deps) {
  if ((await deps.callerRole()) !== "admin") {
    throw new HttpError(403, "Only an admin can manage logins.");
  }

  const args = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  switch (args.action) {
    case "list":
      return list(deps);
    case "create":
      return create(args, deps);
    case "set_password":
      return setPassword(args, deps);
    case "sign_out":
      return signOut(args, deps);
    case "delete":
      return remove(args, deps);
    default:
      throw new HttpError(400, "Unknown action.");
  }
}

// ---------------------------------------------------------------- Supabase

// Only runs on Supabase (Deno). The tests import handle() above without it.
if (typeof Deno !== "undefined") {
  const ALLOWED_ORIGINS = [
    "https://mk-4-carwash-pos.vercel.app",
    "http://localhost:5173",
    "http://localhost:4173",
  ];

  // The new-style keys arrive as a JSON object; the legacy ones as strings.
  const firstKey = (name: string): string | null => {
    try {
      const keys: Record<string, string> = JSON.parse(Deno.env.get(name) ?? "{}");
      return keys.default ?? Object.values(keys)[0] ?? null;
    } catch {
      return null;
    }
  };

  const url = Deno.env.get("SUPABASE_URL")!;
  const publicKey = firstKey("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
  const secretKey = firstKey("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const reply = (status: number, body: unknown, origin: string) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
      },
    });

  Deno.serve(async (req: Request) => {
    const origin = req.headers.get("origin") ?? "";
    if (req.method === "OPTIONS") return reply(200, { ok: true }, origin);
    if (req.method !== "POST") return reply(405, { error: "Use POST." }, origin);

    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return reply(401, { error: "Log in first." }, origin);

    // As the caller, so the database's own rules apply: their role, and the
    // employee records an admin may read and change.
    const caller = createClient(url, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // With the secret key: the auth admin API, which only this file uses.
    const admin = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const fail = (error: { message: string } | null, status = 400) => {
      if (error) throw new HttpError(status, error.message);
    };

    const deps: Deps = {
      callerRole: async () => {
        const { data, error } = await caller.rpc("my_access");
        return error ? null : data?.role ?? null;
      },
      callerUserId: async () => {
        const { data } = await admin.auth.getUser(token);
        return data?.user?.id ?? null;
      },
      listUsers: async () => {
        const users: AuthUser[] = [];
        for (let page = 1; ; page += 1) {
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
          fail(error, 500);
          users.push(
            ...data.users.map((user) => ({
              id: user.id,
              email: user.email ?? "",
              createdAt: user.created_at ?? null,
              lastSignInAt: user.last_sign_in_at ?? null,
            }))
          );
          if (data.users.length < 200) break;
        }
        return users;
      },
      listEmployees: async () => {
        const { data, error } = await caller
          .from("workers")
          .select("id, name, role, status, login_email")
          .order("name");
        fail(error, 500);
        return data ?? [];
      },
      createUser: async (email, password) => {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        fail(error);
        return { id: data.user.id };
      },
      setPassword: async (userId, password) => {
        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        fail(error);
      },
      deleteUser: async (userId) => {
        const { error } = await admin.auth.admin.deleteUser(userId);
        fail(error);
      },
      signOutEverywhere: async (userId) => {
        const { error } = await admin.rpc("sign_out_everywhere", { p_user_id: userId });
        fail(error, 500);
      },
      linkEmployee: async (employeeId, email) => {
        const { data, error } = await caller
          .from("workers")
          .update({ login_email: email })
          .eq("id", employeeId)
          .select("id");
        fail(error);
        if (!data?.length) throw new HttpError(404, "That employee no longer exists.");
      },
    };

    try {
      const body = await req.json().catch(() => ({}));
      return reply(200, await handle(body, deps), origin);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Something went wrong.";
      return reply(status, { error: message }, origin);
    }
  });
}
