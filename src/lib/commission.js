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
export function calculateCommission({ services, addOnLines, worker, commissionSettings }) {
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

  let perService;
  let perOrder = 0;
  let label;

  if (mode === "flat_per_order") {
    perService = () => 0;
    perOrder = value;
    label = `Flat per order: ${peso.format(value)}`;
  } else if (mode === "flat_per_service") {
    perService = () => value;
    label = `Flat per service: ${peso.format(value)}`;
  } else if (mode === "custom_percent") {
    perService = (service) => Number(service.price || 0) * (value / 100);
    label = `Custom percentage: ${value}%`;
  } else {
    perService = (service) =>
      Number(service.price || 0) * (Number(service.commissionRate || 0) / 100);
    label = "Service percentage";
  }

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
  };
}
