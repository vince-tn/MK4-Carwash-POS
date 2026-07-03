import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  peso,
  csvSafe,
  getPeriodKey,
  formatPeriodLabel,
  periodOptions,
} from "../lib/reportUtils";

export default function WorkerReports({
  orders,
  workers,
  initialView = "summary",
  initialWorkerId = "",
}) {
  const [view, setView] = useState(initialView);
  const [period, setPeriod] = useState("day");
  const [workerId, setWorkerId] = useState(
    initialWorkerId || workers[0]?.id || ""
  );

  const selectedWorker = workers.find((worker) => worker.id === workerId);

  const relevantOrders = useMemo(() => {
    if (view === "individual") {
      return orders.filter((order) => order.workerId === workerId);
    }
    return orders;
  }, [orders, view, workerId]);

  const periodRows = useMemo(() => {
    const map = {};

    relevantOrders.forEach((order) => {
      const key = getPeriodKey(order.date, period);

      if (!map[key]) {
        map[key] = { key, cars: 0, sales: 0, commission: 0, workerTotals: {} };
      }

      map[key].cars += 1;
      map[key].sales += Number(order.total || 0);
      map[key].commission += Number(order.commission || 0);

      const name = order.washerName || "Unknown";
      map[key].workerTotals[name] =
        (map[key].workerTotals[name] || 0) + Number(order.total || 0);
    });

    return Object.values(map)
      .map((row) => ({
        ...row,
        topWorker:
          Object.entries(row.workerTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "—",
      }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [relevantOrders, period]);

  const totals = useMemo(() => {
    return periodRows.reduce(
      (acc, row) => ({
        cars: acc.cars + row.cars,
        sales: acc.sales + row.sales,
        commission: acc.commission + row.commission,
      }),
      { cars: 0, sales: 0, commission: 0 }
    );
  }, [periodRows]);

  const workerTotals = useMemo(() => {
    const map = {};

    orders.forEach((order) => {
      const name = order.washerName || "Unknown";

      if (!map[name]) {
        map[name] = { name, cars: 0, sales: 0, commission: 0 };
      }

      map[name].cars += 1;
      map[name].sales += Number(order.total || 0);
      map[name].commission += Number(order.commission || 0);
    });

    return Object.values(map).sort((a, b) => b.sales - a.sales);
  }, [orders]);

  function exportReportCSV() {
    if (periodRows.length === 0) {
      alert("No report data to export.");
      return;
    }

    const reportName =
      view === "individual"
        ? `${selectedWorker?.name || "worker"}`
        : "all-workers";

    const headers =
      view === "summary"
        ? ["Period", "Cars", "Sales", "Commission", "Top Worker"]
        : ["Period", "Worker", "Cars", "Sales", "Commission"];

    const rows = periodRows.map((row) =>
      view === "summary"
        ? [
            formatPeriodLabel(row.key, period),
            row.cars,
            row.sales.toFixed(2),
            row.commission.toFixed(2),
            row.topWorker,
          ]
        : [
            formatPeriodLabel(row.key, period),
            selectedWorker?.name || "Unknown",
            row.cars,
            row.sales.toFixed(2),
            row.commission.toFixed(2),
          ]
    );

    const totalRow =
      view === "summary"
        ? [
            "TOTAL",
            totals.cars,
            totals.sales.toFixed(2),
            totals.commission.toFixed(2),
            "",
          ]
        : [
            "TOTAL",
            selectedWorker?.name || "Unknown",
            totals.cars,
            totals.sales.toFixed(2),
            totals.commission.toFixed(2),
          ];

    const csvContent = [
      headers.map(csvSafe).join(","),
      ...rows.map((row) => row.map(csvSafe).join(",")),
      totalRow.map(csvSafe).join(","),
    ].join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];

    link.href = url;
    link.download = `mk4-worker-report-${reportName}-per-${period}-${date}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="worker-reports">
      <div className="report-header">
        <h3>
          {view === "summary"
            ? "Worker Summary Report"
            : `Individual Report — ${selectedWorker?.name || "Select worker"}`}
        </h3>

        <button className="secondary-btn no-margin" onClick={exportReportCSV}>
          <Download size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Export Report CSV
        </button>
      </div>

      <div className="report-controls">
        <div className="toggle-group">
          <button
            type="button"
            className={view === "summary" ? "active" : ""}
            onClick={() => setView("summary")}
          >
            Summary
          </button>
          <button
            type="button"
            className={view === "individual" ? "active" : ""}
            onClick={() => setView("individual")}
          >
            Individual
          </button>
        </div>

        <div className="toggle-group">
          {periodOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              className={period === option.value ? "active" : ""}
              onClick={() => setPeriod(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {view === "individual" && (
          <label>
            Worker
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
            >
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {periodRows.length === 0 ? (
        <p className="empty">No sales data for this report yet.</p>
      ) : (
        <div className="table-wrap report-table">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Cars</th>
                <th>Sales</th>
                <th>Commission</th>
                {view === "summary" && <th>Top Worker</th>}
              </tr>
            </thead>
            <tbody>
              {periodRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <strong>{formatPeriodLabel(row.key, period)}</strong>
                  </td>
                  <td>{row.cars}</td>
                  <td>{peso.format(row.sales)}</td>
                  <td>{peso.format(row.commission)}</td>
                  {view === "summary" && <td>{row.topWorker}</td>}
                </tr>
              ))}

              <tr className="report-total-row">
                <td>Total</td>
                <td>{totals.cars}</td>
                <td>{peso.format(totals.sales)}</td>
                <td>{peso.format(totals.commission)}</td>
                {view === "summary" && <td>—</td>}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {view === "summary" && workerTotals.length > 0 && (
        <>
          <div className="report-header" style={{ marginTop: 18 }}>
            <h3>Per-Worker Totals (All Time)</h3>
          </div>

          <div className="table-wrap report-table">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Cars</th>
                  <th>Sales</th>
                  <th>Commission</th>
                </tr>
              </thead>
              <tbody>
                {workerTotals.map((worker) => (
                  <tr key={worker.name}>
                    <td>
                      <strong>{worker.name}</strong>
                    </td>
                    <td>{worker.cars}</td>
                    <td>{peso.format(worker.sales)}</td>
                    <td>{peso.format(worker.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
