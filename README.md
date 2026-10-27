# MK4 Auto Care POS

Point of sale for MK4 Auto Care: workers record each car on the Worker Form,
the office follows sales, commissions and staff.

- Live: https://mk4.kimberlyglazing.ph (also https://mk-4-carwash-pos.vercel.app)
- Staging: https://mk4-staging.vercel.app, for trying changes first (see [Staging](#staging))
- Frontend: React 19 + Vite 8, deployed by Vercel on every push to `main`
- Backend: Supabase (Postgres, Auth, Storage), project `vsxwwgglvckbjxvifxuw`

## Who sees what

Everyone logs in. The role on the employee's record decides what opens:

| Role | Opens | Login |
|---|---|---|
| Admin | Dashboard, Sales Records, Employees, Logins, Services | their own |
| Secretary | Worker Form (for any worker), Sales Records, Employees | shared `secretary@mk4.pos` |
| Worker | Worker Form; the sale is filed under the name they pick | shared `worker@mk4.pos` |

An employee's **Login Email** links them to a login. A Worker or Secretary
saved with it blank gets the shared login for their role. Setting someone
**Inactive** removes their access and hides them from the Worker Form.

Admins manage the logins themselves on the **Logins** page: add one (and
choose who uses it), change a password, log a login out on every device, or
delete one. It will not delete the login you are using or the last admin
login. Until its one-time setup below is done, logins are created in Supabase:
Authentication → Users → Add user → Create new user, with **Auto Confirm
User** ticked. Sign-ups from the app are off.

The database enforces all of this (row-level security and `create_order`);
the app only hides what a role cannot use.

### Logins page: one-time setup

Creating logins and setting passwords needs Supabase's secret key, which must
never reach the browser, so the page works through a small Supabase Edge
Function. It checks that the caller is an active Admin before doing anything.

1. **SQL Editor:** run `supabase/17_sign_out_everywhere.sql`.
2. **Edge Functions → Deploy a new function → Via Editor.** Name it
   `admin-logins`, replace the sample code with the whole of
   `supabase/functions/admin-logins/index.ts`, and deploy.
3. In that function's **Details**, switch off **Verify JWT with legacy
   secret** and save. The function verifies the caller itself, and this
   setting can refuse valid logins on projects using Supabase's newer
   signing keys.

There is nothing else to configure: Supabase gives the function its URL and
keys. If the app ever moves to another web address, add it to
`ALLOWED_ORIGINS` in the function and deploy it again.

## Run locally

```bash
npm install
```

Create `.env.local` (not committed):

```
VITE_SUPABASE_URL=https://vsxwwgglvckbjxvifxuw.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key from Supabase → Settings → API>
```

```bash
npm run dev
```

The dev server talks to the production database. Do not submit test sales
from it. To try things against the staging database instead:

```bash
npm run dev:staging
```

Checks, also run by GitHub Actions on every push:

```bash
npm run lint
npm test
npm run build
```

## Database changes

Schema changes are SQL files in `supabase/`, run by hand in the Supabase SQL
Editor in number order. `00_live_schema_snapshot.sql` records the schema as it
was on 2026-10-02 (before 10). Every later file says what it changes, why, and
whether the app must be deployed before or after it. When an app change needs
a new migration, deploy whichever side the file says first.

## Staging

A second copy of the app and database for trying changes before the shop
sees them: same screens, same database rules, test data only.

| | Live | Staging |
|---|---|---|
| Site | https://mk4.kimberlyglazing.ph | https://mk4-staging.vercel.app |
| Branch | `main` | `staging` |
| Supabase project | `vsxwwgglvckbjxvifxuw` | `hoezwrpnhgyltrqbomdc` (mk4-staging) |

The staging site shows an orange **Staging** tab at the top of every screen
and "[Staging]" in the browser tab. The live site never does.

How a build picks its database: Vercel builds `main` as Production, with the
live address and key from its Environment Variables (set for Production
only). Every other branch, `staging` and pull requests, is a Preview, and
`vite.config.js` points Previews at the staging database in `.env.staging`.
Nothing but `main` can reach the shop's data. Both values in `.env.staging`
are public; never put a secret key there.

**Working through staging:**

1. Commit to `staging` and push. The staging site updates in a minute or two.
2. If the change has a migration, run it in the **staging** project's SQL
   Editor first, then check it on the staging site.
