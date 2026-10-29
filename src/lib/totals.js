/*
 * What a set of sales adds up to.
 *
 * One definition, used by the Admin Dashboard, its reports, Sales Records,
 * Employees and Worker Reports, so no two screens can drift apart.
 *
 * Total Sales is the money taken (the payment methods added up) plus what
 * customers still owe (Unpaid). Until 2026-10-27 it was the money taken
 * alone; the client asked for Unpaid to be included. A sale paid more than
 * its total adds what was paid and owes nothing, so Total Sales is not quite
 * the sum of order totals. The discount never forms part of it -- an order's
 * total is already net of the discount by the time it is stored.
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

// What the customer still owes. A sale paid more than its total has a
// negative balance; it owes nothing, and must not cancel out what other sales
// owe (it did: 36,780 showed where 38,600 was owed, 2026-10-14).
export function unpaid(order) {
  return Math.max(Number(order?.balance) || 0, 0);
}

// One sale's part of Total Sales: the money taken plus what is still owed.
export function saleValue(order) {
  return moneyTaken(order) + unpaid(order);
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
    totals.balance += unpaid(order);
    totals.commission += Number(order.commission) || 0;
  }

  totals.sales =
    totals.cash + totals.gcash + totals.credit + totals.bank + totals.balance;

  return totals;
}
