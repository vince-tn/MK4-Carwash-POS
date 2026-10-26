// Writes the SQL that builds the staging database from scratch, from the
// files in this repo, as three scripts to run one after the other in the
// staging project's SQL Editor:
//
//   staging-1.sql  the live schema snapshot, the rows the app expects, 10-14
//   staging-2.sql  15-22
//   staging-3.sql  the default price list, 23, two test workers, a summary
//
// Three, not one: 14 creates a constraint that 15 drops, and Postgres refuses
// to do both in one transaction ("could not open relation with OID ...").
// Each script is all or nothing, so a failure keeps nothing from that script.
//
// For an EMPTY staging project only. Never run these on live. Logins are not
// made here: add them in staging's Authentication -> Users (see README).
//
// Usage: node scripts/build-staging-sql.mjs <output folder>
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];

if (!out) {
  console.error("Usage: node scripts/build-staging-sql.mjs <output folder>");
  process.exit(1);
}

const read = (file) =>
  `-- ===== ${file} =====\n` +
  fs.readFileSync(path.join(repo, "supabase", file), "utf8").replace(/\r\n/g, "\n");

const { buildDefaultPricing } = await import(
  pathToFileURL(path.join(repo, "src/data/pricing.js")).href
);

const q = (value) =>
  value === null || value === undefined ? "null" : `'${String(value).replaceAll("'", "''")}'`;

const pricing = buildDefaultPricing();

// The same rows the app seeds when the price list is empty (src/data/pricing.js).
// Before 23, which checks that the Labor add-on exists.
const priceList = [
  "-- ===== default price list (src/data/pricing.js) =====",
  ...pricing.categories.map(
    (category, i) =>
      `insert into public.service_categories (category, commission_type, commission_rate, sort_order) values (${q(category.category)}, ${q(category.commissionType || null)}, ${Number(category.commissionRate) || 0}, ${i}) on conflict (category) do nothing;`
  ),
  ...pricing.categories.flatMap((category) =>
    category.items.map(
      (item, i) =>
        `insert into public.service_items (category_id, size, price, sort_order) select id, ${q(item.size)}, ${Number(item.price) || 0}, ${i} from public.service_categories where category = ${q(category.category)} on conflict (category_id, size) do nothing;`
    )
  ),
  ...pricing.addOns.map(
    (addOn, i) =>
      `insert into public.add_ons (name, price, commission_rate, worker_sets_price, sort_order) values (${q(addOn.name)}, ${Number(addOn.price) || 0}, ${Number(addOn.commissionRate) || 0}, ${Boolean(addOn.workerSetsPrice)}, ${i}) on conflict (name) do nothing;`
  ),
].join("\n");

const header = (n) => `-- MK4 POS STAGING DATABASE, part ${n} of 3 (scripts/build-staging-sql.mjs).
-- For an empty staging project only. NEVER RUN THIS ON LIVE.`;

const scripts = {
  "staging-1.sql": [
    header(1),
    read("00_live_schema_snapshot.sql"),
    `-- ===== rows the app expects =====
insert into public.keep_alive (id) values (1) on conflict (id) do nothing;
insert into public.commission_settings (global_mode, global_value)
select 'service_percent', 0
 where not exists (select 1 from public.commission_settings);`,
    ...[
      "10_create_order.sql",
      "11_limit_public_access.sql",
      "12_indexes.sql",
      "13_addon_commissions.sql",
      "14_roles.sql",
    ].map(read),
  ],
  "staging-2.sql": [
    header(2),
    ...[
      "15_shared_logins.sql",
      "16_advisor_fixes.sql",
      "17_sign_out_everywhere.sql",
      "18_secretary_worker_form.sql",
      "19_bank_payment.sql",
      "20_archive_sales.sql",
      "21_keep_sales_when_a_worker_goes.sql",
      "22_who_changed_a_sale.sql",
    ].map(read),
  ],
  "staging-3.sql": [
    header(3),
    priceList,
    read("23_payments_after_the_sale.sql"),
    `-- ===== test workers (staging only) =====
insert into public.workers (name, role, status, commission_mode, commission_value, notes)
select v.name, 'Worker', 'Active', 'inherit', 0, 'Staging test worker'
  from (values ('Test Worker A'), ('Test Worker B')) as v(name)
 where not exists (select 1 from public.workers w where w.name = v.name);`,
    `-- ===== summary =====
select
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') as tables,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity) as tables_without_rls,
  (select count(*) from pg_policies where schemaname = 'public') as rules,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) as functions,
  (select count(*) from public.service_categories) as services,
  (select count(*) from public.service_items) as sizes,
  (select count(*) from public.add_ons) as add_ons,
  (select string_agg(name || ' (' || role || ', ' || status || ', ' || coalesce(login_email, 'no login') || ')', '; ' order by name) from public.workers) as employees;`,
  ],
};

fs.mkdirSync(out, { recursive: true });

for (const [file, parts] of Object.entries(scripts)) {
  const sql = parts.join("\n\n") + "\n";
  fs.writeFileSync(path.join(out, file), sql);
  console.log(`${path.join(out, file)}  ${sql.length} characters`);
}
