import { Fragment, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { addUp, byEmployee, commissionRow } from "../lib/commissionReport";
import { downloadCSV, getPeriodKey, localDateString, peso } from "../lib/reportUtils";

/*
 * Commission Report, for admins and secretaries (client request, 2026-10-27).
 *
 * What each employee did and earned over a chosen period: their services,
 * their add-ons, and the commission on each, per employee and per sale. The
 * same figures are in Sales Records sale by sale; this puts them together for
 * paying commission, and exports them to CSV with every sale, a subtotal per
 * employee and a grand total. Archived sales are left out, as everywhere.
 */

function presetRange(preset) {
  const today = localDateString();

  if (preset === "today") return { from: today, to: today };
  if (preset === "week") return { from: getPeriodKey(today, "week"), to: today };
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: "", to: "" };
}

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

const listOrDash = (items) => (items.length ? items.join(", ") : "—");

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function CommissionReport({ orders, workers }) {
  const [preset, setPreset] = useState("month");
  const [range, setRange] = useState(() => presetRange("month"));
  const [employeeKey, setEmployeeKey] = useState("all");
  const [openKey, setOpenKey] = useState(null);

  function choosePreset(value) {
    setPreset(value);
    setRange(presetRange(value));
    setOpenKey(null);
  }

  function chooseDate(field, value) {
    setPreset("");
    setRange((prev) => ({ ...prev, [field]: value }));
    setOpenKey(null);
  }

  const rows = useMemo(
    () =>
      orders
        .filter((order) => (!range.from || order.date >= range.from) && (!range.to || order.date <= range.to))
        .map(commissionRow),
    [orders, range]
  );

  const allGroups = useMemo(() => byEmployee(rows), [rows]);

  // Everyone who did a car in the period, plus every current employee, so
  // the choice does not change as the dates do.
  const employeeOptions = useMemo(() => {
    const options = new Map();
    for (const worker of workers) options.set(worker.id, worker.name);
    for (const group of allGroups) if (!options.has(group.key)) options.set(group.key, group.employee);
    return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [workers, allGroups]);

  const groups =
    employeeKey === "all" ? allGroups : allGroups.filter((group) => group.key === employeeKey);
  const totals = addUp(groups.flatMap((group) => group.rows));

  function exportCSV() {
    if (!groups.length) {
      alert("No commission to export for this period.");
      return;
    }

    const money = (value) => Number(value).toFixed(2);
    const headers = [
      "Date",
      "Sales Order",
      "Employee",
      "Plate",
      "Services",
      "Service Amount",
      "Service Commission",
      "Add-ons",
      "Add-on Amount",
      "Add-on Commission",
      "Total Commission",
    ];

    const lines = groups.flatMap((group) => [
      ...group.rows.map((row) => [
        row.date,
        row.salesOrder,
        row.employee,
        row.plate,
        row.services.join("; "),
        money(row.serviceAmount),
        money(row.serviceCommission),
        row.addOns.join("; "),
        money(row.addOnAmount),
        money(row.addOnCommission),
        money(row.commission),
      ]),
      [
        "",
        "",
        `Subtotal: ${group.employee}`,
        count(group.totals.cars, "car", "cars"),
        count(group.totals.serviceCount, "service", "services"),
        money(group.totals.serviceAmount),
        money(group.totals.serviceCommission),
        count(group.totals.addOnCount, "add-on", "add-ons"),
        money(group.totals.addOnAmount),
        money(group.totals.addOnCommission),
        money(group.totals.commission),
      ],
    ]);

    lines.push([
      "",
      "",
      "TOTAL",
      count(totals.cars, "car", "cars"),
      count(totals.serviceCount, "service", "services"),
      money(totals.serviceAmount),
      money(totals.serviceCommission),
      count(totals.addOnCount, "add-on", "add-ons"),
      money(totals.addOnAmount),
      money(totals.addOnCommission),
      money(totals.commission),
    ]);

    const period = range.from || range.to ? `${range.from || "start"}-to-${range.to || "today"}` : "all-time";
    downloadCSV(`mk4-commission-report-${period}.csv`, headers, lines);
  }

  return (
    <section className="dashboard">
      <div className="dashboard-header">
        <div>
          <span className="eyebrow">Commission Report</span>
          <h2>Services, Add-ons and Commission per Employee</h2>
        </div>
      </div>

      <div className="chart-card">
        <div className="dashboard-report">
          <div className="report-controls">
            <div className="toggle-group commission-presets">
              {PRESETS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={preset === option.value ? "active" : ""}
                  onClick={() => choosePreset(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button className="secondary-btn no-margin push-right" onClick={exportCSV}>
              <Download size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              Export CSV
            </button>
          </div>

          <div className="form-grid commission-report-filters">
            <label>
              From
              <input
                type="date"
                value={range.from}
                max={range.to || undefined}
                onChange={(e) => chooseDate("from", e.target.value)}
              />
            </label>

            <label>
              To
              <input
                type="date"
                value={range.to}
                min={range.from || undefined}
                onChange={(e) => chooseDate("to", e.target.value)}
              />
            </label>

            <label>
              Employee
              <select
                value={employeeKey}
                onChange={(e) => {
                  setEmployeeKey(e.target.value);
                  setOpenKey(null);
                }}
              >
                <option value="all">All employees</option>
                {employeeOptions.map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {groups.length === 0 ? (
            <p className="empty">No sales in this period.</p>
          ) : (
            <>
              <p className="report-hint">Click an employee to see each sale behind their figures.</p>

              <div className="table-wrap report-table">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Cars</th>
                      <th>Services</th>
                      <th>Service Amount</th>
                      <th>Service Commission</th>
                      <th>Add-ons</th>
                      <th>Add-on Amount</th>
                      <th>Add-on Commission</th>
                      <th>Total Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => {
                      const isOpen = openKey === group.key;

                      return (
                        <Fragment key={group.key}>
                          <tr
                            className={`report-row${isOpen ? " is-open" : ""}`}
                            onClick={() => setOpenKey(isOpen ? null : group.key)}
                            aria-expanded={isOpen}
                          >
                            <td>
                              <strong>
                                <span className="report-caret">{isOpen ? "▾" : "▸"}</span>
                                {group.employee}
                              </strong>
                            </td>
                            <td>{group.totals.cars}</td>
                            <td>{group.totals.serviceCount}</td>
                            <td>{peso.format(group.totals.serviceAmount)}</td>
                            <td>{peso.format(group.totals.serviceCommission)}</td>
                            <td>{group.totals.addOnCount}</td>
                            <td>{peso.format(group.totals.addOnAmount)}</td>
                            <td>{peso.format(group.totals.addOnCommission)}</td>
                            <td>
                              <strong>{peso.format(group.totals.commission)}</strong>
                            </td>
                          </tr>

                          {isOpen && (
                            <tr className="report-detail-row">
                              <td colSpan={9}>
                                <div className="report-detail">
                                  <table>
                                    <thead>
                                      <tr>
                                        <th>Date</th>
                                        <th>Sales Order</th>
                                        <th>Plate</th>
                                        <th>Services</th>
                                        <th>Add-ons</th>
                                        <th>Service Commission</th>
                                        <th>Add-on Commission</th>
                                        <th>Commission</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.rows.map((row) => (
                                        <tr key={row.key}>
                                          <td>{row.date || "—"}</td>
                                          <td>{row.salesOrder}</td>
                                          <td>
                                            <strong>{row.plate || "—"}</strong>
                                          </td>
                                          <td>
                                            {listOrDash(row.services)}
                                            {row.serviceAmount > 0 && <small> ({peso.format(row.serviceAmount)})</small>}
                                          </td>
                                          <td>
                                            {listOrDash(row.addOns)}
                                            {row.addOnAmount > 0 && <small> ({peso.format(row.addOnAmount)})</small>}
                                          </td>
                                          <td>{peso.format(row.serviceCommission)}</td>
                                          <td>{peso.format(row.addOnCommission)}</td>
                                          <td>{peso.format(row.commission)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}

                    <tr className="report-total-row">
                      <td>Total</td>
                      <td>{totals.cars}</td>
                      <td>{totals.serviceCount}</td>
                      <td>{peso.format(totals.serviceAmount)}</td>
                      <td>{peso.format(totals.serviceCommission)}</td>
                      <td>{totals.addOnCount}</td>
                      <td>{peso.format(totals.addOnAmount)}</td>
                      <td>{peso.format(totals.addOnCommission)}</td>
                      <td>{peso.format(totals.commission)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
