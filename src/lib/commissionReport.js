/*
 * The Commission Report's figures (components/CommissionReport.jsx), kept
 * apart so they can be tested (commissionReport.test.js).
 *
 * Each sale's commission is split into what its services earned (with any
 * flat per-order amount, which belongs to the sale as a whole) and what its
 * add-ons earned. The two always add up to the commission stored on the
 * sale, which is what every other screen shows.
 */

const money = (value) => Number(value) || 0;

function addOnName(line) {
  return line.details ? `${line.name}: ${line.details}` : line.name;
}

export function commissionRow(order) {
  const services = order.services || [];
  const addOnLines =
    order.addOnLines || (order.selectedAddOns || []).map((name) => ({ name, price: 0 }));

  const addOnCommission = addOnLines.reduce((sum, line) => sum + money(line.commission), 0);
  const commission = money(order.commission);

  return {
    key: order.dbId || order.id,
    date: order.date || "",
    salesOrder: order.id,
    employee: order.washerName || "Unknown",
    workerId: order.workerId || "",
    plate: order.plateNumber || "",
    services: services.map((service) => `${service.category} - ${service.size}`),
    serviceCount: services.length,
    serviceAmount: services.reduce((sum, service) => sum + money(service.price), 0),
    serviceCommission: Math.round((commission - addOnCommission) * 100) / 100,
    addOns: addOnLines.map(addOnName),
    addOnCount: addOnLines.length,
    addOnAmount: addOnLines.reduce((sum, line) => sum + money(line.price), 0),
    addOnCommission,
    commission,
  };
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

export function addUp(rows) {
  return rows.reduce(
    (sum, row) => ({
      cars: sum.cars + 1,
      serviceCount: sum.serviceCount + row.serviceCount,
      serviceAmount: sum.serviceAmount + row.serviceAmount,
      serviceCommission: sum.serviceCommission + row.serviceCommission,
      addOnCount: sum.addOnCount + row.addOnCount,
      addOnAmount: sum.addOnAmount + row.addOnAmount,
      addOnCommission: sum.addOnCommission + row.addOnCommission,
      commission: sum.commission + row.commission,
    }),
    { ...EMPTY }
  );
}

// One entry per employee, highest commission first, each with its sales
// oldest first.
export function byEmployee(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = row.workerId || `name:${row.employee}`;
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
