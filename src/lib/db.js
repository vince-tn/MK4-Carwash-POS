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
  order_services ( id, category, size, price, commission_type, commission_rate ),
  order_addons ( id, name, price )
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
    })),
    selectedAddOns: (row.order_addons || []).map((addOn) => addOn.name),
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
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    rows.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows.map(toAppOrder);
}

export async function createOrder(order) {
  // A worker_id only exists once workers live in the database; guard against
  // the id being a leftover local string rather than a uuid.
  const workerId =
    typeof order.workerId === "string" && order.workerId.includes("-") &&
    order.workerId.length === 36
      ? order.workerId
      : null;

  const { data, error } = await supabase
    .from("orders")
    .insert({
      sales_order_id: order.id,
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
    })
    .select("id")
    .single();

  if (error) throw error;

  await insertOrderChildren(data.id, order);

  const { data: full, error: readError } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", data.id)
    .single();

  if (readError) throw readError;
  return toAppOrder(full);
}

async function insertOrderChildren(orderId, order) {
  const services = (order.services || []).filter((service) => service.category);

  if (services.length) {
    const { error } = await supabase.from("order_services").insert(
      services.map((service) => ({
        order_id: orderId,
        category: service.category,
        size: service.size || "",
        price: num(service.price),
        commission_type: service.commissionType || null,
        commission_rate: num(service.commissionRate),
      }))
    );
    if (error) throw error;
  }

  const addOnNames = order.selectedAddOns || [];

  if (addOnNames.length) {
    const { error } = await supabase.from("order_addons").insert(
      addOnNames.map((name) => ({
        order_id: orderId,
        name,
        price: num(order.addOnPrices?.[name]),
      }))
    );
    if (error) throw error;
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

/* ----------------------------------------------------------------- workers */

function toAppWorker(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role || "Washer",
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
    role: worker.role || "Washer",
    phone: worker.phone || null,
    address: worker.address || null,
    status: worker.status || "Active",
    date_joined: worker.dateJoined || null,
    notes: worker.notes || null,
    commission_mode: worker.commissionMode || "inherit",
    commission_value: num(worker.commissionValue),
  };
}

export async function fetchWorkers() {
  const { data, error } = await supabase
    .from("workers")
    .select("*")
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
  // Orders keep worker_name, so history survives a worker being removed.
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
    await createOrder({
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
