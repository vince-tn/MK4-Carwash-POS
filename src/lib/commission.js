import { peso } from "./reportUtils.js";

// The commission maths, kept apart from the Worker Form so it can be tested
// on its own (commission.test.js): it decides what each worker is paid.

// Each line is rounded to the centavo, so the breakdown in Sales Records adds
// up exactly to the total.
export function centavos(amount) {
  return Math.round(amount * 100) / 100;
}

/*
 * The worker's rule (their own, or the global one) decides the commission on
 * services. Add-ons are separate: each earns its own percentage of its price,
 * on top of the service commission, whatever the worker's rule.
 *
 * serviceCommissions lines up with services. Under "flat per order" every
 * service line is 0 and the flat amount belongs to the order as a whole.
 */
/*
 * One worker's rule: their own, or the global one when theirs is "inherit".
 * perService is what one whole service earns them; perOrder is a flat amount
 * per sale (0 unless the rule is flat per order).
 */
export function ruleFor(worker, commissionSettings) {
  const workerMode = worker?.commissionMode || "inherit";
  const mode =
    workerMode === "inherit"
      ? commissionSettings.globalMode
      : worker.commissionMode;

  const rawValue =
    workerMode === "inherit"
      ? commissionSettings.globalValue
      : worker.commissionValue;

  const value = Number(rawValue) || 0;

  if (mode === "flat_per_order") {
    return {
      mode,
      value,
      perService: () => 0,
      perOrder: value,
      label: `Flat per order: ${peso.format(value)}`,
    };
  }

  if (mode === "flat_per_service") {
    return {
      mode,
      value,
      perService: () => value,
      perOrder: 0,
      label: `Flat per service: ${peso.format(value)}`,
    };
  }

  if (mode === "custom_percent") {
    return {
      mode,
      value,
      perService: (service) => Number(service.price || 0) * (value / 100),
      perOrder: 0,
      label: `Custom percentage: ${value}%`,
    };
  }

  return {
    mode: "service_percent",
    value,
    perService: (service) =>
      Number(service.price || 0) * (Number(service.commissionRate || 0) / 100),
    perOrder: 0,
    label: "Service percentage",
  };
}

export function calculateCommission({ services, addOnLines, worker, commissionSettings }) {
  const { perService, perOrder, label } = ruleFor(worker, commissionSettings);

  const serviceCommissions = services.map((service) =>
    centavos(perService(service))
  );

  const addOnCommission = addOnLines.reduce(
    (sum, line) => sum + line.commission,
    0
  );

  const commission = centavos(
    serviceCommissions.reduce((sum, amount) => sum + amount, 0) +
      perOrder +
      addOnCommission
  );

  return {
    commission,
    label: addOnCommission > 0 ? `${label} + add-ons` : label,
    serviceCommissions,
    perOrder,
  };
}

/*
 * The commission on services and add-ons added to a sale after it was
 * recorded (Sales Records). Each line earns what it would have on the Worker
 * Form under the worker's rule as it is now, except a flat per-order amount:
 * the sale already earned that once. The sale's commission goes up by exactly
 * this, so nothing it earned before changes.
 */
export function commissionForAddedLines({ services, addOnLines, worker, commissionSettings }) {
  const { commission, serviceCommissions, perOrder } = calculateCommission({
    services,
    addOnLines,
    worker,
    commissionSettings,
  });

  return {
    commission: centavos(commission - perOrder),
    serviceCommissions,
  };
}

/*
 * Several workers on one car (client revision, 2026-11-13; supabase/25).
 *
 * Each service says who did it: assignments of { workerId, process, weight }.
 * A service with steps (Interior, Exterior...) has one per step, weighted by
 * the step's share %; without steps, everyone who did it has weight 0. All
 * weights 0 means an equal split. Each worker earns their share of what the
 * whole service would earn them under their own rule. Each add-on goes to
 * one worker in full at the add-on's own rate. A worker on flat per order
 * earns it once per sale they worked on, unless alreadyFlat says they
 * already did (adding to a recorded sale).
 *
 * Returns the services and add-ons with their credits and commission, the
 * per-sale credits, the sale's commission and its label. Every amount is
 * rounded to the centavo per credit, so the credits add up exactly.
 */
/*
 * Who did a service, as the form holds it: "" stands for the car's own
 * worker, so changing that worker moves every line left on them.
 *   service.steps   { [step id]: worker id or "" }, for a service with steps
 *   service.doneBy  [worker id or ""], for one without (default [""])
 */
