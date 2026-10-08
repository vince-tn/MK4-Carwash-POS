import { useMemo, useState } from "react";
import WorkerReports from "./WorkerReports";
import { localDateString } from "../lib/reportUtils";
import { isSalesWorker } from "../lib/access";
import { moneyTaken } from "../lib/totals";

const ROLES = ["Admin", "Secretary", "Worker"];

/*
 * The roles a login can be given. Only admins may make someone an Admin (the
 * database refuses it otherwise). A record still carrying an old job title
 * from before roles (Washer, Manager...) keeps it as an extra option until
 * it is changed.
 */
function RoleOptions({ current, manageAdmins }) {
  const roles = ROLES.filter(
    (role) => role !== "Admin" || manageAdmins || current === "Admin"
  );

  return (
    <>
      {current && !roles.includes(current) && <option>{current}</option>}
      {roles.map((role) => (
        <option key={role}>{role}</option>
      ))}
    </>
  );
}

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

function createWorkerId(name) {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `worker-${safeName}-${Date.now()}`;
}

const NO_SALES = { cars: 0, sales: 0, commission: 0, latestOrder: "No sales yet" };

/*
 * Every employee's totals from one pass over the sales. This used to filter
 * all sales once per employee on every render, including each keystroke in
 * the Add Employee form, which grows with employees times sales. Sales arrive
 * newest first, so an employee's first sale seen is their latest.
 */
function statsByWorker(orders) {
  const stats = new Map();

  orders.forEach((order) => {
    let entry = stats.get(order.workerId);

    if (!entry) {
      entry = {
        cars: 0,
        sales: 0,
        commission: 0,
        latestOrder: order.date || "No sales yet",
      };
      stats.set(order.workerId, entry);
    }

    entry.cars += 1;
    entry.sales += moneyTaken(order);
    entry.commission += Number(order.commission || 0);
  });

  return stats;
}

/*
 * One employee's editable fields. Typed fields are held in a local draft and
 * saved when the field loses focus: saving on every keystroke sent a request
 * per letter, and a late reply could overwrite what had been typed since.
 * Dropdowns and the date are single choices, so they save straight away.
 *
 * locked: an Admin's record seen by a secretary. Shown, not editable.
 */
