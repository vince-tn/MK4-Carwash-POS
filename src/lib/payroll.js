import { creditsOf } from "./credits.js";

/*
 * Weekly payslips and the daily quota bonus (client revision, 2026-11-13;
 * supabase/26-28). An estimate, not a payroll system:
 *
 *   pay week   Monday to Sunday, paid the following Monday
 *   commission what the worker earned on the cars they worked on (credits)
 *   bonus      for each day the shop reached its car quota and the worker
 *              worked on at least one car, that day's bonus
 *   deductions approved Vale and Cash Advance dated in the week
 *
 * Admins and secretaries build it from the sales on screen (payslipsFor); a
 * worker on their own login gets the same figures from my_pay_week (28) and
 * payslipFromWeek. Both end in buildPayslip, so the two never disagree.
 * Dates are YYYY-MM-DD strings throughout, worked out in UTC so a device's
 * time zone cannot shift a day.
 */

const round2 = (value) => Math.round(value * 100) / 100;

function toDate(day) {
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day, count) {
  const date = toDate(day);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function isWeekend(day) {
  const weekday = toDate(day).getUTCDay();
  return weekday === 0 || weekday === 6;
}

// The pay week holding a day: its Monday, its Sunday, and the payday.
export function payWeek(day) {
  const weekday = toDate(day).getUTCDay();
  const start = addDays(day, -((weekday + 6) % 7));
  return { start, end: addDays(start, 6), payday: addDays(start, 7) };
}

export function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const DEFAULT_QUOTA = {
  effectiveFrom: "2000-01-01",
  weekdayQuota: 60,
  weekendQuota: 80,
  weekdayBonus: 150,
  weekendBonus: 150,
};

// The quota rule in force on a day: the latest effective on or before it.
export function quotaFor(day, settings = []) {
  const rule =
    [...settings]
      .filter((item) => item.effectiveFrom <= day)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || DEFAULT_QUOTA;
  const weekend = isWeekend(day);

  return {
    weekend,
    quota: Number(weekend ? rule.weekendQuota : rule.weekdayQuota) || 0,
    bonus: Number(weekend ? rule.weekendBonus : rule.weekdayBonus) || 0,
    rule,
  };
}

/*
 * Each day of a week from the sales: the shop's cars, whether the quota was
 * reached, and per worker their cars and commission. Archived sales are
 * never passed in (the app keeps them out of every list).
 */
export function weekFromOrders(orders, start) {
  const days = new Map(weekDays(start).map((day) => [day, { day, shopCars: 0, workers: new Map() }]));

  for (const order of orders) {
    const entry = days.get(order.date);
    if (!entry) continue;

    entry.shopCars += 1;
    const seen = new Set();

    for (const credit of creditsOf(order)) {
      if (!credit.workerId) continue;

      const mine = entry.workers.get(credit.workerId) || {
        name: credit.workerName || "",
        cars: 0,
        commission: 0,
      };
      if (!seen.has(credit.workerId)) {
        mine.cars += 1;
        seen.add(credit.workerId);
      }
      mine.commission += Number(credit.commission) || 0;
      entry.workers.set(credit.workerId, mine);
    }
  }

  return [...days.values()];
}

/*
 * One worker's payslip from their week:
 *   days      [{ day, shopCars, cars, commission }] for the 7 days
 *   settings  the quota rules
 *   requests  their Vale / Cash Advance forms ({ kind, requestDate, amount, status })
 */
export function buildPayslip({ start, days, settings, requests = [] }) {
  const week = payWeek(start);
  const inWeek = requests.filter((item) => item.requestDate >= week.start && item.requestDate <= week.end);
  const approved = inWeek.filter((item) => item.status === "approved");
  const pending = inWeek.filter((item) => item.status === "pending");

  const lines = days.map((day) => {
    const quota = quotaFor(day.day, settings);
    const reached = quota.quota > 0 && day.shopCars >= quota.quota;
    const bonus = reached && day.cars > 0 ? quota.bonus : 0;

    return {
      day: day.day,
      weekend: quota.weekend,
      shopCars: day.shopCars,
      quota: quota.quota,
      reached,
      cars: day.cars,
      commission: round2(day.commission),
      bonus,
    };
  });

  const sum = (list, field) => round2(list.reduce((total, item) => total + (Number(item[field]) || 0), 0));
  const commission = sum(lines, "commission");
  const bonus = sum(lines, "bonus");
  const vale = sum(approved.filter((item) => item.kind === "vale"), "amount");
  const cashAdvance = sum(approved.filter((item) => item.kind === "cash_advance"), "amount");

  return {
    ...week,
    days: lines,
    cars: lines.reduce((total, day) => total + day.cars, 0),
    commission,
    bonus,
    bonusDays: lines.filter((day) => day.bonus > 0).length,
    gross: round2(commission + bonus),
    vale,
    cashAdvance,
    deductions: round2(vale + cashAdvance),
    net: round2(commission + bonus - vale - cashAdvance),
    approved,
    pending,
  };
}

/*
 * Every worker's payslip for a week, for admins and secretaries: anyone who
 * is active, worked that week, or has a form dated in it.
 */
export function payslipsFor({ orders, workers, settings, requests, start }) {
  const week = weekFromOrders(orders, start);
  const { end } = payWeek(start);

  const ids = new Set(
    workers.filter((worker) => worker.status === "Active").map((worker) => worker.id)
  );
  for (const day of week) for (const id of day.workers.keys()) ids.add(id);
  for (const request of requests) {
    if (request.workerId && request.requestDate >= start && request.requestDate <= end) {
      ids.add(request.workerId);
    }
  }

  const byId = new Map(workers.map((worker) => [worker.id, worker]));

  return [...ids]
    .map((id) => {
      const worker = byId.get(id);

      return {
        workerId: id,
        name:
          worker?.name ||
          week.map((day) => day.workers.get(id)?.name).find(Boolean) ||
          requests.find((request) => request.workerId === id)?.workerName ||
          "Unknown",
        status: worker?.status || "",
        ...buildPayslip({
          start,
          settings,
          requests: requests.filter((request) => request.workerId === id),
          days: week.map((day) => ({
            day: day.day,
            shopCars: day.shopCars,
            cars: day.workers.get(id)?.cars || 0,
            commission: day.workers.get(id)?.commission || 0,
          })),
        }),
      };
    })
    .filter((slip) => slip.status === "Active" || slip.cars > 0 || slip.approved.length || slip.pending.length)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A worker's own payslip from my_pay_week (supabase/28), already mapped.
export function payslipFromWeek(week) {
  return buildPayslip({
    start: week.start,
    settings: week.quotaSettings,
    requests: week.requests,
    days: week.days.map((day) => ({
      day: day.date,
      shopCars: day.shopCars,
      cars: day.cars,
      commission: day.commission,
    })),
  });
}
