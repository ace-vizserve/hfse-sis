# Year Setup Workbench (AY Rollover)

> **Status:** ✅ **Shipped (MVP 2026-04-20 + 8-step readiness engine + checklist dashboard 2026-07-08).** The Year Setup Workbench lives at `/sis/ay-setup` (school_admin + superadmin only — **registrar cannot reach this page**, see Access below). It has two tabs: **Year Setup** (a per-AY checklist dashboard, replacing the earlier Back/Next stepper) and **Manage years** (the AY list DataTable). Creating an AY runs `create_academic_year` atomically — `academic_years` row + 4 terms + copied sections + copied `subject_configs` + 4 AY-prefixed admissions tables. Switch-active + superadmin-gated delete ship alongside. **Role split:** create + switch-active = school_admin + superadmin; delete = superadmin only. The switcher is **DB-driven** (reads `academic_years` at render time); creating an AY makes it visible everywhere immediately with no code deploy.

## Why this doc exists

Before this shipped, rolling to a new AY required:

1. A developer inserting a row into `academic_years`.
2. A developer running a tailored `seed.sql`-like script to create the year's `terms`, `sections`, and `subject_configs`.
3. The parent-portal team provisioning the AY-prefixed admissions tables (`ay{YY}_enrolment_*` + `ay{YY}_discount_codes`) via their own migrations.
4. Someone flipping `academic_years.is_current` when ready.

HFSE's IT lead wanted this out of dev hands. The shipped AY Setup Wizard handles steps 1–3 in a single compound transaction inside the `create_academic_year` Postgres function, and step 4 is the "Switch active" button.

Step 3 moving into the wizard's scope requires a **coordination agreement with the parent-portal team** that the SIS is the source-of-truth for new-AY admissions DDL. The canonical schema source is `docs/context/10-parent-portal.md` §"Reference DDL" (frozen); both codebases continue to read/write the shared tables, but only the SIS's wizard creates new ones going forward.

The switcher and URL-param validation read `academic_years` at render time (via `listAyCodes()` in `lib/academic-year.ts`), so there's no compile-time constant to update when an AY is created — the switcher sees the new AY immediately on the next render. The earlier `SUPPORTED_AYS` constant + `isSupportedAyCode()` guard were removed as part of this work.

## What "creating an AY" actually requires

The compound operation:

| Entity                              | Rows / tables to create                                                                          | Source today                                                              | Wizard scope                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `academic_years`                    | 1 row (code + label + `is_current=false`)                                                        | Manual SQL / seed.sql                                                     | **wizard creates**                                                                                                                                     |
| `terms`                             | 4 rows (T1 / T2 / T3 / T4, `academic_year_id` → new AY, dates TBD)                               | seed.sql                                                                  | **wizard creates**                                                                                                                                     |
| `sections`                          | ~18 rows for HFSE (one per level × section name, e.g. P1 Patience, P1 Courageous, …)             | seed.sql                                                                  | **wizard creates** (copy-forward)                                                                                                                      |
| `subject_configs`                   | ~60–100 rows (one per subject × level × AY, weights like 40/40/20 Primary or 30/50/20 Secondary) | seed.sql                                                                  | **wizard creates** (copy-forward)                                                                                                                      |
| `subjects`                          | usually unchanged; occasionally a new subject is added (e.g. Economics in Sec 3)                 | manual                                                                    | **wizard creates** if step 3 adds any                                                                                                                  |
| `ay{YY}_enrolment_applications` DDL | 1 table                                                                                          | parent-portal migrations (frozen in `10-parent-portal.md` §Reference DDL) | **wizard creates** (parameterised DDL template, see §"Admissions DDL")                                                                                 |
| `ay{YY}_enrolment_status` DDL       | 1 table                                                                                          | parent-portal migrations                                                  | **wizard creates**                                                                                                                                     |
| `ay{YY}_enrolment_documents` DDL    | 1 table                                                                                          | parent-portal migrations                                                  | **wizard creates**                                                                                                                                     |
| `ay{YY}_discount_codes` DDL         | 1 table                                                                                          | parent-portal migrations                                                  | **wizard creates**                                                                                                                                     |
| `levels`                            | AY-invariant (P1–P6, S1–S4)                                                                      | seed.sql once                                                             | not touched                                                                                                                                            |
| ~~`SUPPORTED_AYS` constant~~        | ~~prepend new code~~                                                                             | ~~`lib/academic-year.ts`~~                                                | **removed 2026-04-20** — the switcher reads `academic_years` at render time via `listAyCodes()`; there's no longer a compile-time list to keep in sync |

