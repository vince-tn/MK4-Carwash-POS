# MK4 Auto Care POS

Point of sale for MK4 Auto Care: workers record each car on the Worker Form,
the office follows sales, commissions and staff.

- Live: https://mk4.kimberlyglazing.ph (also https://mk-4-carwash-pos.vercel.app)
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
from it unless you delete them afterwards.

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
encrypted daily dump once the `SUPABASE_DB_URL` (Session pooler connection
string) and `BACKUP_PASSPHRASE` repo secrets are set; until then, export Sales
Records to CSV now and then.
