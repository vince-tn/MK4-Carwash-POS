import { useMemo, useState } from "react";
import WorkerReports from "./WorkerReports";
import { localDateString } from "../lib/reportUtils";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

function createWorkerId(name) {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `worker-${safeName}-${Date.now()}`;
}

function getWorkerStats(workerId, orders) {
  const workerOrders = orders.filter((order) => order.workerId === workerId);

  return {
    cars: workerOrders.length,
    sales: workerOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    commission: workerOrders.reduce(
      (sum, order) => sum + Number(order.commission || 0),
      0
    ),
    latestOrder: workerOrders[0]?.date || "No sales yet",
  };
}

/*
 * One worker's editable fields. Typed fields are held in a local draft and
 * saved when the field loses focus: saving on every keystroke sent a request
 * per letter, and a late reply could overwrite what had been typed since.
 * Dropdowns and the date are single choices, so they save straight away.
 */
function WorkerProfileFields({ worker, onUpdateWorker }) {
  const [draft, setDraft] = useState(worker);

  function edit(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function commit(field) {
    if (draft[field] === worker[field]) return;

    // A worker needs a name; put the saved one back rather than store a blank.
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
      value: draft[field],
      onChange: (e) => edit(field, e.target.value),
      onBlur: () => commit(field),
    };
  }

  return (
    <div className="form-grid">
      <label>
        Worker Name
        <input {...textProps("name")} />
      </label>

      <label>
        Role
        <select
          value={draft.role}
          onChange={(e) => choose("role", e.target.value)}
        >
          <option>Washer</option>
          <option>Detailer</option>
          <option>Manager</option>
          <option>Cashier</option>
          <option>Other</option>
        </select>
      </label>

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
}) {
  const today = localDateString();

  const [newWorker, setNewWorker] = useState({
    name: "",
    role: "Washer",
    phone: "",
    address: "",
    status: "Active",
    dateJoined: today,
    notes: "",
    commissionMode: "inherit",
    commissionValue: "",
  });

  const activeWorkers = useMemo(() => {
    return workers.filter((worker) => worker.status === "Active");
  }, [workers]);

  function updateNewWorker(field, value) {
    setNewWorker((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleAddWorker(e) {
    e.preventDefault();

    if (!newWorker.name.trim()) {
      alert("Please enter the worker name.");
      return;
    }

    onAddWorker({
      ...newWorker,
      id: createWorkerId(newWorker.name),
      name: newWorker.name.trim(),
    });

    setNewWorker({
      name: "",
      role: "Washer",
      phone: "",
      address: "",
      status: "Active",
      dateJoined: today,
      notes: "",
      commissionMode: "inherit",
      commissionValue: "",
    });
  }

  return (
    <section className="workers-page">
      <div className="dashboard-header">
        <div>
          <span className="eyebrow">Admin Setup</span>
          <h2>Workers and Commission Rules</h2>
        </div>

        <div className="quota-pill">
          <span>Active Workers</span>
          <strong>{activeWorkers.length}</strong>
        </div>
      </div>

      <div className="settings-grid">
        <form className="form-card" onSubmit={handleAddWorker}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">Worker Registry</span>
              <h2>Add Worker</h2>
            </div>
          </div>

          <div className="form-grid">
            <label>
              Worker Name
              <input
                type="text"
                value={newWorker.name}
                onChange={(e) => updateNewWorker("name", e.target.value)}
                placeholder="Worker name"
              />
            </label>

            <label>
              Role
              <select
                value={newWorker.role}
                onChange={(e) => updateNewWorker("role", e.target.value)}
              >
                <option>Washer</option>
                <option>Detailer</option>
                <option>Manager</option>
                <option>Cashier</option>
                <option>Other</option>
              </select>
            </label>

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
            Add Worker
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

        <WorkerReports orders={orders} workers={workers} />
      </div>

      <div className="worker-list">
        {workers.length === 0 ? (
          <div className="empty-card">No workers yet.</div>
        ) : (
          workers.map((worker) => {
            const stats = getWorkerStats(worker.id, orders);

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

                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => onDeleteWorker(worker.id)}
                  >
                    Delete Worker
                  </button>
                </div>
              </details>
            );
          })
        )}
      </div>
    </section>
  );
}