3. When it is right, run the migration on live (if there is one, in the order
   the file says), then merge `staging` into `main` and push:

   ```bash
   git checkout main
   git merge --no-ff staging
   git push
   ```

   `--no-ff` matters. Vercel never builds a commit it has already deployed,
   and staging's commits have been, so a fast-forward merge could leave the
   live site on the old version. The merge commit is new, so it builds. For
   the same reason, pushing `staging` builds nothing until it has a commit of
   its own.

**Logins on staging** are separate from live's. Create them in the staging
project (Authentication → Users → Add user, **Auto Confirm User** ticked):
`admin@mk4.pos`, `secretary@mk4.pos` and `worker@mk4.pos`, with test
passwords that are not the live ones. The employees they belong to already
exist. Sign-ups from the app should be off, as on live (Authentication →
Sign In / Providers → Email → Allow new users to sign up).

The **Logins page** on staging needs the `admin-logins` function deployed to
the staging project too, the same way as on live (see above).

**Rebuilding the staging database** from scratch, into an empty project:

```bash
node scripts/build-staging-sql.mjs staging-sql
```

then run `staging-sql/staging-1.sql`, `staging-2.sql` and `staging-3.sql`,
in that order, in the staging SQL Editor. It is three scripts because 14
creates a constraint that 15 drops, and Postgres will not do both in one
transaction. It loads the default price list and two test workers. It holds
no customer data, and none should ever be copied there.

`Supabase Keep-Alive` pings staging daily too, so a quiet week does not pause
it.

**Weekly refresh.** Early every Saturday (00:07 Manila), `Staging Refresh`
(GitHub Actions) refills the staging database with a copy of the live data,
so staging looks like the shop does now. Customers' details are replaced in
the copy (names, phone numbers, plates, payment references, notes) and proof
images are not copied; money, services, dates, employees and prices come
across as they are, so staging's totals match live's. It only reads live,
writes only to a database holding the `mk4_staging.marker` row (which live
never has), and does it all in one transaction. Staging keeps its logins and
its own structure, so a migration being tried there survives; its test sales
are replaced. It needs two repo secrets, each just a database password:
`LIVE_DB_PASSWORD` (the backups use it too) and `STAGING_DB_PASSWORD`; until
then it skips. Run it by hand from the Actions tab whenever staging should
catch up sooner.

**Adding a database password as a secret:** in the project's Supabase
dashboard, **Database → Settings → Database password → Reset password**,
**Generate a password**, copy it, save. Then GitHub → this repo → **Settings
→ Secrets and variables → Actions → New repository secret**, give the name
and paste the password. Resetting is safe: the app, Keep-Alive and the Logins function use
API keys, never the database password. `scripts/supabase-db-url.sh` builds
the connection string from it, so nothing else needs copying.

After a refresh the staging logins open as live's employees: the admin login
as live's admin, and the shared worker and secretary logins as live's
Workers and Secretary.

## Looking after it

Nothing needs doing day to day. Every few months:

1. **Supabase → Organization → Usage.** The free plan allows a 500 MB database,
   1 GB of file storage (payment proofs, at most 50 KB each) and 5 GB of
   download traffic a month. Supabase emails before a limit is reached.
2. **Supabase → Advisors.** Should show no errors. Four "Signed-in users can
   execute SECURITY DEFINER function" warnings are intended (`create_order`,
   `my_access`, `my_employees`, `app_role`), as are "unused index" notes
   while the shop has few sales.
3. **GitHub → Actions.** `Supabase Keep-Alive` runs daily so a quiet week does
   not pause the free project. GitHub switches scheduled jobs off after 60 days
   without a commit and emails the repo owner; re-enable it from the Actions
   tab. If the project does pause, restore it from the Supabase dashboard.

When a worker leaves: set them Inactive. If they should no longer be able to
log in, change the shared worker password on the Logins page (that logs every
device out), then log the shop devices back in with the new one.

**Backups:** the free plan has none. `Supabase Backup` (GitHub Actions) takes an
encrypted daily dump once the `LIVE_DB_PASSWORD` and `BACKUP_PASSPHRASE` repo
secrets are set (keep a copy of the passphrase: no backup opens without it);
until then, export Sales Records to CSV now and then.