The wizard owns **every DDL and every row** needed for the new AY to function inside the SIS. With the 2026-04-20 shift to a DB-driven switcher, the wizard is now fully autonomous — no code deploy follow-up is required. The AY appears in the switcher on the next page render.

## Admissions DDL (AY-prefixed tables)

The four `ay{YY}_enrolment_*` + `ay{YY}_discount_codes` tables are **required for the SIS to function for the new AY** — without them, every Records / P-Files / Admissions-dashboard query against the new AY errors. They're not a post-script handoff; they're part of what "creating an AY" means.

### Sourcing the DDL template

The canonical DDL for these tables is already **frozen in `docs/context/10-parent-portal.md` §"Reference DDL"** — it was pulled from the parent portal's Supabase project on 2026-04-14. That block is the source of truth.

Implementation plan:

1. Extract the DDL from `10-parent-portal.md` into a parameterised template at `lib/sis/ay-setup/admissions-ddl.ts` (new file). Template uses `${aySlug}` where the year prefix appears (e.g. `ay27_enrolment_applications`).
2. Wizard step runs the parameterised DDL via `createServiceClient().rpc('exec_sql', ...)` **or** a dedicated `/api/sis/ay-setup/admissions-ddl` route that executes via a Postgres function with `security definer`. (Supabase JS client can't run raw DDL via `.from()`; needs either `rpc` to a SQL function or a direct SQL call through a privileged helper.)
3. All `CREATE TABLE` statements use `IF NOT EXISTS`; all `ALTER TABLE ADD COLUMN` / index creates use `IF NOT EXISTS` guards. Re-running the wizard is a no-op if the tables already exist.
4. Wizard reads back the created tables via `information_schema.tables` and includes the list in the audit-log context.

### Coordination with the parent portal

Since the parent portal also writes to these tables (KD #12 parent-portal integration + KD #34 P-Files writes to `enrolment_applications` from staff side), the parent-portal team must agree that:

- The SIS owns the DDL creation for new AYs going forward.
- Both codebases write to the same schema; the DDL template in our repo is the source of truth.
- Any future schema bump flows: parent-portal team updates `10-parent-portal.md` reference DDL → we regenerate `admissions-ddl.ts` from it → run `ALTER TABLE` migration on existing AYs if needed.

**This is a coordination decision, not a code change.** Flag it as a prerequisite before the wizard ships so the parent-portal team isn't surprised.

### Safety

- `CREATE TABLE IF NOT EXISTS` — idempotent, safe to re-run.
- All four tables created in a single transaction alongside the SIS rows. If any table fails, the whole AY setup rolls back.
- Audit action `ay.create` context includes `{aySlug, tablesCreated: [...], rowsInserted: {...}}` for forensics.
- The wizard never drops or alters an existing AY's admissions tables. Past-AY DDL is immutable once created.

## Shipped: Year Setup Workbench

`/sis/ay-setup` (school_admin + superadmin, `ROUTE_ACCESS` gate + a page-level redirect-to-`/sis` for every other role — including registrar).

The page has two shadcn `Tabs`: **Year Setup** (default) and **Manage years**.

### Year Setup tab — checklist dashboard (replaces the stepper, 2026-07-08)

`components/sis/year-setup/year-setup-checklist.tsx` (`YearSetupChecklist`) renders the selected AY's readiness as a **checklist dashboard**, not a wizard. Layout:

- **Header strip** (the only progress indicator on the page): `AyPicker` (AY select, defaults to the current AY) + an AY status badge (Active / Early-bird open / Inactive) on the left; one readiness bar + "N of M ready" (required items only) on the right. Copy says "ready", never "step".
- **One card**, a `<ul className="divide-y divide-border">` with one row per readiness item (all 8 — see AY Readiness Pill below for the full list). Each row: a solid-tint status tile (mint done / amber partial / muted not-started — deliberately not gradient), a title + a **live plain-English data summary line** (`lib/sis/year-setup.ts::checklistSummary`, e.g. "4 of 4 terms dated · T1 Jan 6 – Mar 21", "School days cover 3 of 4 terms."), a status badge (Ready / In progress / Not started·Optional), and an in-place action on the right.
- **No step numbers, no Back/Next/Resume.** The **first incomplete required row** gets an indigo left-accent and its action renders as the page's one default-variant (gradient) `Button`; every other row's actions are `outline`/`ghost` — this replaces the old "Resume" affordance with an always-current "what's next" cue instead of a fixed sequence.
- Actions per row: Term dates → `TermDatesEditor` dialog; Calendar → `GenerateCalendarButton` + "Open calendar ↗"; Classes → `ApplyTemplateButton` + "Open template ↗"; Advisers → "Open Sections ↗" (deep-link only — no inline editor); Grading sheets → `GenerateSheetsDialog` + "Open Markbook ↗"; **Virtue themes → a `Collapsible` that expands the row in place to the existing `VirtueThemesEditor`** (same component `/evaluation/virtue-themes` uses, KD #137 — not a separate route, not part of `TermDatesEditor`); Letterhead → "Open School config ↗"; Application window → `AyAcceptingApplicationsToggle` inline plus a visible caption explaining the single-select early-bird rule (KD #118).
- The **Application window** row is the one optional item and sits below an "OPTIONAL" divider row — it never gets the "next up" accent.
- Empty state ("No academic year yet") unchanged from the original stepper.

### Manage years tab

`AySetupDataTable` — lists all `academic_years` rows. Per-row columns: AY code, label, `is_current` badge, `accepting_applications` toggle (with a short visible caption, same single-select explanation as above), actions menu (Switch active / Copy teacher assignments / Create sheets / Switch active / **Delete, visually separated by a `DropdownMenuSeparator` + destructive styling**). Inline editors for term dates directly in the table row. Below the table, a plain bulleted "Starting a new academic year" list (not numbered — deliberately dropped "step" vocabulary) walking through create → verify parent-portal readiness → switch active → optional delete → "work through the Year Setup tab for the new year."

### Create-AY flow (school_admin + superadmin)

`POST /api/sis/ay-setup` — creates the compound set atomically:

1. `create_ay_admissions_tables(ay_slug)` security-definer RPC — `CREATE TABLE IF NOT EXISTS` for all 4 admissions tables.
2. Insert `academic_years` row (`is_current=false`, `accepting_applications=false`).
3. Copy-forward `sections` + `subject_configs` from the prior AY (via `apply_template_to_ay` RPC for sections/configs).
4. Insert 4 `terms` (T1–T4) with placeholder dates.
5. Audit action `ay.create`.

AY code format is `AY\d{4}` (single calendar year — AY2026 = Jan–Nov 2026, not a 2025–2026 split). The switcher reads `academic_years` at render time via `listAyCodes()` — the new AY appears immediately everywhere with no code deploy.

### Switch-active-AY flow (school_admin + superadmin)

`PATCH /api/sis/ay-setup` — flips `is_current` across the two AYs atomically, auto-opens the new current AY for applications (`accepting_applications=true`), closes the outgoing AY (`accepting_applications=false`, KD #118). Requires typing the target code as confirmation. Audit action `ay.switch_current`.

### Early-bird applications toggle (KD #118)

Per-row `Switch` on the AY list (`components/sis/ay-accepting-applications-toggle.tsx`). Single-select enforcement: opening a non-current upcoming AY for applications closes every other non-current AY that was accepting, so at most one upcoming AY is ever open at a time. `PATCH /api/sis/ay-setup/accepting-applications` — gate school_admin + superadmin; audit action `ay.accepting_applications.toggle`.

### AY Readiness Pill (KD #109)

A separate floating readiness indicator in the SIS layout (`app/(sis)/layout.tsx`), visible to school_admin + superadmin. Not the same as the Year Setup checklist — this is a header-bar chip that opens a dialog. **It is suppressed on `/sis/ay-setup` itself** (2026-07-08) since the checklist dashboard on that page already renders the same readiness data in place — the pill stays everywhere else and deep-links here.

The readiness engine (`lib/sis/readiness.ts`) tracks **8 items** (7 required + 1 optional), not 4 — `STEP_META`'s `ReadinessStepId` union is `'ay-setup' | 'calendar' | 'classes' | 'advisers' | 'grading-sheets' | 'virtue-themes' | 'letterhead' | 'app-window'`:

1. **AY Setup** (required) — terms exist with dated start/end.
2. **School Calendar** (required) — school_day-type rows present for all terms.
3. **Classes & subjects** (required) — sections + subject_configs exist for the AY.
4. **Form advisers** (required) — every section has a form adviser assigned.
5. **Grading Sheets** (required) — all sections have grading sheets created.
6. **Virtue themes** (required) — T1–T3 terms each have a `virtue_theme` set.
7. **Report-card letterhead** (required) — `school_config` has an organization name + address.
8. **Application window** (optional) — the AY's early-bird `accepting_applications` window is open.

`complete`/`total` on `AyReadiness` count **required items only** (currently 7) — the optional Application-window item never blocks "all set." Pill turns amber "Setup needed" when any required item is incomplete. Source: `lib/sis/readiness.ts::getAyReadiness(ayCode)` (`unstable_cache`, tag `sis:${ayCode}`).

### Delete-AY flow (superadmin only)

Guarded to truly empty AYs only (no child rows in terms / sections / section*students / grading_sheets / grade_entries / attendance_records / report_card_publications / grade_change_requests / any `ay{YY}*\*`admissions table rows).`DELETE /api/sis/ay-setup`→ confirm dialog requiring the admin to type the AY code → drops 4 admissions tables + removes SIS rows atomically. Audit action`ay.delete`.

## Safety rails

- **Role split.** Create + switch-active = school_admin + superadmin. Delete = **superadmin only** (destructive + irreversible).
- **Idempotent uniqueness.** `ay_code` unique constraint on `academic_years`; the route returns a clear error on duplicate.
- **Single transaction.** All-or-nothing. Partial failure rolls back.
- **Audit log.** Actions: `ay.create`, `ay.switch_current`, `ay.delete`, `ay.accepting_applications.toggle`. Context includes full rowcount/tablecount breakdown.
- **Delete is guarded, not forbidden.** Runs only on truly empty AYs. Always destructive-confirm (type the AY code). `DROP TABLE IF EXISTS` is idempotent.
- **No pre-emptive `is_current` flip.** Created as `is_current=false`. Flipping is a deliberate separate action.
- **Server-side re-validation.** Every role check + emptiness check runs on the server, not just the client.

## Scope boundaries

| In scope (v1)                                                                                                  | Out of scope (v1)                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Create `academic_years` + `terms` + `sections` + `subject_configs` rows                                        | Runtime-writable column additions to admissions tables (dev still owns schema bumps)                               |
| Create the 4 admissions DDL tables (`ay{YY}_enrolment_*` + `ay{YY}_discount_codes`) via parameterised template | Schema-drift detection — if parent portal updates the DDL and forgets to update our template, we don't auto-detect |
| Copy-forward from previous AY with per-row opt-out                                                             | Retroactive DDL migrations on already-created AYs                                                                  |
| Add / remove subjects + adjust weights inline                                                                  | Bulk-edit weights across AYs after creation                                                                        |
| Switch-active-AY action (admin + superadmin, confirmation required)                                            | Auto-rolling over mid-year based on a date trigger                                                                 |
| **Delete-AY action (superadmin-only, guarded to empty AYs)**                                                   | **Archive / retire an AY that has historical data** (revisit if HFSE asks)                                         |
| Audit-logged create + switch + delete                                                                          | Add-column / schema-modification UI (skipped per 2026-04-20 decision)                                              |
| Per-row failure visibility in the transaction                                                                  | Partial commits                                                                                                    |

## Data model

**No new SIS-owned tables.** The wizard's operation is:

**DDL (4 new tables per AY)** — idempotent `CREATE TABLE IF NOT EXISTS`:

- `ay{YY}_enrolment_applications`
- `ay{YY}_enrolment_status`
- `ay{YY}_enrolment_documents`
- `ay{YY}_discount_codes`

Template lives in `lib/sis/ay-setup/admissions-ddl.ts` (new file), generated from the canonical frozen DDL in `docs/context/10-parent-portal.md` §"Reference DDL". The wizard interpolates `${aySlug}` (e.g. `ay27`) into the template strings. Two Postgres functions with `security definer` execute the DDL (Supabase JS can't run raw DDL through `.from()`):

- `public.create_ay_admissions_tables(ay_slug text)` — `CREATE TABLE IF NOT EXISTS` for all 4 tables.
- `public.drop_ay_admissions_tables(ay_slug text)` — `DROP TABLE IF EXISTS` for all 4 tables (used by delete-AY). Function body includes a pre-flight check that every target table has zero rows before issuing the drops, so even a stray client call can't accidentally destroy data.

**DML (rows on existing SIS tables)** — all in one transaction:

- `academic_years` — one INSERT
- `terms` — four INSERTs
- `sections` — N INSERTs (HFSE: ~18, copy-forward from prior AY)
- `subject_configs` — N INSERTs (HFSE: ~60–100, copy-forward)
- `subjects` — optional INSERTs if curriculum changes

New audit actions: `ay.create`, `ay.switch_current`, `ay.delete`. Writes via `createServiceClient()` in a new `/api/sis/ay-setup/route.ts` (POST for create, PATCH for switch-active, DELETE for delete-AY). Schema validation via new `lib/schemas/ay-setup.ts`.

Cache invalidation: `revalidateTag('sis:${newAyCode}', 'max')` after creation or deletion; also invalidate `sis:${prevAyCode}` on switch-active-AY to refresh the dashboard banner.

## Placement

- **Route:** `/sis/ay-setup` (school_admin + superadmin — see Access).
- **Sidebar:** under SIS Admin (school_admin + superadmin only; registrar doesn't see this entry — `ROUTE_ACCESS` gates the whole prefix).
- **Components (current):**
  - `app/(sis)/sis/ay-setup/page.tsx` — the two-tab shell (Year Setup / Manage years) + role redirect + all server-side loaders.
  - `components/sis/year-setup/year-setup-checklist.tsx` — the Year Setup tab's checklist dashboard (`YearSetupChecklist`), plus its two mutation buttons (`GenerateCalendarButton`, `ApplyTemplateButton`).
  - `components/sis/year-setup/ay-picker.tsx` — the header-strip AY select.
  - `lib/sis/year-setup.ts` — `checklistSummary`, `resolveSelectedAyCode`, `ayStatusTone`/`AY_STATUS_LABEL` (pure helpers backing the checklist).
  - `components/sis/ay-setup-wizard.tsx` — the "New AY" creation flow (`NewAyButton` + its multi-step dialog). The copy-forward review grid for the new-AY preview is inline inside this file as a `ReviewRow` component — there is no separate `ay-copy-forward-preview.tsx` file.
  - `components/sis/ay-setup-data-table.tsx` — the Manage-years tab's AY list table + its row dialogs/menu.
  - `components/sis/ay-readiness-pill.tsx` — the floating pill (suppressed on `/sis/ay-setup` itself, see AY Readiness Pill above).

## Access

**The whole page is gated to `school_admin` + `superadmin` — registrar cannot reach `/sis/ay-setup` at all.** Both layers agree: `ROUTE_ACCESS` (`lib/auth/roles.ts`) has an explicit `{ prefix: '/sis/ay-setup', allowed: ['school_admin', 'superadmin'] }` entry (evaluated before the broader `/sis` rule, longer-prefix-wins), and the page component itself (`app/(sis)/sis/ay-setup/page.tsx`) redirects any session whose role is not `school_admin`/`superadmin` — including `registrar` — to `/sis`. This is a page-level gate, not merely per-action; the table below is the finer-grained split **within** that already-narrowed audience:

| Action                       | Roles allowed                | Rationale                                                              |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Reach `/sis/ay-setup` at all | `school_admin`, `superadmin` | Registrar does not see this surface (see note above).                  |
| Create AY                    | `school_admin`, `superadmin` | Reversible via delete.                                                 |
| Switch active AY             | `school_admin`, `superadmin` | Reversible (switch back) and audited.                                  |
| Early-bird toggle            | `school_admin`, `superadmin` | Config surface (KD #118 — Admissions reads, SIS Admin owns).           |
| Delete AY (empty AYs only)   | `superadmin` only            | Destructive + irreversible. Matches KD #2's destructive-ops carve-out. |

Registrar-edited config that lives on related data (e.g. virtue themes) is reached through **other** surfaces registrar can access — e.g. `/evaluation/virtue-themes` (KD #137) — not through this page. Teachers, parents, p-file officers, and the admissions role never reach this surface either.

## Resolved decisions

- ✅ **Nav placement:** `/sis/ay-setup` under SIS Admin (school_admin + superadmin only — registrar does not see this page; see Access above).
- ✅ **Term dates:** optional at creation, editable inline via `TermDatesEditor` from either the Year Setup checklist's "Term dates" row or the Manage-years AY list table. The AY Readiness Pill's "AY Setup" item turns partial/amber when terms have no dates.
- ✅ **Subject weight editing after creation:** `/sis/admin/subjects` matrix tab handles per-AY weight CRUD post-creation. The `sync_grading_sheets_from_config` RPC (KD #99) propagates weight changes to unlocked sheets.
- ✅ **Admissions DDL:** `create_ay_admissions_tables` is a security-definer Postgres function shipped via migrations. KD #119 documents the regression pattern (re-emitting the function from a stale body silently drops columns added by later migrations — always diff against the live definition).
- ✅ **Discount codes:** copy-forward not built; the admissions team adds codes manually per AY via `/sis/admin/discount-codes` (KD #133 widened access to the `admissions` role).
- ✅ **Returning-student re-enrolment:** parents re-initiate via portal; no auto-create on rollover.
- ✅ **Archive semantics:** prior-AY rows stay in the switcher with `is_current=false`. No "archived" state needed yet.

## See also

- `04-database-schema.md` — DDL for `academic_years`, `terms`, `sections`, `subject_configs`.
- `lib/academic-year.ts` — `listAyCodes` (DB-driven switcher list), `getCurrentAcademicYear`, `requireCurrentAyCode`.
- `13-sis-module.md` — Records module audit action prefix + zod-schema validation pattern, to mirror.
- `CLAUDE.md` KD #2 (superadmin role carve-out) + KD #14 (dynamic AY).
- `10-parent-portal.md` — admissions DDL reference; the DDLs the parent-portal team would provision.
- `supabase/seed.sql` — the current manual path; wizard replaces the SIS-side rows it handles.
