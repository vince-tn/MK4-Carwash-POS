import { Fragment, useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  peso,
  getPeriodKey,
  formatPeriodLabel,
  periodOptions,
  downloadCSV,
} from "../lib/reportUtils";

function sumPayment(orders, method) {
  return orders.reduce(
    (sum, order) =>
      sum + (order.paymentEnabled?.[method] ? Number(order[method]) || 0 : 0),
    0
  );
}

function describeServices(order) {
  const services = (order.services || [])
    .map((service) => service.category)
    .filter(Boolean);

  const addOns = order.selectedAddOns || [];

  return [...services, ...addOns].join(", ") || "—";
}

/*
 * Mode-specific expanded reports for the Admin Dashboard stat boxes.
 * - sales: payment method breakdown (Cash / GCash / Credit / Discounts) per period
 * - cars: cars washed per period, broken down by car type
 * - commission: commission per worker per period
 *
 * Period rows are clickable. Opening one lists the individual cars behind the
 * totals with their plate, car type and customer, so any figure in the report
 * can be traced back to the real orders that produced it.
 */
export default function DashboardReport({ orders, mode }) {
  const [period, setPeriod] = useState("day");
  const [expandedPeriod, setExpandedPeriod] = useState(null);

  function changePeriod(value) {
    setPeriod(value);
    // Period keys differ per grouping, so an open row would not survive.
    setExpandedPeriod(null);
  }

  function toggleRow(key) {
    setExpandedPeriod((prev) => (prev === key ? null : key));
  }

  const report = useMemo(() => {
    const grouped = {};

    orders.forEach((order) => {
      const key = getPeriodKey(order.date, period);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(order);
    });

    const periodKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

    if (mode === "sales") {
      const columns = [
        { label: "Period" },
        { label: "Cars" },
        { label: "Cash", money: true },
        { label: "GCash", money: true },
        { label: "Credit", money: true },
        { label: "Discounts", money: true },
        { label: "Total Sales", money: true },
      ];

      const rows = periodKeys.map((key) => {
        const periodOrders = grouped[key];

        return [
          formatPeriodLabel(key, period),
          periodOrders.length,
          sumPayment(periodOrders, "cash"),
          sumPayment(periodOrders, "gcash"),
          sumPayment(periodOrders, "credit"),
          sumPayment(periodOrders, "discount"),
          // Money actually taken, matching the Total Sales tile this report
          // expands from: the three payment columns to the left added up.
          sumPayment(periodOrders, "cash") +
            sumPayment(periodOrders, "gcash") +
            sumPayment(periodOrders, "credit"),
        ];
      });

      return { columns, rows, filename: "sales-report", grouped, periodKeys };
    }

    if (mode === "cars") {
      const carTypes = [
        ...new Set(orders.map((order) => order.carType || "Unspecified")),
      ];

      const columns = [
        { label: "Period" },
        { label: "Total Cars" },
        ...carTypes.map((type) => ({ label: type })),
      ];

      const rows = periodKeys.map((key) => {
        const periodOrders = grouped[key];

        return [
          formatPeriodLabel(key, period),
          periodOrders.length,
          ...carTypes.map(
            (type) =>
              periodOrders.filter(
                (order) => (order.carType || "Unspecified") === type
              ).length
          ),
        ];
      });

      return { columns, rows, filename: "cars-report", grouped, periodKeys };
    }

    // commission
    const workerNames = [
      ...new Set(orders.map((order) => order.washerName || "Unknown")),
    ];

    const columns = [
      { label: "Period" },
      ...workerNames.map((name) => ({ label: name, money: true })),
      { label: "Total Commission", money: true },
    ];

    const rows = periodKeys.map((key) => {
      const periodOrders = grouped[key];

      const perWorker = workerNames.map((name) =>
        periodOrders
          .filter((order) => (order.washerName || "Unknown") === name)
          .reduce((sum, order) => sum + Number(order.commission || 0), 0)
      );

      return [
        formatPeriodLabel(key, period),
        ...perWorker,
        periodOrders.reduce(
          (sum, order) => sum + Number(order.commission || 0),
          0
        ),
      ];
    });

    return { columns, rows, filename: "commission-report", grouped, periodKeys };
  }, [orders, mode, period]);

  const totalsRow = useMemo(() => {
    if (report.rows.length === 0) return null;

    return report.columns.map((column, index) => {
      if (index === 0) return "Total";

      return report.rows.reduce(
        (sum, row) => sum + (Number(row[index]) || 0),
        0
      );
    });
  }, [report]);

  function exportCSV() {
    if (report.rows.length === 0) {
      alert("No report data to export.");
      return;
    }

    const headers = report.columns.map((column) => column.label);

    const csvRows = report.rows.map((row) =>
      row.map((value, index) =>
        report.columns[index].money ? Number(value).toFixed(2) : value
      )
    );

    if (totalsRow) {
      csvRows.push(
        totalsRow.map((value, index) =>
          index === 0
            ? value
            : report.columns[index].money
              ? Number(value).toFixed(2)
              : value
        )
      );
    }

    const date = new Date().toISOString().split("T")[0];
    downloadCSV(
      `mk4-${report.filename}-per-${period}-${date}.csv`,
      headers,
      csvRows
    );
  }

  return (
    <div className="dashboard-report">
      <div className="report-controls">
        <div className="toggle-group">
          {periodOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              className={period === option.value ? "active" : ""}
              onClick={() => changePeriod(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          className="secondary-btn no-margin push-right"
          onClick={exportCSV}
        >
          <Download
            size={15}
            style={{ verticalAlign: "-2px", marginRight: 6 }}
          />
          Export Report CSV
        </button>
      </div>

      {report.rows.length === 0 ? (
        <p className="empty">No sales data for this report yet.</p>
      ) : (
        <>
          <p className="report-hint">
            Click any row to see the cars behind the totals.
          </p>

          <div className="table-wrap report-table">
            <table>
              <thead>
                <tr>
                  {report.columns.map((column) => (
                    <th key={column.label}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, rowIndex) => {
                  const periodKey = report.periodKeys[rowIndex];
                  const isOpen = expandedPeriod === periodKey;
                  const periodOrders = report.grouped[periodKey] || [];

                  return (
                    <Fragment key={periodKey}>
                      <tr
                        className={`report-row${isOpen ? " is-open" : ""}`}
                        onClick={() => toggleRow(periodKey)}
                        aria-expanded={isOpen}
                      >
                        {row.map((value, index) => (
                          <td key={report.columns[index].label}>
                            {index === 0 ? (
                              <strong>
                                <span className="report-caret">
                                  {isOpen ? "▾" : "▸"}
                                </span>
                                {value}
                              </strong>
                            ) : report.columns[index].money ? (
                              peso.format(value)
                            ) : (
                              value
                            )}
                          </td>
                        ))}
                      </tr>

                      {isOpen && (
                        <tr className="report-detail-row">
                          <td colSpan={report.columns.length}>
                            <div className="report-detail">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Date</th>
                                    <th>Plate</th>
                                    <th>Car Type</th>
                                    <th>Customer</th>
                                    <th>Contact</th>
                                    <th>Worker</th>
                                    <th>Services &amp; Add-ons</th>
                                    <th>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {periodOrders.map((order) => (
                                    <tr key={order.id}>
                                      <td>{order.date || "—"}</td>
                                      <td>
                                        <strong>
                                          {order.plateNumber || "—"}
                                        </strong>
                                      </td>
                                      <td>{order.carType || "—"}</td>
                                      <td>{order.customerName || "—"}</td>
                                      <td>{order.contactNumber || "—"}</td>
                                      <td>{order.washerName || "—"}</td>
                                      <td>{describeServices(order)}</td>
                                      <td>
                                        {peso.format(Number(order.total) || 0)}
                                      </td>
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

                {totalsRow && (
                  <tr className="report-total-row">
                    {totalsRow.map((value, index) => (
                      <td key={report.columns[index].label}>
                        {index === 0
                          ? value
                          : report.columns[index].money
                            ? peso.format(value)
                            : value}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
