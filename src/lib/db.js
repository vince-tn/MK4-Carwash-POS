import { supabase } from "./supabaseClient";

/*
 * Data access for the POS.
 *
 * The database is normalised (orders with order_services / order_addons child
 * rows, snake_case columns) while the components work in camelCase with the
 * services and add-ons nested inside each order. Everything in this file
 * exists to keep that translation in one place, so the components did not have
 * to change when the app moved off localStorage.
 */

const ORDER_SELECT = `
  id, sales_order_id, order_date, plate_number, customer_name, contact_number,
  car_type, car_brand, worker_id, worker_name, manager,
  service_total, addon_total, cash, gcash, credit, discount, payment_enabled,
  total, total_paid, balance, commission, commission_label,
  gcash_ref, credit_ref, reference_no, payment_notes, payment_updated_at,
  photo_name, photo_path, notes, created_at,
  order_services (
    id, category, size, price, commission_type, commission_rate, commission
  ),
  order_addons ( id, name, price, commission_rate, commission, details )
`;

const EMPTY_PAYMENT_ENABLED = {
  cash: false,
  gcash: false,
  credit: false,
  discount: false,
};

function num(value) {
  return Number(value) || 0;
}

// Per-line commission is null on sales recorded before it was stored (13),
// and that null is how Sales Records knows to show only the total.
function numOrNull(value) {
  return value === null || value === undefined || value === ""
    ? null
    : Number(value) || 0;
}

/* ------------------------------------------------------------------ orders */

function toAppOrder(row) {
  return {
    id: row.sales_order_id,
    dbId: row.id,
    date: row.order_date,
    plateNumber: row.plate_number || "",
    customerName: row.customer_name || "",
    contactNumber: row.contact_number || "",
    carType: row.car_type || "",
    carBrand: row.car_brand || "",
    workerId: row.worker_id || "",
    washerName: row.worker_name || "",
    manager: row.manager || "",
    services: (row.order_services || []).map((service) => ({
      id: service.id,
      category: service.category,
      size: service.size,
      price: num(service.price),
      commissionType: service.commission_type || "",
      commissionRate: num(service.commission_rate),
      commission: numOrNull(service.commission),
    })),
    selectedAddOns: (row.order_addons || []).map((addOn) => addOn.name),
    addOnLines: (row.order_addons || []).map((addOn) => ({
      id: addOn.id,
      name: addOn.name,
      price: num(addOn.price),
      commissionRate: numOrNull(addOn.commission_rate),
      commission: numOrNull(addOn.commission),
      details: addOn.details || "",
    })),
    paymentEnabled: row.payment_enabled || { ...EMPTY_PAYMENT_ENABLED },
    cash: row.cash ?? "",
    gcash: row.gcash ?? "",
    credit: row.credit ?? "",
    discount: row.discount ?? "",
    gcashRef: row.gcash_ref || "",
    creditRef: row.credit_ref || "",
    referenceNo: row.reference_no || "",
    paymentNotes: row.payment_notes || "",
    paymentUpdatedAt: row.payment_updated_at || "",
    serviceTotal: num(row.service_total),
    addOnTotal: num(row.addon_total),
    total: num(row.total),
    totalPaid: num(row.total_paid),
    balance: num(row.balance),
    commission: num(row.commission),
    commissionLabel: row.commission_label || "",
    photoName: row.photo_name || "",
    photoPath: row.photo_path || "",
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

export async function fetchOrders() {
  // PostgREST caps a response at 1000 rows and does so silently, so a single
  // select would quietly start dropping orders about three weeks into
  // trading and every report would be wrong without saying so. Page until a
  // short page comes back.
  const PAGE_SIZE = 1000;
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    // id breaks ties, so the order of rows across pages is fixed.
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    rows.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) break;
  }

  // A sale recorded while the pages are being read pushes every later row
  // down one place, so the last order of one page comes back again at the top
  // of the next. Keep one copy of each, or it is counted twice in every total.
  const unique = new Map(rows.map((row) => [row.id, row]));

  return [...unique.values()].map(toAppOrder);
}