export function assignmentsFor(service, category, leadId) {
  const who = (workerId) => workerId || leadId || "";
  const processes = category?.processes || [];

  if (processes.length) {
    return processes.map((process) => ({
      workerId: who(service.steps?.[process.id]),
      process: process.name,
      weight: Number(process.sharePercent) || 0,
    }));
  }

  const ids = [...new Set((service.doneBy?.length ? service.doneBy : [""]).map(who))];
  return ids.map((workerId) => ({ workerId, process: "", weight: 0 }));
}

/*
 * One chosen add-on as it is charged: Labor at the amount entered, anything
 * else at the price list's, times how many (Labor is always once). workerId
 * "" is the car's own worker.
 */
export function addOnLineFor(addOn, { qty = 1, workerId = "", laborAmount, laborDetails } = {}, leadId) {
  const isLabor = Boolean(addOn?.workerSetsPrice);
  const count = isLabor ? 1 : Math.min(Math.max(Math.round(Number(qty) || 1), 1), 99);
  const unitPrice = isLabor ? Number(laborAmount) || 0 : Number(addOn?.price) || 0;
  const commissionRate = Number(addOn?.commissionRate) || 0;
  const price = centavos(unitPrice * count);

  return {
    name: addOn?.name || "",
    qty: count,
    unitPrice,
    price,
    commissionRate,
    commission: centavos(price * (commissionRate / 100)),
    details: isLabor ? String(laborDetails || "").trim() : "",
    workerId: workerId || leadId || "",
  };
}

export function shareOut(assignments) {
  const done = (assignments || []).filter((assignment) => assignment?.workerId);
  if (!done.length) return [];

  const weights = done.map((assignment) => Math.max(Number(assignment.weight) || 0, 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  return done.map((assignment, index) => ({
    workerId: assignment.workerId,
    process: assignment.process || "",
    share: totalWeight > 0 ? weights[index] / totalWeight : 1 / done.length,
  }));
}

export function creditSale({
  services,
  addOnLines,
  workersById,
  commissionSettings,
  alreadyFlat = [],
}) {
  const workerFor = (workerId) => workersById.get(workerId);
  const labels = new Set();
  const workedOn = new Set();

  const creditedServices = services.map((service) => {
    const credits = shareOut(service.assignments).map((part) => {
      const worker = workerFor(part.workerId);
      const rule = ruleFor(worker, commissionSettings);

      labels.add(rule.label);
      workedOn.add(part.workerId);

      return {
        workerId: part.workerId,
        workerName: worker?.name || "",
        process: part.process,
        share: Math.round(part.share * 10000) / 10000,
        salesAmount: centavos(Number(service.price || 0) * part.share),
        commission: centavos(rule.perService(service) * part.share),
        ruleLabel: rule.label,
      };
    });

    return {
      ...service,
      credits,
      commission: centavos(credits.reduce((sum, credit) => sum + credit.commission, 0)),
    };
  });

  const creditedAddOns = addOnLines.map((line) => {
    const worker = workerFor(line.workerId);
    const commission = centavos(
      Number(line.price || 0) * ((Number(line.commissionRate) || 0) / 100)
    );

    if (line.workerId) workedOn.add(line.workerId);

    return {
      ...line,
      commission,
      credits: line.workerId
        ? [
            {
              workerId: line.workerId,
              workerName: worker?.name || "",
              process: "",
              share: 1,
              salesAmount: centavos(Number(line.price || 0)),
              commission,
              ruleLabel: "",
            },
          ]
        : [],
    };
  });

  const flatDone = new Set(alreadyFlat);
  const saleCredits = [...workedOn]
    .filter((workerId) => !flatDone.has(workerId))
    .map((workerId) => {
      const worker = workerFor(workerId);
      const rule = ruleFor(worker, commissionSettings);
      return {
        workerId,
        workerName: worker?.name || "",
        commission: centavos(rule.perOrder),
        ruleLabel: rule.label,
      };
    })
    .filter((credit) => credit.commission > 0);

  const addOnCommission = creditedAddOns.reduce((sum, line) => sum + line.commission, 0);

  const commission = centavos(
    creditedServices.reduce((sum, service) => sum + service.commission, 0) +
      addOnCommission +
      saleCredits.reduce((sum, credit) => sum + credit.commission, 0)
  );

  const ruleLabel =
    labels.size > 1 ? "Mixed worker rules" : [...labels][0] || "Service percentage";

  return {
    services: creditedServices,
    addOnLines: creditedAddOns,
    saleCredits,
    commission,
    label: addOnCommission > 0 ? `${ruleLabel} + add-ons` : ruleLabel,
  };
}
