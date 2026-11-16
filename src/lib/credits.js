import { saleValue } from "./totals.js";

/*
 * Who earned what on a sale (supabase/25): one credit per worker per service
 * (or step), per add-on, and per flat per-order amount. A sale's credits add
 * up to its commission. Every screen that splits figures by worker goes
 * through here, so no two can split a sale differently.
 *
 * A sale's worker (workerId / washerName) is the one it was recorded under;
 * the others helped. A sale with no credits (one written straight to the
 * database, outside create_order) is treated as all its worker's, as every
 * sale was before 25.
 */

const money = (value) => Number(value) || 0;

export function workerKey(workerId, name) {
  return workerId || `name:${name || "Unknown"}`;
}

export function creditsOf(order) {
  if (order?.credits?.length) return order.credits;

  const lead = { workerId: order?.workerId || "", workerName: order?.washerName || "Unknown" };
  const services = (order?.services || []).map((service, index) => ({
    ...lead,
    kind: "service",
    serviceId: service.id || `service-${index}`,
    share: 1,
    salesAmount: money(service.price),
    commission: money(service.commission),
  }));
  const addOns = (order?.addOnLines || []).map((line, index) => ({
    ...lead,
    kind: "addon",
    addOnId: line.id || `addon-${index}`,
    share: 1,
    salesAmount: money(line.price),
    commission: money(line.commission),
  }));
  const lines = [...services, ...addOns].reduce((sum, credit) => sum + credit.commission, 0);
  const rest = Math.round((money(order?.commission) - lines) * 100) / 100;

  return rest > 0
    ? [...services, ...addOns, { ...lead, kind: "sale", share: 1, salesAmount: 0, commission: rest }]
    : [...services, ...addOns];
}

/*
 * Each worker's part of one sale: their commission (split into services,
 * which includes any flat per-order amount, and add-ons), and their share of
 * the sale, by the price of what they did. The shares add up to 1, so
 * splitting Total Sales by them never adds or loses a peso. A sale nobody
 * did anything priced on is split equally.
 */
export function workerParts(order) {
  const parts = new Map();

  for (const credit of creditsOf(order)) {
    const key = workerKey(credit.workerId, credit.workerName);

    if (!parts.has(key)) {
      parts.set(key, {
        key,
        workerId: credit.workerId || "",
        name: credit.workerName || "Unknown",
        lead: false,
        commission: 0,
        serviceCommission: 0,
        addOnCommission: 0,
        salesAmount: 0,
        processes: [],
      });
    }

    const part = parts.get(key);
    part.commission += money(credit.commission);
    part.salesAmount += money(credit.salesAmount);

    if (credit.kind === "addon") part.addOnCommission += money(credit.commission);
    else part.serviceCommission += money(credit.commission);

    if (credit.process && !part.processes.includes(credit.process)) {
      part.processes.push(credit.process);
    }
  }

  const leadKey = workerKey(order?.workerId, order?.washerName);
  if (parts.has(leadKey)) parts.get(leadKey).lead = true;

  const list = [...parts.values()];
  const priced = list.reduce((sum, part) => sum + part.salesAmount, 0);

  for (const part of list) {
    part.share = priced > 0 ? part.salesAmount / priced : 1 / list.length;
    part.commission = Math.round(part.commission * 100) / 100;
    part.serviceCommission = Math.round(part.serviceCommission * 100) / 100;
    part.addOnCommission = Math.round(part.addOnCommission * 100) / 100;
  }

  // The sale's own worker first, then by commission.
  return list.sort((a, b) => b.lead - a.lead || b.commission - a.commission);
}

// The worker's part of one sale, or null if they did nothing on it.
export function partFor(order, workerId) {
  return workerParts(order).find((part) => part.workerId === workerId) || null;
}

export function workedOn(order, workerId) {
  return Boolean(partFor(order, workerId));
}

// Everyone on the sale, its own worker first: "Anjo, Randy".
export function workerNames(order) {
  const names = workerParts(order).map((part) => part.name);
  return names.length ? names.join(", ") : order?.washerName || "";
}

/*
 * Per worker across many sales: cars they worked on, their commission, and
 * their share of Total Sales. Keyed like workerKey.
 */
export function totalsByWorker(orders = []) {
  const totals = new Map();

  for (const order of orders) {
    const value = saleValue(order);

    for (const part of workerParts(order)) {
      if (!totals.has(part.key)) {
        totals.set(part.key, {
          key: part.key,
          workerId: part.workerId,
          name: part.name,
          cars: 0,
          commission: 0,
          sales: 0,
        });
      }

      const entry = totals.get(part.key);
      entry.cars += 1;
      entry.commission += part.commission;
      entry.sales += value * part.share;
    }
  }

  return totals;
}
