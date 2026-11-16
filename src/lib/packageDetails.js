/*
 * Package details: the parts of a service such as Full Package (Interior,
 * Exterior, Engine...), each done by whoever the Worker Form says
 * (supabase/25, service_processes). The Services page edits them here.
 *
 * Split equally: every detail's share is stored as 0, and whoever does a
 * detail earns an equal part of the service's commission.
 * Set % per detail: each detail's share of the service's commission, adding
 * up to exactly 100%. The page will not save shares that do not.
 */

const round2 = (value) => Math.round(value * 100) / 100;

export function isCustomSplit(details = []) {
  return details.some((detail) => (Number(detail.sharePercent) || 0) > 0);
}

// Whole percentages adding up to 100: 3 details are 34, 33, 33.
export function equalShares(count) {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const extra = 100 - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

export function totalShare(details = []) {
  return round2(details.reduce((sum, detail) => sum + (Number(detail.sharePercent) || 0), 0));
}

// Why these details cannot be saved yet, or "" when they can.
export function detailsProblem({ mode, details = [] }) {
  if (details.some((detail) => !String(detail.name || "").trim())) {
    return "Every detail needs a name.";
  }

  if (mode !== "custom" || details.length === 0) return "";

  if (details.some((detail) => detail.sharePercent === "" || Number(detail.sharePercent) < 0)) {
    return "Every detail needs a share of 0% or more.";
  }

  const total = totalShare(details);
  if (Math.abs(total - 100) > 0.001) {
    return `The shares add up to ${total}%. They must add up to 100%.`;
  }

  return "";
}

// What is stored: shares of 0 for an equal split, the %s otherwise.
export function detailsToSave({ mode, details = [] }) {
  return details.map((detail) => ({
    id: detail.id,
    name: String(detail.name || "").trim(),
    sharePercent: mode === "custom" ? Number(detail.sharePercent) || 0 : 0,
  }));
}

// Each detail's % of the service's commission, as the Worker Form splits it.
export function effectiveShares({ mode, details = [] }) {
  if (!details.length) return [];
  if (mode !== "custom") return details.map(() => 100 / details.length);
  return details.map((detail) => Number(detail.sharePercent) || 0);
}

/*
 * The commission each detail pays on each size, at the service's own %
 * (the shop's default rule): price x service % x detail share.
 */
export function detailCommissions(category, draft) {
  const rate = Number(category?.commissionRate) || 0;
  const shares = effectiveShares(draft);

  return (category?.items || []).map((item) => {
    const commission = (Number(item.price) || 0) * (rate / 100);
    return {
      size: item.size,
      commission: round2(commission),
      details: shares.map((share) => round2((commission * share) / 100)),
    };
  });
}
