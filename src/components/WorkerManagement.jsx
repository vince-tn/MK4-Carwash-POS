import { useMemo, useState } from "react";

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

export default function WorkerManagement({
  workers,
  orders,
  onAddWorker,
  onUpdateWorker,
  onDeleteWorker,
  commissionSettings,
  onUpdateCommissionSettings,
}) {
  const today = new Date().toISOString().split("T")[0];

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
                  <div className="form-grid">
                    <label>
                      Worker Name
                      <input
                        value={worker.name}
                        onChange={(e) =>
                          onUpdateWorker(worker.id, { name: e.target.value })
                        }
                      />
                    </label>

                    <label>
                      Role
                      <select
                        value={worker.role}
                        onChange={(e) =>
                          onUpdateWorker(worker.id, { role: e.target.value })
                        }
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
                        value={worker.phone}
                        onChange={(e) =>
                          onUpdateWorker(worker.id, { phone: e.target.value })
                        }
                      />
                    </label>

                    <label>
                      Status
                      <select
                        value={worker.status}
                        onChange={(e) =>
                          onUpdateWorker(worker.id, { status: e.target.value })
                        }
                      >
                        <option>Active</option>
                        <option>Inactive</option>
                      </select>
                    </label>

                    <label>
                      Date Joined
                      <input
                        type="date"
                        value={worker.dateJoined}
                        onChange={(e) =>
                          onUpdateWorker(worker.id, {
                            dateJoined: e.target.value,
                          })
                        }
                      />
                    </label>

                    <label>
                      Commission Rule
                      <select
                        value={worker.commissionMode}
                        onChange={(e) =>
                          onUpdateWorker(worker.id, {
                            commissionMode: e.target.value,
                          })
                        }
                      >
                        <option value="inherit">Use global setting</option>
                        <option value="service_percent">
                          Use service percentage
                        </option>
                        <option value="custom_percent">Custom percentage</option>
                        <option value="flat_per_service">
                          Flat per service
                        </option>
                        <option value="flat_per_order">
                          Flat per sales order
                        </option>
                      </select>
                    </label>

                    <label>
                      Commission Value
                      <input
                        type="number"
                        value={worker.commissionValue}
                        onChange={(e) =>
                          onUpdateWorker(worker.id, {
                            commissionValue: e.target.value,
                          })
                        }
                        disabled={
                          worker.commissionMode === "inherit" ||
                          worker.commissionMode === "service_percent"
                        }
                      />
                    </label>

                    <label className="wide-field">
                      Address
                      <input
                        value={worker.address}
                        onChange={(e) =>
                          onUpdateWorker(worker.id, { address: e.target.value })
                        }
                      />
                    </label>

                    <label className="wide-field">
                      Notes
                      <input
                        value={worker.notes}
                        onChange={(e) =>
                          onUpdateWorker(worker.id, { notes: e.target.value })
                        }
                      />
                    </label>
                  </div>

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