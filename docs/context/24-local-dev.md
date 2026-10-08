# 24 — Local development: your own copy of the SIS database

This is for anyone working on the code. It explains how to run the SIS against a
database on your own computer, filled with fake but realistic school data, so you
can click through every module, break things and start over — without touching
production.

## What the local stack is

The "local stack" is a complete Supabase (the database, logins, file storage and
the API the app talks to) running on your machine inside **Docker**. Docker runs
programs in sealed boxes. An **image** is the packaged program (for example
"Postgres 17, as Supabase ships it"); a **container** is one running copy of an
image (ours are named `supabase_db_hfse-markbook`, `supabase_auth_hfse-markbook`
and so on — the suffix is `project_id` in `supabase/config.toml`); a **volume** is
the disk a container keeps its data on, so the database survives a restart of
Docker or of your computer. `npx supabase start` creates and starts all of it;
`npx supabase stop` stops it (your data stays in the volume).

The local database gets its **structure** (tables, functions, triggers, policies)
from a dump of production's schema, its **setup data** (years, terms, levels,
subjects, classes, calendar, permissions, houses, approval steps…) copied from
production, and its **people data** (students, applications, grades, attendance…)
from the seeder, which invents it. No real student, parent or staff member is in
it.

## One-time setup

1. **Install Docker Desktop** and start it. Wait until it says it is running.
2. **Start the stack** from the repo folder: `npx supabase start`. The first run
   downloads the images (a few GB) and takes a while. It prints the local URL
   and keys.
3. **Get the baseline from production.** Create `.env.prod-db` (git-ignored)
   with one line, `PROD_DB_URL="<production connection string>"` (ask Mr Ace),
   then run `npm run local:refresh` with your checkout on the commit
   production is on. It reads production only, writes three git-ignored files
   and holds no personal data:
   - `supabase/prod-schema.sql`: production's structure (`supabase db dump`);
   - `supabase/prod-config.sql`: the setup tables listed in
     `scripts/local/pull-prod-config.mjs` (levels, subjects, sections, terms,
     calendar, permissions…), never students;
   - `supabase/prod-schema.migrations.txt`: which migration files production
     already has, so later only newer ones are applied locally.
4. **Create `.env.development.local`** (git-ignored) in the repo folder:

   ```
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status`>
   SUPABASE_SERVICE_KEY=<SERVICE_ROLE_KEY from `npx supabase status`>
   RESEND_API_KEY=
   ```

   **What it does:** Next.js reads this file on top of `.env.local` whenever you
   run `next dev`, so while it exists **every `next dev` started in this folder
   talks to the local stack, not production**. It does not affect `next build`
   or anything deployed. The blank `RESEND_API_KEY` means no email ever leaves
   your machine. **To go back to production, delete (or rename) the file** and
   restart `next dev`.

5. **Build the data:** `npm run local:rebuild` (about 4 minutes; longer the first time, while Docker downloads images). Then
   `npm run dev` and sign in with one of the logins below.

Refreshing the baseline later (when production has moved on — new setup
data, or migrations applied there) is step 3 again, `npm run local:refresh`,
followed by `npm run local:rebuild`.

## The daily loop

| You want to…                                                               | Run                                                                                                      |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Pick up a teammate's new migration after `git pull`, **keeping your data** | `npm run local:migrate` (`-- --list` shows what is pending)                                              |
| Add the rows for a feature whose seeder phase is new                       | `npm run local:seed -- --only <phase>` (phases only add rows; `npm run local:seed -- --list` names them) |
| Start completely fresh (schema, setup data, all fake data)                 | `npm run local:rebuild`                                                                                  |
| Check the data is whole                                                    | `npm run local:seed -- --only verify`                                                                    |

`local:rebuild` resets the local database to empty, loads the schema dump and
`scripts/local/post-schema-fixups.sql` (changes production made after the dump
was taken), loads the setup data, recreates the `parent-portal` storage bucket,
marks the baseline migrations as applied and runs `local:migrate` for anything
newer, then runs the whole seeder and prints a one-screen summary: logins, row
counts, every check (each must say PASS) and the fingerprints. It refuses to run
unless `.env.development.local` points at `127.0.0.1` on the port in
`supabase/config.toml`, and it never reads `.env.prod-db`.

## The one rule: every database change lives in a file

Never change the local database by hand (Studio, a SQL console, a quick
`update`) and expect it to stay. A rebuild throws hand edits away, and a
teammate never sees them. A change to **structure** is a migration in
`supabase/migrations/` (production gets the same file). A change to **fake data**
is seeder code in `scripts/local/seed/`. If it is not in a file, it does not
exist.

## Logins

Every seeded account's password is **`localdev123`**.

| Who                       | Email                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Superadmin                | `admin@local.test`                                                                                                                                                                                      |
| Academic coordinators     | `coordinator@local.test` (also teaches Science), `coordinator2@local.test`                                                                                                                              |
| School admins (approvers) | `oic.primary@local.test`, `oic.secondary@local.test`, `asst.principal@local.test`, `aeb.member@local.test`                                                                                              |
| Admissions                | `admissions@local.test`, `documents@local.test` (the documents officer)                                                                                                                                 |
| Teachers                  | `teacher01@local.test` … `teacher26@local.test`, `relief@local.test` (cover teacher)                                                                                                                    |
| Parents                   | `…@example.com` — the mother's / father's email on a child's admissions record. The rebuild summary prints one; any parent who filed a declaration, re-uploaded a document or saved a draft has a login |

## What the seeder writes, phase by phase

The seeder (`scripts/local/seed/`, run with `npm run local:seed`) writes
through the app's own code wherever the app has a writer — the student sync,
the grading-sheet RPC, the attendance writer, the approval engine, the audit
logger — so the data has exactly the shape the app produces. Grades are raw
scores only; the database's own trigger computes every grade. Everything is
drawn from fixed random seeds with "today" fixed at **2026-10-07** (AY2026
Term 4 in progress), so two rebuilds give the same data.

| Phase             | What it adds                                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wipe`            | Empties every people-data table, the seeded logins and the stored files. Keeps the setup data.                                                                                                                                                      |
| `staff`           | 36 staff logins and the approver wiring (who approves which step).                                                                                                                                                                                  |
| `people`          | ~330 students; AY2025, AY2026 and AY2027 applications, status and document rows with production's real mess; class lists through the app's sync (late enrollees, withdrawals, one transfer, index numbers), houses, school numbers, discount codes. |
| `teachers`        | AY2026 form advisers, subject teachers, co-teachers and cover bookings (one live cover, one scheduled).                                                                                                                                             |
| `markbook`        | Grading sheets for AY2025 + AY2026, raw scores, custom weights, locks, post-lock corrections and two applied grade-change requests.                                                                                                                 |
| `attendance`      | A register mark per child per school day (AY2025, and AY2026 up to the day you run it).                                                                                                                                                             |
| `evaluation`      | Adviser write-ups (the report card comment).                                                                                                                                                                                                        |
| `publication`     | The one report-card publication (AY2026 Term 3, one class).                                                                                                                                                                                         |
| `declarations`    | 15 parent absence/travel declarations through every approval state, plus two certificates the school recorded.                                                                                                                                      |
| `discipline`      | One incident and the letter home about it.                                                                                                                                                                                                          |
| `classroom-notes` | Three teachers' private class notes.                                                                                                                                                                                                                |
| `pfiles`          | ~1,500 document re-uploads (the P-Files history), one staff upload, reminders and a promise.                                                                                                                                                        |
| `house-points`    | 8 House Points events with entries, teams and awards.                                                                                                                                                                                               |
| `portal-drafts`   | The parent portal's saved applications and recovery links.                                                                                                                                                                                          |
| `verify`          | Checks everything above and prints fingerprints. Writes nothing.                                                                                                                                                                                    |

