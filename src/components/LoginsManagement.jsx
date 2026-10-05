import { useEffect, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import { manageLogins } from "../lib/db";

/*
 * Admin only: the logins people use to get in, with who uses each one.
 *
 * A login opens what its employees' role allows (lib/access). Workers share
 * worker@mk4.pos and secretaries share secretary@mk4.pos unless their Login
 * Email on the Employees page says otherwise. Everything here goes through
 * the admin-logins Edge Function (db.manageLogins), which checks again that
 * the caller is an admin and keeps the last admin login from being deleted.
 */

const when = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

const BLANK_LOGIN = { email: "", password: "", employeeId: "" };

function plural(role, count) {
  if (count === 1) return role;
  return role === "Secretary" ? "Secretaries" : `${role}s`;
}

// What the login opens, in a few words. Everyone on one login has the same
// role (15), so the first active employee's role is the login's.
function describe(login) {
  const active = login.usedBy.filter((employee) => employee.status === "Active");

  if (!active.length) return "Opens nothing: no active employee uses it";
  if (active.length === 1) return `${active[0].name}, ${active[0].role}`;
  return `Shared by ${active.length} ${plural(active[0].role, active.length)}`;
}

export default function LoginsManagement({
  currentUserId,
  onSignedOutSelf,
  onEmployeesChanged,
}) {
  const [logins, setLogins] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [newLogin, setNewLogin] = useState(BLANK_LOGIN);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordFor, setPasswordFor] = useState(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signOutToo, setSignOutToo] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null);

  // Bumped to fetch the list again.
  const [listVersion, setListVersion] = useState(0);

  useEffect(() => {
    let current = true;

    manageLogins("list")
      .then((result) => {
        if (!current) return;
        setLogins(result.logins);
        setEmployees(result.employees);
        setLoadError(null);
      })
      .catch((error) => {
        if (!current) return;
        console.error("Could not load the logins", error);
        setLoadError(error);
      });

    return () => {
      current = false;
    };
  }, [listVersion]);

  function reload() {
    setListVersion((version) => version + 1);
  }

  // Runs one change, says how it went, and reloads the list either way: a
  // create can succeed and its employee link still fail.
  async function run(key, action, args, done) {
    setBusy(key);
    setNotice(null);

    try {
      await manageLogins(action, args);
      setNotice({ ok: true, text: done });
      return true;
    } catch (error) {
      console.error(`Could not ${action} the login`, error);
      setNotice({ ok: false, text: error.message });
      return false;
    } finally {
      reload();
      setBusy(null);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();

    const email = newLogin.email.trim().toLowerCase();
    const employee = employees.find((item) => item.id === newLogin.employeeId);

    const created = await run(
      "create",
      "create",
      { email, password: newLogin.password, employeeId: newLogin.employeeId || null },
      employee
        ? `Login ${email} created. ${employee.name} logs in with it from now on.`
        : `Login ${email} created. Put it as an employee's Login Email on the Employees page to give it access.`
    );

    if (employee) onEmployeesChanged();

    if (created) {
      setNewLogin(BLANK_LOGIN);
      setShowNewPassword(false);
    }
  }

  function openPassword(login) {
    setPasswordFor(login.id);
    setPassword("");
    setShowPassword(false);
    setSignOutToo(true);
    setNotice(null);
  }

  async function handleSetPassword(e, login) {
    e.preventDefault();

    const isMine = login.id === currentUserId;
    const changed = await run(
      `password-${login.id}`,
      "set_password",
      { userId: login.id, password, signOut: signOutToo },
      signOutToo
        ? `Password changed for ${login.email}. Every device using it is logged out within the hour and needs the new password.`
        : `Password changed for ${login.email}. Devices already logged in stay logged in.`
    );

    if (!changed) return;
    setPasswordFor(null);
    setPassword("");

    if (isMine && signOutToo) {
      alert("Your password was changed. Log in again with the new password.");
      onSignedOutSelf();
    }
  }

  async function handleSignOut(login) {
    const isMine = login.id === currentUserId;
    const confirmed = window.confirm(
      `Log ${login.email} out on every device?${
        isMine ? " That includes this one." : ""
      }\n\nAnyone using it needs the password to log in again. Devices are logged out within the hour.`
    );

    if (!confirmed) return;

    const done = await run(
      `signout-${login.id}`,
      "sign_out",
      { userId: login.id },
      `${login.email} is logged out on every device within the hour.`
    );

    if (done && isMine) onSignedOutSelf();
  }

  function askDelete(login) {
    const active = login.usedBy.filter((employee) => employee.status === "Active");
    const names = active.map((employee) => employee.name);

    setPendingDelete({
      login,
      details: [
        names.length
          ? `Used by ${names.slice(0, 8).join(", ")}${
              names.length > 8 ? ` and ${names.length - 8} more` : ""
            }`
          : "No active employee uses it",
        "Devices using it are logged out within the hour",
        "Sales and employees are not touched",
      ],
      message: names.length
        ? `${names.length === 1 ? "This employee" : `These ${names.length} employees`} cannot log in until a login with this email is created again. Creating it again here gives them back the same access.`
        : "Nobody active uses this login.",
    });
  }

  async function confirmDelete() {
    const { login } = pendingDelete;

    await run(
      `delete-${login.id}`,
      "delete",
      { userId: login.id },
      `Login ${login.email} deleted.`
    );

    setPendingDelete(null);
  }

  if (loadError && !logins) {
    return (
      <section className="workers-page">
        <div className="form-card">
          {loadError.notSetUp ? (
            <>
              <h2>Login management is not set up yet</h2>
              <p className="small-note">
                It needs a one-time setup in Supabase: deploy the
                admin-logins Edge Function and run
                supabase/17_sign_out_everywhere.sql (README, "Logins page").
                Until then, logins are managed in Supabase under
                Authentication, Users.
              </p>
            </>
          ) : (
            <>
              <h2>Could not load the logins</h2>
              <p className="small-note">{loadError.message}</p>
            </>
          )}

          <button type="button" className="submit-btn" onClick={reload}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  if (!logins) {
    return (
      <div className="form-card">
        <h2>Loading logins...</h2>
      </div>
    );
  }

  return (
    <section className="workers-page">
      {pendingDelete && (
        <ConfirmModal
          title={`Delete ${pendingDelete.login.email}?`}
          message={pendingDelete.message}
          details={pendingDelete.details}
          confirmLabel="Delete login"
          isBusy={busy === `delete-${pendingDelete.login.id}`}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      <div className="dashboard-header">
        <div>
          <span className="eyebrow">Admin Setup</span>
          <h2>Logins</h2>
        </div>

        <div className="quota-pill">
          <span>Logins</span>
          <strong>{logins.length}</strong>
        </div>
      </div>

      {notice && (
        <div className={notice.ok ? "login-notice" : "warning-card no-margin"} role="status">
          {notice.text}
        </div>
      )}

      <div className="settings-grid">
        <form className="form-card" onSubmit={handleCreate}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">New Login</span>
              <h2>Add Login</h2>
            </div>
          </div>

          <div className="form-grid">
            <label>
              Email
              <input
                type="email"
                autoComplete="off"
                value={newLogin.email}
                onChange={(e) =>
                  setNewLogin((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="name@mk4.pos"
                required
              />
            </label>

            <label>
              Password
              <input
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                value={newLogin.password}
                onChange={(e) =>
                  setNewLogin((prev) => ({ ...prev, password: e.target.value }))
                }
                placeholder="At least 8 characters"
                required
              />
            </label>

            <label className="wide-field">
              Who logs in with it
              <select
                value={newLogin.employeeId}
                onChange={(e) =>
                  setNewLogin((prev) => ({ ...prev, employeeId: e.target.value }))
                }
              >
                <option value="">Nobody yet</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name} ({employee.role}
                    {employee.status === "Active" ? "" : ", inactive"})
                    {employee.loginEmail ? `, uses ${employee.loginEmail}` : ""}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Moves that employee onto this login, the same as changing
                their Login Email on the Employees page.
              </span>
            </label>

            <label className="check-label">
              <input
                type="checkbox"
                checked={showNewPassword}
                onChange={(e) => setShowNewPassword(e.target.checked)}
              />
              Show password
            </label>
          </div>

          <button className="submit-btn" type="submit" disabled={busy !== null}>
            {busy === "create" ? "Creating..." : "Add Login"}
          </button>
        </form>

        <div className="form-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">How Logins Work</span>
              <h2>One login, one role</h2>
            </div>
          </div>

          <div className="info-card no-margin">
            <p>
              A login opens what its employees&apos; role allows. Workers
              share <b>worker@mk4.pos</b> and secretaries share{" "}
              <b>secretary@mk4.pos</b>; each admin has their own.
            </p>
            <p>
              To give someone a login of their own, add it here and choose
              them under &quot;Who logs in with it&quot;.
            </p>
            <p>
              When someone leaves, set them Inactive on the Employees page. If
              they knew a shared password, change it here: that logs every
              device out, and the shop logs back in with the new one.
            </p>
          </div>
        </div>
      </div>

      <div className="worker-list">
        {logins.map((login) => {
          const isMine = login.id === currentUserId;
          const editing = passwordFor === login.id;

          return (
            <details className="worker-profile" key={login.id}>
              <summary>
                <div>
                  <strong>
                    {login.email}
                    {isMine ? " (you)" : ""}
                  </strong>
                  <span>{describe(login)}</span>
                </div>

                <div className="worker-summary-stats">
                  <span>
                    Last login:{" "}
                    {login.lastSignInAt
                      ? when.format(new Date(login.lastSignInAt))
                      : "never"}
                  </span>
                </div>
              </summary>

              <div className="worker-profile-body">
                <p className="small-note login-used-by">
                  {login.usedBy.length
                    ? `Used by: ${login.usedBy
                        .map((employee) =>
                          employee.status === "Active"
                            ? `${employee.name} (${employee.role})`
                            : `${employee.name} (${employee.role}, inactive)`
                        )
                        .join(", ")}`
                    : "No employee has this as their Login Email, so it opens nothing."}
                </p>

                {editing ? (
                  <form
                    className="login-password-form"
                    onSubmit={(e) => handleSetPassword(e, login)}
                  >
                    <label>
                      New password for {login.email}
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        required
                        autoFocus
                      />
                    </label>

                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={showPassword}
                        onChange={(e) => setShowPassword(e.target.checked)}
                      />
                      Show password
                    </label>

                    <label className="check-label login-wrap">
                      <input
                        type="checkbox"
                        checked={signOutToo}
                        onChange={(e) => setSignOutToo(e.target.checked)}
                      />
                      Log it out on every device{isMine ? ", this one too" : ""}
                    </label>

                    <div className="action-row">
                      <button
                        type="submit"
                        className="table-action-btn"
                        disabled={busy !== null}
                      >
                        {busy === `password-${login.id}` ? "Saving..." : "Save Password"}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setPasswordFor(null)}
                        disabled={busy !== null}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="action-row">
                    <button
                      type="button"
                      className="table-action-btn"
                      onClick={() => openPassword(login)}
                      disabled={busy !== null}
                    >
                      Change Password
                    </button>

                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => handleSignOut(login)}
                      disabled={busy !== null}
                    >
                      {busy === `signout-${login.id}`
                        ? "Logging out..."
                        : "Log Out Everywhere"}
                    </button>

                    {isMine ? (
                      <span className="field-hint">
                        This is your login, so it cannot be deleted here.
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() => askDelete(login)}
                        disabled={busy !== null}
                      >
                        Delete Login
                      </button>
                    )}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
