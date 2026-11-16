/*
 * What each login can open and load.
 *
 * access comes from db.fetchAccess(). installed is false until
 * supabase/14_roles.sql has run, and the app then keeps its old behavior: a
 * public Worker Form, and every login sees everything. Once it has run:
 *   Admin      Dashboard, Sales Records, Commission Report, Employees,
 *              Logins, Services, Requests, Payslips, Quota
 *   Secretary  Worker Form, Sales Records, Commission Report, Employees,
 *              Requests, Payslips
 *   Worker     Worker Form, Requests, and their own Payslip on a login of
 *              their own (not on the shared worker login)
 * and a signed-out visitor gets only the login page. The database enforces
 * the same rules; this only decides what is shown.
 */

export const ROLE_LABELS = {
  admin: "Admin",
  secretary: "Secretary",
  worker: "Worker",
};

const NOTHING = {
  pages: [],
  home: null,
  loadPricing: false,
  loadCommission: false,
  loadWorkers: null,
  loadOrders: false,
  seed: false,
  editPricing: false,
  editCommission: false,
  manageAdmins: false,
  // Phase 2 (supabase/26-28): the quota rules, and approving Vale / CM.
  loadQuota: false,
  reviewRequests: false,
};

export function accessFor(access, isLoggedIn) {
  if (!access) return NOTHING;

  if (!access.installed) {
    return isLoggedIn
      ? {
          pages: ["form", "dashboard", "records", "workers", "services"],
          home: "dashboard",
          loadPricing: true,
          loadCommission: true,
          loadWorkers: "all",
          loadOrders: true,
          seed: true,
          editPricing: true,
          editCommission: true,
          manageAdmins: true,
        }
      : {
          ...NOTHING,
          pages: ["form", "login"],
          home: "form",
          loadPricing: true,
          loadCommission: true,
          loadWorkers: "public",
        };
  }

  if (!isLoggedIn) return { ...NOTHING, pages: ["login"], home: "login" };

  if (access.role === "admin") {
    return {
      pages: [
        "dashboard",
        "records",
        "commissions",
        "workers",
        "logins",
        "services",
        "requests",
        "payslips",
        "quota",
      ],
      home: "dashboard",
      loadPricing: true,
      loadCommission: true,
      loadWorkers: "all",
      loadOrders: true,
      seed: true,
      editPricing: true,
      editCommission: true,
      manageAdmins: true,
      loadQuota: true,
      reviewRequests: true,
    };
  }

  if (access.role === "secretary") {
    // The Worker Form too (client request, 2026-10-07): a secretary records
    // sales for any active worker. Still lands on Sales Records. The
    // Commission Report too (client request, 2026-10-27).
    return {
      ...NOTHING,
      pages: ["form", "records", "commissions", "workers", "requests", "payslips"],
      home: "records",
      loadPricing: true,
      loadCommission: true,
      loadWorkers: "all",
      loadOrders: true,
      editCommission: true,
      loadQuota: true,
      reviewRequests: true,
    };
  }

  if (access.role === "worker") {
    // Only the workers on this login: the worker themselves, or everyone on
    // the shared worker login. Vale / CM forms for everyone; a payslip only
    // on a login of one's own, since everyone uses the shared one.
    return {
      ...NOTHING,
      pages: access.shared === false ? ["form", "requests", "payslips"] : ["form", "requests"],
      home: "form",
      loadPricing: true,
      loadCommission: true,
      loadWorkers: "mine",
    };
  }

  // Signed in, but not an active employee: nothing to open.
  return NOTHING;
}

// Workers who record sales. Admins and secretaries are employees too, but do
// not belong in sales filters or worker counts.
export function isSalesWorker(employee) {
  return !["Admin", "Secretary"].includes(employee?.role);
}