function toOrderRow(order) {
  // A worker_id only exists once workers live in the database; guard against
  // the id being a leftover local string rather than a uuid.
  const workerId =
    typeof order.workerId === "string" && order.workerId.includes("-") &&
    order.workerId.length === 36
      ? order.workerId
      : null;

  return {
    order_date: order.date,
    plate_number: order.plateNumber,
    customer_name: order.customerName || null,
    contact_number: order.contactNumber || null,
    car_type: order.carType || null,
    car_brand: order.carBrand || null,
    worker_id: workerId,
    worker_name: order.washerName || null,
    manager: order.manager || null,
    service_total: num(order.serviceTotal),
    addon_total: num(order.addOnTotal),
    cash: num(order.cash),
    gcash: num(order.gcash),
    credit: num(order.credit),
    discount: num(order.discount),
    payment_enabled: order.paymentEnabled || EMPTY_PAYMENT_ENABLED,
    total: num(order.total),
    total_paid: num(order.totalPaid),
    balance: num(order.balance),
    commission: num(order.commission),
    commission_label: order.commissionLabel || null,
    gcash_ref: order.gcashRef || null,
    credit_ref: order.creditRef || null,
    photo_name: order.photoName || null,
    photo_path: order.photoPath || null,
    notes: order.notes || null,
  };
}

function toServiceRows(order) {
  return (order.services || [])
    .filter((service) => service.category)
    .map((service) => ({
      category: service.category,
      size: service.size || "",
      price: num(service.price),
      commission_type: service.commissionType || null,
      commission_rate: num(service.commissionRate),
      commission: numOrNull(service.commission),
    }));
}

/*
 * The Worker Form hands over addOnLines: each add-on with the price charged
 * (the worker's own amount for Labor Only), its commission and any labor
 * description. Orders from the localStorage import have only names, so their
 * prices come from the caller's price list as before.
 */
function toAddOnRows(order) {
  if (order.addOnLines) {
    return order.addOnLines.map((line) => ({
      name: line.name,
      price: num(line.price),
      commission_rate: numOrNull(line.commissionRate),
      commission: numOrNull(line.commission),
      details: line.details || null,
    }));
  }

  return (order.selectedAddOns || []).map((name) => ({
    name,
    price: num(order.addOnPrices?.[name]),
  }));
}

/*
 * The database numbers the sale and writes it together with its services and
 * add-ons in one transaction (supabase/10_create_order.sql). Numbering it
 * here could not work: a signed-out worker cannot read the day's orders, so
 * every device started at 001 and collided on the unique sales_order_id.
 */
export async function createOrder(order) {
  const { data, error } = await supabase.rpc("create_order", {
    p_order: {
      ...toOrderRow(order),
      services: toServiceRows(order),
      addons: toAddOnRows(order),
    },
  });

  if (error) throw error;

  // Built from what was sent rather than re-read, because a signed-out
  // worker may not select from orders. addOnPrices is a lookup the caller
  // passed in, not a field.
  const saved = {
    ...order,
    id: data.sales_order_id,
    dbId: data.id,
    createdAt: data.created_at,
  };
  delete saved.addOnPrices;

  return saved;
}

/*
 * Imported orders keep the sales order number and date the device gave them,
 * so they bypass create_order and its numbering. Signed-in staff only.
 */
async function importOrder(order) {
  const id = crypto.randomUUID();

  const { error } = await supabase
    .from("orders")
    .insert({ id, sales_order_id: order.id, ...toOrderRow(order) });

  if (error) throw error;

  const services = toServiceRows(order).map((row) => ({ ...row, order_id: id }));

  if (services.length) {
    const { error: serviceError } = await supabase
      .from("order_services")
      .insert(services);
    if (serviceError) throw serviceError;
  }

  const addOns = toAddOnRows(order).map((row) => ({ ...row, order_id: id }));

  if (addOns.length) {
    const { error: addOnError } = await supabase
      .from("order_addons")
      .insert(addOns);
    if (addOnError) throw addOnError;
  }
}

