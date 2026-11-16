import { useMemo, useState } from "react";
import * as db from "../lib/db";
import { addDays, quotaFor } from "../lib/payroll";
import { localDateString, peso } from "../lib/reportUtils";

/*
 * The daily car quota and bonus, for admins (client revision, 2026-11-13;
 * supabase/26).
 *
 * Weekdays and weekends (Saturday and Sunday) each have a quota and a bonus.
 * On a day the shop reaches its quota, every worker who worked on at least
 * one car that day earns the bonus on their payslip. A change applies from
 * its date on, which can be today or later: past days keep the rule they
 * had, so past payslips never move.
 */

function blankRule(current) {
  return {
    effectiveFrom: localDateString(),
    weekdayQuota: current?.weekdayQuota ?? 60,
    weekendQuota: current?.weekendQuota ?? 80,
    weekdayBonus: current?.weekdayBonus ?? 150,
    weekendBonus: current?.weekendBonus ?? 150,
  };
}

export default function QuotaSettings({ settings = [], onChange, orders = [] }) {
  const today = localDateString();
  const inForce = quotaFor(today, settings).rule;
  const [form, setForm] = useState(() => blankRule(inForce));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // The last 14 days: cars against the quota of the day.
  const recent = useMemo(() => {
    const cars = new Map();
    for (const order of orders) cars.set(order.date, (cars.get(order.date) || 0) + 1);

    return Array.from({ length: 14 }, (_, i) => {
      const day = addDays(today, -i);
      const rule = quotaFor(day, settings);
      const count = cars.get(day) || 0;
      return { day, count, ...rule, reached: rule.quota > 0 && count >= rule.quota };
    });
  }, [orders, settings, today]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setMessage(null);

    if (!form.effectiveFrom || form.effectiveFrom < today) {
      return setMessage({ error: true, text: "Choose today or a later date. Past days keep the rule they had." });
    }
    if (!(Number(form.weekdayQuota) > 0) || !(Number(form.weekendQuota) > 0)) {
      return setMessage({ error: true, text: "Each quota must be at least 1 car." });
    }
    if (Number(form.weekdayBonus) < 0 || Number(form.weekendBonus) < 0) {
      return setMessage({ error: true, text: "A bonus cannot be below zero." });
    }

    setBusy(true);

    try {
      onChange(await db.saveQuotaSetting(form));
      setMessage({ error: false, text: `Saved. It applies from ${form.effectiveFrom}.` });
    } catch (error) {
      console.error("Could not save the quota", error);
      setMessage({ error: true, text: `Could not save the quota: ${error.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule) {
    if (!confirm(`Remove the rule from ${rule.effectiveFrom}?`)) return;

    try {
      onChange(await db.removeQuotaSetting(rule.id));
    } catch (error) {
      console.error("Could not remove the rule", error);
      alert(error.message);
    }
  }

  return (
    <section className="dashboard quota-page">
      <div className="stats-grid">
        <div className="info-card">
          <span className="eyebrow">Weekdays (Mon–Fri)</span>
          <h3>{inForce.weekdayQuota} cars</h3>
          <p>{peso.format(inForce.weekdayBonus)} bonus per worker</p>
        </div>
        <div className="info-card">
          <span className="eyebrow">Weekends (Sat–Sun)</span>
          <h3>{inForce.weekendQuota} cars</h3>
          <p>{peso.format(inForce.weekendBonus)} bonus per worker</p>
        </div>
        <div className="info-card">
          <span className="eyebrow">In force since</span>
          <h3>{inForce.effectiveFrom === "2000-01-01" ? "The start" : inForce.effectiveFrom}</h3>
          <p>{inForce.createdBy ? `Set by ${inForce.createdBy}` : "The shop's default"}</p>
        </div>
      </div>

      <form className="form-card" onSubmit={save}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Change the quota</span>
            <h2>New quota and bonus</h2>
          </div>
        </div>

        <p className="field-hint form-intro">
          When the shop's cars for the day reach the quota, every worker who worked on at least one
          car that day gets the bonus on their payslip. A change applies from its date on; past days
          keep the rule they had.
        </p>

        <div className="form-grid">
          <label>
            Applies from
            <input type="date" min={today} value={form.effectiveFrom} onChange={(e) => update("effectiveFrom", e.target.value)} disabled={busy} />
          </label>
          <span />
          <label>
            Weekday quota (cars)
            <input type="number" min="1" value={form.weekdayQuota} onChange={(e) => update("weekdayQuota", e.target.value)} disabled={busy} />
          </label>
          <label>
            Weekday bonus (₱ per worker)
            <input type="number" min="0" value={form.weekdayBonus} onChange={(e) => update("weekdayBonus", e.target.value)} disabled={busy} />
          </label>
          <label>
            Weekend quota (cars)
            <input type="number" min="1" value={form.weekendQuota} onChange={(e) => update("weekendQuota", e.target.value)} disabled={busy} />
          </label>
          <label>
            Weekend bonus (₱ per worker)
            <input type="number" min="0" value={form.weekendBonus} onChange={(e) => update("weekendBonus", e.target.value)} disabled={busy} />
          </label>
        </div>

        {message && (
          <p className={message.error ? "form-message danger-text" : "form-message success-text"} role="status">
            {message.text}
          </p>
        )}

        <button type="submit" className="submit-btn" disabled={busy}>
          {busy ? "Saving..." : "Save Quota"}
        </button>
      </form>

      <div className="chart-card">
        <h3>Rules</h3>
        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>From</th>
                <th>Weekday</th>
                <th>Weekend</th>
                <th>Set by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.effectiveFrom === "2000-01-01" ? "The start" : rule.effectiveFrom}</td>
                  <td>
                    {rule.weekdayQuota} cars • {peso.format(rule.weekdayBonus)}
                  </td>
                  <td>
                    {rule.weekendQuota} cars • {peso.format(rule.weekendBonus)}
                  </td>
                  <td>{rule.createdBy || "—"}</td>
                  <td>
                    {rule.effectiveFrom >= today && (
                      <button type="button" className="small-danger-btn" onClick={() => remove(rule)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="chart-card">
        <h3>Last 14 days</h3>
        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Cars</th>
                <th>Quota</th>
                <th>Bonus</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((day) => (
                <tr key={day.day}>
                  <td>
                    {day.day}
                    {day.weekend ? " (weekend)" : ""}
                  </td>
                  <td>{day.count}</td>
                  <td className={day.reached ? "success-text" : ""}>
                    {day.quota}
                    {day.reached ? " ✓ reached" : ""}
                  </td>
                  <td>{day.reached ? `${peso.format(day.bonus)} each` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
