import { creditsOf, workerKey } from "./credits.js";

/*
 * The Commission Report's figures (components/CommissionReport.jsx), kept
 * apart so they can be tested (commissionReport.test.js).
 *
 * One row per employee per sale they worked on (supabase/25: a car can be
 * shared). Each row splits what the employee earned into services (with any
 * flat per-order amount, which belongs to the sale as a whole) and add-ons.
 * Across everyone on a sale, the rows add up to the commission stored on the
 * sale, which is what every other screen shows; a shared car still counts as
 * one car in the totals.
 */

const money = (value) => Number(value) || 0;

function addOnName(line) {
  const name = line.qty > 1 ? `${line.qty} x ${line.name}` : line.name;
  return line.details ? `${name}: ${line.details}` : name;
}

export function commissionRows(order) {
  const orderKey = order.dbId || order.id;
  const services = order.services || [];
  const addOnLines =
    order.addOnLines || (order.selectedAddOns || []).map((name) => ({ name, price: 0 }));
  const rows = new Map();

  const rowFor = (credit) => {
    const key = workerKey(credit.workerId, credit.workerName);

    if (!rows.has(key)) {
      rows.set(key, {
        key: `${orderKey}:${key}`,
        orderKey,
        employeeKey: key,
        date: order.date || "",
        salesOrder: order.id,
        employee: credit.workerName || "Unknown",
        workerId: credit.workerId || "",
        plate: order.plateNumber || "",
        services: [],
        serviceIds: [],
        serviceCount: 0,
        serviceAmount: 0,
        serviceCommission: 0,
        addOns: [],
        addOnIds: [],
        addOnCount: 0,
        addOnAmount: 0,
        addOnCommission: 0,
        commission: 0,
      });
    }

    return rows.get(key);
  };

  for (const credit of creditsOf(order)) {
    const row = rowFor(credit);
    const amount = money(credit.commission);
    row.commission += amount;

    if (credit.kind === "addon") {
      const index = addOnLines.findIndex((line, i) => (line.id || `addon-${i}`) === credit.addOnId);
      const line = addOnLines[index];
      row.addOnCommission += amount;
      row.addOnAmount += money(credit.salesAmount);
      if (line && !row.addOnIds.includes(credit.addOnId)) {
        row.addOnIds.push(credit.addOnId);
        row.addOns.push(addOnName(line));
      }
      continue;
    }

    row.serviceCommission += amount;

    if (credit.kind === "service") {
      const service = services.find((item, i) => (item.id || `service-${i}`) === credit.serviceId);
      row.serviceAmount += money(credit.salesAmount);

      if (service && !row.serviceIds.includes(credit.serviceId)) {
        row.serviceIds.push(credit.serviceId);
        const label = `${service.category} - ${service.size}`;
        const part = credit.process || (money(credit.share) < 1 ? "shared" : "");
        row.services.push(part ? `${label} (${part})` : label);
      } else if (service && credit.process) {
        // The same worker on two steps of one service.
        const at = row.serviceIds.indexOf(credit.serviceId);
        row.services[at] = row.services[at].replace(/\)$/, `, ${credit.process})`);
      }
    }
  }

  // A sale recorded before credits came with its add-ons as names only.
  if (!order.credits?.length && addOnLines.length) {
    const [first] = rows.values();
    if (first) {
      first.addOns = addOnLines.map(addOnName);
      first.addOnIds = addOnLines.map((line, i) => line.id || `addon-${i}`);
    }
  }

  const round = (value) => Math.round(value * 100) / 100;

  return [...rows.values()].map((row) => ({
    ...row,
    serviceCount: row.serviceIds.length,
    addOnCount: row.addOnIds.length,
    serviceAmount: round(row.serviceAmount),
    serviceCommission: round(row.serviceCommission),
    addOnAmount: round(row.addOnAmount),
    addOnCommission: round(row.addOnCommission),
    commission: round(row.commission),
  }));
}

// The sale's own worker's row: what the report showed before cars could be
// shared.
export function commissionRow(order) {
  const rows = commissionRows(order);
  const lead = workerKey(order.workerId, order.washerName);
  return rows.find((row) => row.employeeKey === lead) || rows[0];
}

const EMPTY = {
  cars: 0,
  serviceCount: 0,
  serviceAmount: 0,
  serviceCommission: 0,
  addOnCount: 0,
  addOnAmount: 0,
  addOnCommission: 0,
  commission: 0,
};

// Money adds up row by row. A car, service or add-on shared by several
// employees is counted once.
export function addUp(rows) {
  const cars = new Set();
  const services = new Set();
  const addOns = new Set();

  const totals = rows.reduce(
    (sum, row) => {
      cars.add(row.orderKey ?? row.key);
      for (const id of row.serviceIds || []) services.add(`${row.orderKey}:${id}`);
      for (const id of row.addOnIds || []) addOns.add(`${row.orderKey}:${id}`);

      return {
        ...sum,
        serviceAmount: sum.serviceAmount + row.serviceAmount,
        serviceCommission: sum.serviceCommission + row.serviceCommission,
        addOnAmount: sum.addOnAmount + row.addOnAmount,
        addOnCommission: sum.addOnCommission + row.addOnCommission,
        commission: sum.commission + row.commission,
      };
    },
    { ...EMPTY }
  );

  return { ...totals, cars: cars.size, serviceCount: services.size, addOnCount: addOns.size };
}

// One entry per employee, highest commission first, each with its sales
// oldest first.
export function byEmployee(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = row.employeeKey || row.workerId || `name:${row.employee}`;
    if (!groups.has(key)) groups.set(key, { key, employee: row.employee, rows: [] });
    groups.get(key).rows.push(row);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: group.rows.sort(
        (a, b) => a.date.localeCompare(b.date) || String(a.salesOrder).localeCompare(String(b.salesOrder))
      ),
      totals: addUp(group.rows),
    }))
    .sort((a, b) => b.totals.commission - a.totals.commission || a.employee.localeCompare(b.employee));
}