export async function updateOrderPayment(dbId, patch) {
  const { data, error } = await supabase
    .from("orders")
    .update({
      payment_enabled: patch.paymentEnabled,
      cash: num(patch.cash),
      gcash: num(patch.gcash),
      credit: num(patch.credit),
      discount: num(patch.discount),
      gcash_ref: patch.gcashRef || null,
      credit_ref: patch.creditRef || null,
      payment_notes: patch.paymentNotes || null,
      payment_updated_at: new Date().toISOString(),
      total: num(patch.total),
      total_paid: num(patch.totalPaid),
      balance: num(patch.balance),
    })
    .eq("id", dbId)
    .select(ORDER_SELECT)
    .single();

  if (error) throw error;
  return toAppOrder(data);
}

export async function deleteOrder(dbId) {
  // Child service and add-on rows go with it via ON DELETE CASCADE.
  //
  // Checked the same way as deleteWorker: a delete with no matching policy
  // is reported as success affecting nothing, which would quietly drop the
  // row from the screen and bring it back on the next load.
  const { data, error } = await supabase
    .from("orders")
    .delete()
    .eq("id", dbId)
    .select("id");

  if (error) throw error;

  if (!data || !data.length) {
    throw new Error(
      "The database refused that delete. A delete policy on the orders table is missing."
    );
  }
}

/*
 * Deletes payment proof images, a thousand per request (the storage API's
 * limit). Called after the sales they belong to are deleted: until now a
 * deleted sale left its image behind, quietly using up the 1 GB quota.
 */
export async function removeProofs(paths) {
  const unique = [...new Set(paths.filter(Boolean))];

  for (let start = 0; start < unique.length; start += 1000) {
    const { error } = await supabase.storage
      .from("payment-proofs")
      .remove(unique.slice(start, start + 1000));

    if (error) throw error;
  }
}

/* ------------------------------------------------------------------ access */

/*
 * Who the signed-in user is, from my_access() (supabase/14_roles.sql).
 *
 * installed: false means that migration has not run, and the app keeps its
 * old behavior. Any other failure is a real error and is thrown.
 */
export async function fetchAccess() {
  const { data, error } = await supabase.rpc("my_access");

  if (error) {
    // PostgREST's code for "no such function".
    if (error.code === "PGRST202") return { installed: false, role: null };

    // Refused: from 16 only signed-in users may ask, so roles are on and
    // nobody is signed in.
    if (error.code === "42501") return { installed: true, role: null };

    throw error;
  }

  return {
    installed: true,
    role: data?.role || null,
    // A login several employees share, such as worker@mk4.pos (15).
    shared: Boolean(data?.shared),
    employeeId: data?.employee_id || null,
    name: data?.name || "",
  };
}

/*
 * The active employees on the signed-in login, for the Worker Form: just the
 * worker on a personal login, every worker on the shared one. my_employees()
 * (15) returns only names and commission rules. Before 15 it does not exist,
 * and the login's own record comes from the employees table as in 14.
 */
export async function fetchMyEmployees() {
  const { data, error } = await supabase.rpc("my_employees");

  if (error) {
    if (error.code === "PGRST202") return fetchWorkers();
    throw error;
  }

  return (data || []).map(toAppWorker);
}

/* ------------------------------------------------------------------ logins */

/*
 * The admin Logins page: list, create, change password, log out everywhere,
 * delete. Creating logins and setting passwords needs Supabase's secret key,
 * so this goes through the admin-logins Edge Function
 * (supabase/functions/admin-logins), which refuses anyone but an admin.
 *
 * Before that function is deployed the call gets a 404 or no answer at all,
 * and the error carries notSetUp so the page can say what to do.
 */
export async function manageLogins(action, args = {}) {
  const { data, error } = await supabase.functions.invoke("admin-logins", {
    body: { action, ...args },
  });

  if (!error) return data;

  if (error.name === "FunctionsHttpError") {
    const response = error.context;
    const body = await response.json().catch(() => null);

    // The function's own errors have "error"; Supabase's gateway, which
    // answers when the function is missing, uses "message".
    if (!body?.error && response.status === 404) throw notSetUp();
    throw new Error(
      body?.error || body?.message || `Login management failed (${response.status}).`
    );
  }

  throw notSetUp();
}