**Never seeded:** the Directus tables (`directus_*`), the careers site's tables
(`careers_*`), the dormant PTC tables (`evaluation_checklist_items`,
`evaluation_checklist_responses`, `evaluation_subject_comments`,
`evaluation_ptc_feedback`) and `subject_weight_reconciliation_log`.

## Known limits

- **Timestamps the database stamps itself show the rebuild day**, not the
  story's day — for example audit_log `created_at` and most `updated_at`
  columns. Dates the seeder chooses (filing dates, register days, scores) are
  the story's.
- **Term 3 marks are shaped like the import**, as production's are: AY2025 and
  most of AY2026 came into production by workbook import, not by teachers typing
  in the app, so they carry no per-entry audit history.
- **A few things are dated from the day you run it**, on purpose, or the screens
  would show nothing current: AY2026 registers up to today, the live and
  scheduled cover bookings, the P-Files promise date and the portal's saved
  drafts. The verify fingerprints leave these out, so rebuilds on different days
  still match. The seeder refuses to run if your computer's date is before
  2026-10-07.
- **The API returns at most 1,000 rows per request** (`max_rows` in
  `supabase/config.toml`), the same as production. Kept on purpose: a page that
  silently stops at 1,000 rows breaks locally exactly as it would in production.

## Adding a phase for a new feature

When you build a feature with its own tables, give it its own seeder phase, so
a teammate can pick it up without losing their data
(`docs/superpowers/plans/2026-10-07-local-seeder.md`, ground rule 6):

1. Write the migration as usual; a teammate applies it with `npm run local:migrate`.
2. Add `scripts/local/seed/phases/<feature>.ts` exporting `run<Feature>()`. It
   must **only add rows** and be **idempotent on its own** — running it twice
   changes nothing — and it must write through the app's own route logic or lib
   functions, never invented shortcuts.
3. Register it in `scripts/local/seed/index.ts` after the phases it builds on.
4. Add its checks (counts, the app's own loaders reading the rows) and a
   fingerprint to the `verify` phase.
5. A teammate then runs `npm run local:migrate` and
   `npm run local:seed -- --only <feature>`. Only reshaping existing fake data
   needs a full `npm run local:rebuild`.
