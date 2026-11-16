import { Fragment, useEffect, useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import * as db from "../lib/db";
import { addDays, payWeek, payslipFromWeek, payslipsFor } from "../lib/payroll";
import { downloadCSV, localDateString, peso } from "../lib/reportUtils";

/*
 * Weekly payslips (client revision, 2026-11-13; lib/payroll, supabase/28).
 *
 * An estimate for each pay week, Monday to Sunday, paid the next Monday:
 * commission on the cars a worker worked on, plus the quota bonus for each
 * day the shop reached its quota and they worked, less approved Vale and CM
 * dated in the week. Admins and secretaries see everyone's, can print them
 * all and export them; a worker on a login of their own sees only theirs.
 */

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_LABEL = { vale: "Vale", cm: "CM" };

function longDate(day) {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function WeekPicker({ start, onChange }) {
  const { end, payday } = payWeek(start);
  const thisWeek = payWeek(localDateString()).start;

  return (
    <div className="week-picker no-print">
      <button type="button" className="ghost-btn" onClick={() => onChange(addDays(start, -7))}>
        ← Previous
      </button>
      <label>
        <span className="field-hint">Pay week holding</span>
        <input
          type="date"
          value={start}
          onChange={(e) => e.target.value && onChange(payWeek(e.target.value).start)}
        />
      </label>
      <button
        type="button"
        className="ghost-btn"
        onClick={() => onChange(addDays(start, 7))}
        disabled={start >= thisWeek}
      >
        Next →
      </button>
      <span className="week-picker-label">
        {longDate(start)} – {longDate(end)} • paid {longDate(payday)}
      </span>
    </div>
  );
}

export function PayslipCard({ name, slip }) {
  return (
    <article className="payslip">
      <header className="payslip-head">
        <div>
          <span className="eyebrow">MK4 Auto Care • Payslip (estimate)</span>
          <h3>{name}</h3>
        </div>
        <div className="payslip-week">
          {longDate(slip.start)} – {longDate(slip.end)}
          <strong>Payday {longDate(slip.payday)}</strong>
        </div>
      </header>

      <div className="table-wrap">
        <table className="payslip-days">
          <thead>
            <tr>
              <th>Day</th>
              <th>Shop cars / quota</th>
              <th>Cars worked</th>
              <th>Commission</th>
              <th>Quota bonus</th>
            </tr>
          </thead>
          <tbody>
            {slip.days.map((day, i) => (
              <tr key={day.day}>
                <td>
                  {DAY_NAMES[i]} {day.day.slice(5)}
                </td>
                <td className={day.reached ? "success-text" : ""}>
                  {day.shopCars} / {day.quota}
                  {day.reached ? " ✓" : ""}
                </td>
                <td>{day.cars}</td>
                <td>{peso.format(day.commission)}</td>
                <td>{day.bonus > 0 ? peso.format(day.bonus) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="payslip-totals">
        <dt>Commission ({slip.cars} cars)</dt>
        <dd>{peso.format(slip.commission)}</dd>
        <dt>Quota bonus ({slip.bonusDays} {slip.bonusDays === 1 ? "day" : "days"})</dt>
        <dd>{peso.format(slip.bonus)}</dd>
        <dt>Gross</dt>
        <dd>{peso.format(slip.gross)}</dd>
        {slip.approved.map((request) => (
          <Fragment key={request.id || `${request.kind}-${request.requestDate}-${request.amount}`}>
            <dt className="payslip-less">
              Less {KIND_LABEL[request.kind]} {request.requestDate.slice(5)}
              {request.reason ? ` (${request.reason})` : ""}
            </dt>
            <dd className="payslip-less">−{peso.format(request.amount)}</dd>
          </Fragment>
        ))}
        <dt className="payslip-net">Estimated pay</dt>
        <dd className="payslip-net">{peso.format(slip.net)}</dd>
      </dl>

      {slip.pending.length > 0 && (
        <p className="field-hint">
          Not yet approved, so not taken off:{" "}
          {slip.pending
            .map((request) => `${KIND_LABEL[request.kind]} ${peso.format(request.amount)} (${request.requestDate.slice(5)})`)
            .join(", ")}
          .
        </p>
      )}

      <p className="field-hint">
        An estimate from the sales recorded, the quota rules and approved Vale / CM. Not a payroll
        record.
      </p>
    </article>
  );
}

// A worker's own payslip, from the database (supabase/28).
function OwnPayslip({ start }) {
  const [state, setState] = useState({ start: null, week: null, error: null });

  useEffect(() => {
    let current = true;

    db.fetchMyPayWeek(start)
      .then((week) => current && setState({ start, week, error: null }))
      .catch((error) => {
        console.error("Could not load the payslip", error);
        if (current) setState({ start, week: null, error: error.message });
      });

    return () => {
      current = false;
    };
  }, [start]);

  if (state.start !== start) return <p className="empty">Loading your payslip...</p>;
  if (state.error) return <p className="empty danger-text">Could not load your payslip: {state.error}</p>;

  return <PayslipCard name={state.week.worker?.name || "Your payslip"} slip={payslipFromWeek(state.week)} />;
}

function EveryonesPayslips({ orders, workers, quotaSettings, start }) {
  const [requests, setRequests] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let current = true;

    db.fetchRequests()
      .then((list) => current && setRequests(list))
      .catch((error) => {
        console.error("Could not load the Vale / CM forms", error);
        if (current) setLoadError(error.message);
      });

    return () => {
      current = false;
    };
  }, []);

  const slips = useMemo(
    () =>
      requests
        ? payslipsFor({ orders, workers, settings: quotaSettings, requests, start })
        : [],
    [orders, workers, quotaSettings, requests, start]
  );

  const totals = slips.reduce(
    (sum, slip) => ({
      cars: sum.cars + slip.cars,
      commission: sum.commission + slip.commission,
      bonus: sum.bonus + slip.bonus,
      deductions: sum.deductions + slip.deductions,
      net: sum.net + slip.net,
    }),
    { cars: 0, commission: 0, bonus: 0, deductions: 0, net: 0 }
  );

  function exportCSV() {
    const money = (value) => Number(value).toFixed(2);

    downloadCSV(
      `mk4-payslips-${start}.csv`,
      ["Worker", "Week", "Payday", "Cars", "Commission", "Bonus Days", "Quota Bonus", "Gross", "Vale", "CM", "Estimated Pay", "Pending Vale / CM"],
      [
        ...slips.map((slip) => [
          slip.name,
          `${slip.start} to ${slip.end}`,
          slip.payday,
          slip.cars,
          money(slip.commission),
          slip.bonusDays,
          money(slip.bonus),
          money(slip.gross),
          money(slip.vale),
          money(slip.cm),
          money(slip.net),
          money(slip.pending.reduce((sum, request) => sum + request.amount, 0)),
        ]),
        ["TOTAL", "", "", totals.cars, money(totals.commission), "", money(totals.bonus), money(totals.commission + totals.bonus), "", money(totals.deductions), money(totals.net), ""],
      ]
    );
  }

  if (loadError) return <p className="empty danger-text">Could not load the Vale / CM forms: {loadError}</p>;
  if (!requests) return <p className="empty">Loading payslips...</p>;
  if (!slips.length) return <p className="empty">No workers to show for this week.</p>;

  return (
    <>
      <div className="report-controls no-print">
        <p className="report-hint">Click a worker to see their payslip.</p>
        <div className="detail-actions push-right">
          <button type="button" className="secondary-btn no-margin" onClick={() => window.print()}>
            <Printer size={16} /> Print All
          </button>
          <button type="button" className="secondary-btn no-margin" onClick={exportCSV}>
            <Download size={16} /> CSV
          </button>
        </div>
      </div>

      <div className="table-wrap report-table no-print">
        <table>
          <thead>
            <tr>
              <th>Worker</th>
              <th>Cars</th>
              <th>Commission</th>
              <th>Quota Bonus</th>
              <th>Vale / CM</th>
              <th>Estimated Pay</th>
            </tr>
          </thead>
          <tbody>
            {slips.map((slip) => {
              const isOpen = openId === slip.workerId;

              return (
                <Fragment key={slip.workerId}>
                  <tr
                    className={`report-row${isOpen ? " is-open" : ""}`}
                    onClick={() => setOpenId(isOpen ? null : slip.workerId)}
                    aria-expanded={isOpen}
                  >
                    <td>
                      <span className="report-caret">{isOpen ? "▾" : "▸"}</span>
                      <strong>{slip.name}</strong>
                      {slip.status !== "Active" && <small> (not active)</small>}
                    </td>
                    <td>{slip.cars}</td>
                    <td>{peso.format(slip.commission)}</td>
                    <td>
                      {peso.format(slip.bonus)}
                      {slip.bonusDays > 0 && <small> ({slip.bonusDays}d)</small>}
                    </td>
                    <td>
                      {slip.deductions > 0 ? `−${peso.format(slip.deductions)}` : "—"}
                      {slip.pending.length > 0 && <small> ({slip.pending.length} pending)</small>}
                    </td>
                    <td>
                      <strong>{peso.format(slip.net)}</strong>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="report-detail-row">
                      <td colSpan={6}>
                        <div className="report-detail">
                          <PayslipCard name={slip.name} slip={slip} />
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
              <td>{peso.format(totals.commission)}</td>
              <td>{peso.format(totals.bonus)}</td>
              <td>{totals.deductions > 0 ? `−${peso.format(totals.deductions)}` : "—"}</td>
              <td>{peso.format(totals.net)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* What Print All prints: every payslip, one per page. */}
      <div className="print-only">
        {slips.map((slip) => (
          <PayslipCard key={slip.workerId} name={slip.name} slip={slip} />
        ))}
      </div>
    </>
  );
}

export default function Payslips({ orders = [], workers = [], quotaSettings = [], own = false }) {
  const [start, setStart] = useState(() => payWeek(localDateString()).start);

  return (
    <section className="dashboard payslips-page">
      <div className="dashboard-header no-print">
        <div>
          <span className="eyebrow">{own ? "My Payslip" : "Weekly Payslips"}</span>
          <h2>{own ? "Your estimated pay" : "Estimated pay per worker"}</h2>
          <p className="field-hint">
            Monday to Sunday, paid the next Monday: commission plus the quota bonus, less approved
            Vale and CM.
          </p>
        </div>
      </div>

      <div className="chart-card">
        <WeekPicker start={start} onChange={setStart} />

        {own ? (
          <OwnPayslip start={start} />
        ) : (
          <EveryonesPayslips orders={orders} workers={workers} quotaSettings={quotaSettings} start={start} />
        )}
      </div>
    </section>
  );
}
