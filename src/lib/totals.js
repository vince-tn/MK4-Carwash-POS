/*
 * What a set of sales adds up to.
 *
 * One definition, used by both the Admin Dashboard tiles and the Sales Records
 * summary, so the two screens cannot drift apart.
 *
 * Sales means money actually taken: the payment methods added up. It is not
 * the sum of order totals, which is money BILLED and includes anything the
 * customer has not paid yet. The shop's own sheet totals cash, GCash and bank,
 * and this matches it. The discount never forms part of it either way -- an
 * order's total is already net of the discount by the time it is stored.
 */

// A payment is only counted when its box was ticked on the form. A 0.00 amount
// with the box ticked is meaningfully different from the box left alone.
export const PAYMENT_METHODS = ["cash", "gcash", "credit", "bank"];

// Payments made after the sale (supabase/23), minus any that were removed.
export function laterPayments(order) {
  return (order?.payments || []).filter((payment) => !payment.removedAt);
}

// What the later payments add to one method, or to all of them.
export function laterPaid(order, method) {
  return laterPayments(order)
    .filter((payment) => !method || payment.method === method)
    .reduce((total, payment) => total + (Number(payment.amount) || 0), 0);
}

// A method's amount at the sale, plus what came in later by the same method.
// The discount is never a later payment.
export function amountFor(order, method) {
  const atSale = order?.paymentEnabled?.[method] ? Number(order[method]) || 0 : 0;
  return method === "discount" ? atSale : atSale + laterPaid(order, method);
}

export function moneyTaken(order) {
  return PAYMENT_METHODS.reduce(
    (total, method) => total + amountFor(order, method),
    0
  );
}

export function summarise(orders = []) {
  const totals = {
    cars: orders.length,
    cash: 0,
    gcash: 0,
    credit: 0,
    bank: 0,
    sales: 0,
    discount: 0,
    balance: 0,
    commission: 0,
  };

  for (const order of orders) {
    for (const method of PAYMENT_METHODS) {
      totals[method] += amountFor(order, method);
    }

    totals.discount += amountFor(order, "discount");
    totals.balance += Number(order.balance) || 0;
    totals.commission += Number(order.commission) || 0;
  }

  totals.sales = totals.cash + totals.gcash + totals.credit + totals.bank;

  return totals;
}
