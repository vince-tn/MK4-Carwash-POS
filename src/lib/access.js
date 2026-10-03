/*
 * What each login can open and load.
 *
 * access comes from db.fetchAccess(). installed is false until
 * supabase/14_roles.sql has run, and the app then keeps its old behavior: a
 * public Worker Form, and every login sees everything. Once it has run:
 *   Admin      Dashboard, Sales Records, Employees, Services
 *   Secretary  Sales Records, Employees
 *   Worker     Worker Form
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
      pages: ["dashboard", "records", "workers", "services"],
      home: "dashboard",
      loadPricing: true,
      loadCommission: true,
      loadWorkers: "all",
      loadOrders: true,
      seed: true,
      editPricing: true,
      editCommission: true,
      manageAdmins: true,
    };
  }

  if (access.role === "secretary") {
    return {
      ...NOTHING,
      pages: ["records", "workers"],
      home: "records",
      loadCommission: true,
      loadWorkers: "all",
      loadOrders: true,
      editCommission: true,
    };
  }

  if (access.role === "worker") {
    // The database returns only the worker's own employee record.
    return {
      ...NOTHING,
      pages: ["form"],
      home: "form",
      loadPricing: true,
      loadCommission: true,
      loadWorkers: "all",
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