function WorkerProfileFields({ worker, onUpdateWorker, rolesOn, manageAdmins, locked }) {
  const [draft, setDraft] = useState(worker);

  function edit(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function commit(field) {
    if (draft[field] === worker[field]) return;

    // An employee needs a name; put the saved one back rather than store a blank.
    if (field === "name" && !String(draft.name).trim()) {
      edit("name", worker.name);
      return;
    }

    onUpdateWorker(worker.id, { [field]: draft[field] });
  }

  function choose(field, value) {
    edit(field, value);
    onUpdateWorker(worker.id, { [field]: value });
  }

  function textProps(field) {
    return {
      value: draft[field] ?? "",
      onChange: (e) => edit(field, e.target.value),
      onBlur: () => commit(field),
      disabled: locked,
    };
  }

  return (
    <fieldset className="profile-fieldset" disabled={locked}>
    <div className="form-grid">
      <label>
        Employee Name
        <input {...textProps("name")} />
      </label>

      <label>
        Role
        <select
          value={draft.role}
          onChange={(e) => choose("role", e.target.value)}
        >
          <RoleOptions current={draft.role} manageAdmins={manageAdmins} />
        </select>
      </label>

      {rolesOn && (
        <label>
          Login Email
          <input
            type="email"
            placeholder="Blank: the shared login for their role"
            {...textProps("loginEmail")}
          />
        </label>
      )}

      <label>
        Phone
        <input {...textProps("phone")} />
      </label>

      <label>
        Status
        <select
          value={draft.status}
          onChange={(e) => choose("status", e.target.value)}
        >
          <option>Active</option>
          <option>Inactive</option>
        </select>
      </label>

      <label>
        Date Joined
        <input
          type="date"
          value={draft.dateJoined}
          onChange={(e) => choose("dateJoined", e.target.value)}
        />
      </label>

      <label>
        Commission Rule
        <select
          value={draft.commissionMode}
          onChange={(e) => choose("commissionMode", e.target.value)}
        >
          <option value="inherit">Use global setting</option>
          <option value="service_percent">Use service percentage</option>
          <option value="custom_percent">Custom percentage</option>
          <option value="flat_per_service">Flat per service</option>
          <option value="flat_per_order">Flat per sales order</option>
        </select>
      </label>

      <label>
        Commission Value
        <input
          type="number"
          {...textProps("commissionValue")}
          disabled={
            draft.commissionMode === "inherit" ||
            draft.commissionMode === "service_percent"
          }
        />
      </label>

      <label className="wide-field">
        Address
        <input {...textProps("address")} />
      </label>

      <label className="wide-field">
        Notes
        <input {...textProps("notes")} />
      </label>
    </div>
    </fieldset>
  );
}

export default function WorkerManagement({
  workers,
  orders,
  onAddWorker,
  onUpdateWorker,
  onDeleteWorker,
  commissionSettings,
  onUpdateCommissionSettings,
  rolesOn = false,
  manageAdmins = true,
}) {
  const today = localDateString();

  // loginEmail only exists once roles are on (supabase/14); before that the
  // column is not there to save into.
  function blankEmployee() {
    return {
      name: "",
      role: "Worker",
      phone: "",
      address: "",
      status: "Active",
      dateJoined: today,
      notes: "",
      commissionMode: "inherit",
      commissionValue: "",
      ...(rolesOn ? { loginEmail: "" } : {}),
    };
  }

  const [newWorker, setNewWorker] = useState(blankEmployee);

  const activeWorkers = useMemo(() => {
    return workers.filter((worker) => worker.status === "Active");
  }, [workers]);

  const workerStats = useMemo(() => statsByWorker(orders), [orders]);

  function updateNewWorker(field, value) {
    setNewWorker((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleAddWorker(e) {
    e.preventDefault();

    if (!newWorker.name.trim()) {
      alert("Please enter the employee's name.");
      return;
    }

    onAddWorker({
      ...newWorker,
      id: createWorkerId(newWorker.name),
      name: newWorker.name.trim(),
    });

    setNewWorker(blankEmployee());
  }

  return (
    <section className="workers-page">
      <div className="dashboard-header">
        <div>
          <span className="eyebrow">Admin Setup</span>
          <h2>Employees and Commission Rules</h2>
        </div>

        <div className="quota-pill">
          <span>Active Employees</span>
          <strong>{activeWorkers.length}</strong>
        </div>
      </div>

      <div className="settings-grid">
        <form className="form-card" onSubmit={handleAddWorker}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">Employee Registry</span>
              <h2>Add Employee</h2>
            </div>
          </div>

          <div className="form-grid">
            <label>
              Employee Name
              <input
                type="text"
                value={newWorker.name}
                onChange={(e) => updateNewWorker("name", e.target.value)}
                placeholder="Employee name"
              />
            </label>

            <label>
              Role
              <select
                value={newWorker.role}
                onChange={(e) => updateNewWorker("role", e.target.value)}
              >
                <RoleOptions current={newWorker.role} manageAdmins={manageAdmins} />
              </select>
            </label>

            {rolesOn && (
              <label>
                Login Email
                <input
                  type="email"
                  value={newWorker.loginEmail}
                  onChange={(e) => updateNewWorker("loginEmail", e.target.value)}
                  placeholder="Blank: the shared login for their role"
                />
              </label>
            )}

            <label>
              Phone
              <input
                type="text"
                value={newWorker.phone}
                onChange={(e) => updateNewWorker("phone", e.target.value)}
                placeholder="Optional"
              />
            </label>

            <label>
              Status
              <select
                value={newWorker.status}
                onChange={(e) => updateNewWorker("status", e.target.value)}
              >
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </label>

            <label>
              Date Joined
              <input
                type="date"
                value={newWorker.dateJoined}
                onChange={(e) => updateNewWorker("dateJoined", e.target.value)}
              />
            </label>

            <label>
              Commission Rule
              <select
                value={newWorker.commissionMode}
                onChange={(e) =>
                  updateNewWorker("commissionMode", e.target.value)
                }
              >
                <option value="inherit">Use global setting</option>
                <option value="service_percent">Use service percentage</option>
                <option value="custom_percent">Custom percentage</option>
                <option value="flat_per_service">Flat per service</option>
                <option value="flat_per_order">Flat per sales order</option>
              </select>
            </label>

            <label>
              Commission Value
              <input
                type="number"
                value={newWorker.commissionValue}
                onChange={(e) =>
                  updateNewWorker("commissionValue", e.target.value)
                }
                placeholder="Example: 100 or 20"
                disabled={
                  newWorker.commissionMode === "inherit" ||
                  newWorker.commissionMode === "service_percent"
                }
              />
            </label>

            <label className="wide-field">
              Notes
              <input
                type="text"
                value={newWorker.notes}
                onChange={(e) => updateNewWorker("notes", e.target.value)}
                placeholder="Optional notes"
              />
            </label>
          </div>

          <button className="submit-btn" type="submit">
            Add Employee
          </button>
        </form>

        <div className="form-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Global Commission</span>
              <h2>Default Rule</h2>
            </div>
          </div>

          <div className="form-grid single-column">
            <label>
              Global Commission Mode
              <select
                value={commissionSettings.globalMode}
                onChange={(e) =>
                  onUpdateCommissionSettings({
                    ...commissionSettings,
                    globalMode: e.target.value,
                  })
                }
              >
                <option value="service_percent">
                  Use service percentage from price list
                </option>
                <option value="custom_percent">Custom percentage</option>
                <option value="flat_per_service">Flat per service</option>
                <option value="flat_per_order">Flat per sales order</option>
              </select>
            </label>

            <label>
              Global Commission Value
              <input
                type="number"
                value={commissionSettings.globalValue}
                onChange={(e) =>
                  onUpdateCommissionSettings({
                    ...commissionSettings,
                    globalValue: e.target.value,
                  })
                }
                placeholder="Example: 100 or 20"
                disabled={commissionSettings.globalMode === "service_percent"}
              />
            </label>
          </div>

          <div className="info-card">
            <strong>Commission rule guide</strong>
            <p>
              If they mean “1 person = ₱100 commission,” use{" "}
              <b>Flat per sales order</b> or <b>Flat per service</b>. If each
              service has its own percentage, use <b>service percentage</b>.
              Individual worker rules can override this global rule.
            </p>
          </div>
        </div>
      </div>

      <div className="form-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Worker Reports</span>
            <h2>Performance per Day, Week and Month</h2>
          </div>
        </div>

        <WorkerReports orders={orders} workers={workers.filter(isSalesWorker)} />
      </div>

      <div className="worker-list">
        {workers.length === 0 ? (
          <div className="empty-card">No employees yet.</div>
        ) : (
          workers.map((worker) => {
            const stats = workerStats.get(worker.id) || NO_SALES;
            const locked = worker.role === "Admin" && !manageAdmins;

            return (
              <details className="worker-profile" key={worker.id}>
                <summary>
                  <div>
                    <strong>{worker.name}</strong>
                    <span>
                      {worker.role} • {worker.status}
                    </span>
                  </div>

                  <div className="worker-summary-stats">
                    <span>{stats.cars} cars</span>
                    <span>{peso.format(stats.sales)}</span>
                    <span>{peso.format(stats.commission)} commission</span>
                  </div>
                </summary>

                <div className="worker-profile-body">
                  <WorkerProfileFields
                    worker={worker}
                    onUpdateWorker={onUpdateWorker}
                    rolesOn={rolesOn}
                    manageAdmins={manageAdmins}
                    locked={locked}
                  />

                  <div className="worker-stat-grid">
                    <div>
                      <span>Total Cars</span>
                      <strong>{stats.cars}</strong>
                    </div>
                    <div>
                      <span>Total Sales</span>
                      <strong>{peso.format(stats.sales)}</strong>
                    </div>
                    <div>
                      <span>Total Commission</span>
                      <strong>{peso.format(stats.commission)}</strong>
                    </div>
                    <div>
                      <span>Latest Sale</span>
                      <strong>{stats.latestOrder}</strong>
                    </div>
                  </div>

                  {locked ? (
                    <p className="field-hint">
                      Only an admin can change or remove an admin.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={() => onDeleteWorker(worker.id)}
                    >
                      Delete Employee
                    </button>
                  )}
                </div>
              </details>
            );
          })
        )}
      </div>
    </section>
  );
}