function notSetUp() {
  const error = new Error(
    "Could not reach login management. Check the connection; if it has never worked, it has not been set up yet."
  );
  error.notSetUp = true;
  return error;
}

/* ----------------------------------------------------------------- workers */

function toAppWorker(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role || "Worker",
    // undefined when the database predates login emails (before 14), so
    // saves leave the column out rather than fail on it.
    loginEmail:
      row.login_email === undefined ? undefined : row.login_email || "",
    phone: row.phone || "",
    address: row.address || "",
    status: row.status || "Active",
    dateJoined: row.date_joined || "",
    notes: row.notes || "",
    commissionMode: row.commission_mode || "inherit",
    commissionValue: row.commission_value ?? "",
  };
}

function toWorkerRow(worker) {
  return {
    name: worker.name,
    role: worker.role || "Worker",
    ...(worker.loginEmail === undefined
      ? {}
      : { login_email: worker.loginEmail.trim().toLowerCase() || null }),
    phone: worker.phone || null,
    address: worker.address || null,
    status: worker.status || "Active",
    date_joined: worker.dateJoined || null,
    notes: worker.notes || null,
    commission_mode: worker.commissionMode || "inherit",
    commission_value: num(worker.commissionValue),
  };
}

// All a signed-out visitor needs for the worker dropdown and the commission
// rule. supabase/11_limit_public_access.sql limits anon to these columns,
// so asking anon for "*" would be refused.
const PUBLIC_WORKER_COLUMNS =
  "id, name, role, status, commission_mode, commission_value";

export async function fetchWorkers({ publicOnly = false } = {}) {
  const { data, error } = await supabase
    .from("workers")
    .select(publicOnly ? PUBLIC_WORKER_COLUMNS : "*")
    .order("name");

  if (error) throw error;
  return (data || []).map(toAppWorker);
}

export async function createWorker(worker) {
  const { data, error } = await supabase
    .from("workers")
    .insert(toWorkerRow(worker))
    .select("*")
    .single();

  if (error) throw error;
  return toAppWorker(data);
}

export async function updateWorker(workerId, worker) {
  const { data, error } = await supabase
    .from("workers")
    .update(toWorkerRow(worker))
    .eq("id", workerId)
    .select("*")
    .single();

  if (error) throw error;
  return toAppWorker(data);
}

export async function deleteWorker(workerId) {
  // orders.worker_id is ON DELETE CASCADE (09), so the worker's sales go too.
  //
  // RLS reports success with zero rows affected when no policy grants the
  // delete, so the result has to be inspected. Otherwise the worker vanishes
  // from the screen and is back on the next reload.
  const { data, error } = await supabase
    .from("workers")
    .delete()
    .eq("id", workerId)
    .select("id");

  if (error) throw error;

  if (!data || !data.length) {
    throw new Error(
      "The database refused that delete. A delete policy on the workers table is missing."
    );
  }
}

/* ----------------------------------------------------- commission settings */

export async function fetchCommissionSettings() {
  const { data, error } = await supabase
    .from("commission_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { id: null, globalMode: "service_percent", globalValue: "100" };

  return {
    id: data.id,
    globalMode: data.global_mode || "service_percent",
    globalValue: data.global_value ?? "100",
  };
}

export async function saveCommissionSettings(settings) {
  if (settings.id) {
    const { error } = await supabase
      .from("commission_settings")
      .update({
        global_mode: settings.globalMode,
        global_value: num(settings.globalValue),
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id);

    if (error) throw error;
    return settings;
  }

  const { data, error } = await supabase
    .from("commission_settings")
    .insert({
      global_mode: settings.globalMode,
      global_value: num(settings.globalValue),
    })
    .select("id")
    .single();

  if (error) throw error;
  return { ...settings, id: data.id };
}

/* ----------------------------------------------------------------- pricing */

export async function fetchPricing() {
  const [categoriesResult, itemsResult, addOnsResult] = await Promise.all([
    supabase.from("service_categories").select("*").order("sort_order"),
    supabase.from("service_items").select("*").order("sort_order"),
    supabase.from("add_ons").select("*").order("sort_order"),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (addOnsResult.error) throw addOnsResult.error;

  const items = itemsResult.data || [];

  return {
    categories: (categoriesResult.data || []).map((category) => ({
      id: category.id,
      category: category.category,
      commissionType: category.commission_type || "",
      commissionRate: num(category.commission_rate),
      items: items
        .filter((item) => item.category_id === category.id)
        .map((item) => ({
          id: item.id,
          size: item.size,
          price: num(item.price),
        })),
    })),
    addOns: (addOnsResult.data || []).map((addOn) => ({
      id: addOn.id,
      name: addOn.name,
      price: num(addOn.price),
      commissionRate: num(addOn.commission_rate),
      workerSetsPrice: Boolean(addOn.worker_sets_price),
    })),
  };
}

/*
 * Collects every row id in a price list, so a later save can tell what the
 * user actually removed.
 */
export function collectPricingIds(pricing) {
  const categories = (pricing?.categories || []).map((category) => category.id);

  const items = (pricing?.categories || []).flatMap((category) =>
    (category.items || []).map((item) => item.id)
  );

  const addOns = (pricing?.addOns || []).map((addOn) => addOn.id);

  return { categories, items, addOns };
}

/*
 * The Services page hands back the whole price list on every edit, so this
 * upserts everything in it, then removes the rows the user deleted.
 *
 * `previous` is the id set from the last known-good save or load. Deletions
 * are worked out against it rather than against "anything not in this list",
 * because the latter means a stale or half-built price list silently wipes
 * the real one. Callers debounce this.
 */
export async function savePricing(pricing, previous) {
  const categories = pricing.categories || [];
  const addOns = pricing.addOns || [];

  const categoryRows = categories.map((category, index) => ({
    id: category.id,
    category: category.category || "Untitled",
    commission_type: category.commissionType || null,
    commission_rate: num(category.commissionRate),
    sort_order: index,
  }));

  if (categoryRows.length) {
    const { error } = await supabase
      .from("service_categories")
      .upsert(categoryRows);
    if (error) throw error;
  }

  const itemRows = categories.flatMap((category) =>
    (category.items || []).map((item, index) => ({
      id: item.id,
      category_id: category.id,
      size: item.size || "",
      price: num(item.price),
      sort_order: index,
    }))
  );

  if (itemRows.length) {
    const { error } = await supabase.from("service_items").upsert(itemRows);
    if (error) throw error;
  }

  const addOnRows = addOns.map((addOn, index) => ({
    id: addOn.id,
    name: addOn.name || "Untitled",
    price: num(addOn.price),
    commission_rate: num(addOn.commissionRate),
    worker_sets_price: Boolean(addOn.workerSetsPrice),
    sort_order: index,
  }));

  if (addOnRows.length) {
    const { error } = await supabase.from("add_ons").upsert(addOnRows);
    if (error) throw error;
  }

  // Nothing to reconcile on a first write: there is no previous list, so
  // there is nothing the user can have removed.
  if (!previous) return;

  await Promise.all([
    deleteRemoved("service_categories", previous.categories, categoryRows),
    deleteRemoved("service_items", previous.items, itemRows),
    deleteRemoved("add_ons", previous.addOns, addOnRows),
  ]);
}

async function deleteRemoved(table, previousIds, currentRows) {
  const current = new Set(currentRows.map((row) => row.id));
  const removed = (previousIds || []).filter((id) => !current.has(id));

  if (!removed.length) return;

  const { error } = await supabase.from(table).delete().in("id", removed);
  if (error) throw error;
}

/* ------------------------------------------------------------- first run */

export async function isPricingEmpty() {
  const { count, error } = await supabase
    .from("service_categories")
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return (count || 0) === 0;
}

/*
 * Seeds only what is genuinely missing, matched on name.
 *
 * This has to be safe to run twice: a reload while the first seed was still
 * in flight used to leave two full copies of the price list, because every
 * call to buildDefaultPricing() mints new ids and nothing matched them up.
 * Matching on name instead makes a repeat seed a no-op.
 */
/*
 * Puts a couple of starter profiles in place so a brand new shop is not
 * staring at an empty worker dropdown on its first sale.
 *
 * Only ever runs on an untouched project. Once a single order exists, an
 * empty worker list is a deliberate choice -- the shop deleting the starters
 * after entering its own staff -- and must be left alone.
 */
export async function seedWorkers(initialWorkers) {
  const [workerCount, orderCount] = await Promise.all([
    supabase.from("workers").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }),
  ]);

  if (workerCount.error) throw workerCount.error;
  if (orderCount.error) throw orderCount.error;

  if ((workerCount.count || 0) > 0 || (orderCount.count || 0) > 0) return;

  const { error } = await supabase
    .from("workers")
    .insert(initialWorkers.map(toWorkerRow));

  if (error) throw error;
}

export async function seedPricing(defaultPricing) {
  const [existingCategories, existingAddOns] = await Promise.all([
    supabase.from("service_categories").select("id, category"),
    supabase.from("add_ons").select("id, name"),
  ]);

  if (existingCategories.error) throw existingCategories.error;
  if (existingAddOns.error) throw existingAddOns.error;

  const haveCategory = new Set(
    (existingCategories.data || []).map((row) => row.category)
  );
  const haveAddOn = new Set((existingAddOns.data || []).map((row) => row.name));

  const newCategories = (defaultPricing.categories || []).filter(
    (category) => !haveCategory.has(category.category)
  );

  const newAddOns = (defaultPricing.addOns || []).filter(
    (addOn) => !haveAddOn.has(addOn.name)
  );

  if (newCategories.length) {
    const { error } = await supabase.from("service_categories").insert(
      newCategories.map((category, index) => ({
        id: category.id,
        category: category.category,
        commission_type: category.commissionType || null,
        commission_rate: num(category.commissionRate),
        sort_order: index,
      }))
    );
    if (error) throw error;

    const itemRows = newCategories.flatMap((category) =>
      (category.items || []).map((item, index) => ({
        id: item.id,
        category_id: category.id,
        size: item.size || "",
        price: num(item.price),
        sort_order: index,
      }))
    );

    if (itemRows.length) {
      const { error: itemError } = await supabase
        .from("service_items")
        .insert(itemRows);
      if (itemError) throw itemError;
    }
  }

  if (newAddOns.length) {
    const { error } = await supabase.from("add_ons").insert(
      newAddOns.map((addOn, index) => ({
        id: addOn.id,
        name: addOn.name,
        price: num(addOn.price),
        commission_rate: num(addOn.commissionRate),
        worker_sets_price: Boolean(addOn.workerSetsPrice),
        sort_order: index,
      }))
    );
    if (error) throw error;
  }
}

const IMPORT_DONE_KEY = "mk4-auto-care-imported-at";

/*
 * Copies whatever a device still holds in localStorage into the database.
 *
 * The local copy is deliberately left in place: for records created before
 * the database existed it is the only backup there is, and a partly-finished
 * import must not be able to destroy it. A marker suppresses the banner
 * instead, so the import cannot be run twice by accident.
 */
export async function importLocalStorage(keys) {
  const summary = { workers: 0, orders: 0 };

  const localWorkers = readJson(keys.workers);
  const workerIdMap = {};

  for (const worker of localWorkers) {
    const created = await createWorker(worker);
    workerIdMap[worker.id] = created.id;
    summary.workers += 1;
  }

  const localOrders = readJson(keys.orders);

  for (const order of localOrders) {
    await importOrder({
      ...order,
      workerId: workerIdMap[order.workerId] || null,
    });
    summary.orders += 1;
  }

  localStorage.setItem(IMPORT_DONE_KEY, new Date().toISOString());

  return summary;
}

function readJson(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function hasLocalData(keys) {
  if (localStorage.getItem(IMPORT_DONE_KEY)) return false;

  return readJson(keys.workers).length > 0 || readJson(keys.orders).length > 0;
}
