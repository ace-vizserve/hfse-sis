# AY Setup Wizard (AY Rollover)

> **Status:** ✅ **Shipped 2026-04-20 (MVP).** Wizard live at `/sis/ay-setup`. Creates `academic_years` row + 4 terms + copied sections + copied subject_configs + 4 AY-prefixed admissions tables (`ay{YY}_enrolment_*` + `ay{YY}_discount_codes`) atomically via the `create_academic_year` Postgres function. Switch-active + superadmin-gated delete ship alongside. **Role split:** create + switch-active = admin + superadmin; delete = superadmin only. The switcher is **DB-driven** (reads `academic_years` at render time), so creating an AY makes it visible everywhere immediately — no code deploy step.

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

| Entity | Rows / tables to create | Source today | Wizard scope |
|---|---|---|---|
| `academic_years` | 1 row (code + label + `is_current=false`) | Manual SQL / seed.sql | **wizard creates** |
| `terms` | 4 rows (T1 / T2 / T3 / T4, `academic_year_id` → new AY, dates TBD) | seed.sql | **wizard creates** |
| `sections` | ~18 rows for HFSE (one per level × section name, e.g. P1 Patience, P1 Courageous, …) | seed.sql | **wizard creates** (copy-forward) |
| `subject_configs` | ~60–100 rows (one per subject × level × AY, weights like 40/40/20 Primary or 30/50/20 Secondary) | seed.sql | **wizard creates** (copy-forward) |
| `subjects` | usually unchanged; occasionally a new subject is added (e.g. Economics in Sec 3) | manual | **wizard creates** if step 3 adds any |
| `ay{YY}_enrolment_applications` DDL | 1 table | parent-portal migrations (frozen in `10-parent-portal.md` §Reference DDL) | **wizard creates** (parameterised DDL template, see §"Admissions DDL") |
| `ay{YY}_enrolment_status` DDL | 1 table | parent-portal migrations | **wizard creates** |
| `ay{YY}_enrolment_documents` DDL | 1 table | parent-portal migrations | **wizard creates** |
| `ay{YY}_discount_codes` DDL | 1 table | parent-portal migrations | **wizard creates** |
| `levels` | AY-invariant (P1–P6, S1–S4) | seed.sql once | not touched |
| ~~`SUPPORTED_AYS` constant~~ | ~~prepend new code~~ | ~~`lib/academic-year.ts`~~ | **removed 2026-04-20** — the switcher reads `academic_years` at render time via `listAyCodes()`; there's no longer a compile-time list to keep in sync |

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

## Proposed wizard flow

Multi-step form at `/sis/ay-setup` (superadmin-only; `ROUTE_ACCESS` gate + layout check), modelled on the `edit-stage-dialog.tsx` + `new-sheet` form patterns already in use.

### Step 1 — AY identity
- `ay_code` (required, format `AY\d{4}`, uniqueness checked against `academic_years`). **HFSE convention:** the four digits are the calendar year. AY2026 = January–November 2026 (single calendar year, not a 2025–2026 split).
- `label` (auto-suggested from code, e.g. `AY2027` → `Academic Year 2027`; editable)
- `is_current` stays `false` at creation (separate step to switch the active AY — see §Safety rails)
- `accepting_applications` (KD #77, default off) — when checked, the new AY immediately surfaces in the Admissions sidebar's "Upcoming AY applications" entry and the parent portal accepts submissions for it. Leave off if you're staging the AY ahead of opening early-bird; flip on later from the AY-list row's "Open for apps" toggle.

Uniqueness is validated both client-side (the API `POST` pre-check returns `{ ok: true, alreadyExisted: true }` without mutating) and server-side (the `academic_years.ay_code` unique constraint is the safety net against races).

### Step 2 — Copy-forward sections + subject_configs
- Dropdown: "Copy sections + subject weights from" → defaults to the most recent AY (by `ay_code` desc).
- Preview grid: shows the sections that will be cloned (level × section name), and subject_configs (subject × level × weights).
- Admin can toggle individual rows off (e.g. "don't copy Sec 3 Economics this year").
- Rationale: sections rarely change year-to-year; subject weights almost never. Copy-forward is 95% correct; edit is the 5% exception.

### Step 3 — Curriculum edit (optional)
- Add new subjects (inserts into `subjects` if new; creates `subject_configs` for applicable levels × the new AY).
- Remove subjects from specific levels for the new AY (no insert into `subject_configs` for that combination).
- Adjust weights on any subject_config row.
- Default: skip this step (copy-forward is good enough).

### Step 4 — Terms
- Auto-create 4 terms (T1–T4) for the new AY. Term labels fixed ("Term 1 – Quarter 1", etc.).
- Term dates (start / end) optional but recommended — these drive the publish window defaults later.

### Step 5 — Review + commit
- Single summary screen: "You're about to insert: 1 AY row, 4 terms, 18 sections, 82 subject_configs, 2 new subjects; create 4 admissions tables (`ay27_enrolment_applications`, `_status`, `_documents`, `ay27_discount_codes`)."
- Commit button runs the full compound operation in a single transaction:
  1. `CREATE TABLE IF NOT EXISTS` for all 4 admissions tables using the template in `lib/sis/ay-setup/admissions-ddl.ts`.
  2. Insert the `academic_years` row.
  3. Insert the `terms`, `sections`, `subject_configs` (+ optional `subjects`) rows.
  4. Write one `audit_log` row, action `ay.create`, context with the full breakdown.
- On success → redirect to the new AY's overview; show a **Follow-up Actions** card with:
  - ✅ Created admissions tables (4) + SIS rows (1 + 4 + ~18 + ~82). Switcher already lists the new AY on all AY-scoped pages.
  - 🔶 **When ready:** flip `is_current` via the "Switch active AY" action on `/sis/ay-setup`.

### Switch-active-AY flow (separate action, admin + superadmin)
A small button on the AY Setup landing page: "Switch active AY from AY2026 → AY2027." Runs `UPDATE academic_years SET is_current = (ay_code = 'AY2027')`, audited, requires typing the target code as confirmation (destructive-confirm pattern).

### Delete-AY flow (separate action, superadmin only)
A "Delete" button on each AY's row in the AY Setup landing list. Renders **only for superadmin** and is **disabled** under any of these conditions (with tooltip explaining why):

- The AY is `is_current=true`.
- Any child rows exist: `terms`, `sections`, `subject_configs` (copied-forward rows count as data), `section_students`, `grading_sheets`, `grade_entries`, `attendance_records`, `report_card_publications`, `grade_change_requests`, or any rows in the 4 AY-prefixed admissions tables (`ay{YY}_enrolment_*`, `ay{YY}_discount_codes`).

If the AY is truly empty, clicking Delete opens an `AlertDialog`:

> **Delete AY2027?** This will drop 4 admissions tables (`ay27_enrolment_applications`, `_status`, `_documents`, `ay27_discount_codes`) and remove the AY + terms + sections + subject_configs rows. This cannot be undone. Type **AY2027** to confirm.

On confirm, the backend runs in a single transaction:
1. Pre-flight emptiness check (repeats the server-side gate — never trust client).
2. `DROP TABLE IF EXISTS ay{YY}_enrolment_applications, _status, _documents, ay{YY}_discount_codes` via the same `security definer` helper used for creation.
3. `DELETE FROM subject_configs / sections / terms / academic_years` for the AY.
4. Audit row, action `ay.delete`, context: `{aySlug, droppedTables: [...], deletedRowCounts: {...}}`.

Delete is intentionally narrow — it's the *inverse of creation for mis-created AYs*, not a way to retire historical years. Archival of old AYs with real data is a separate future feature if HFSE ever asks for it.

## Safety rails

- **Role split.** Create + switch-active-AY are `admin + superadmin` (aligned with KD #32's "admin = full operator" direction). Delete is **superadmin only** — destructive + irreversible, matches KD #2's reservation of destructive ops for superadmin.
- **Idempotent uniqueness.** `ay_code` unique constraint on `academic_years` already in `001_initial_schema.sql`; wizard shows a clear error before committing.
- **Single transaction for the compound insert.** All-or-nothing. Partial failure rolls back; wizard shows the specific failing row.
- **Audit log.** New actions: `ay.create`, `ay.switch_current`, `ay.delete`. Context includes the full rowcount / tablecount breakdown.
- **Delete is guarded, not forbidden.** Can only run on a truly empty AY (no child rows in any related table, not `is_current`). Always a destructive-confirm dialog requiring the admin to type the AY code. `DROP TABLE IF EXISTS` is idempotent and safe to re-run.
- **No pre-emptive `is_current` flip.** Wizard creates the AY as `is_current=false`. Flipping is a deliberate separate action — the admin decides when the new AY becomes the live default.
- **Dry-run / preview step.** Review screen (step 5) shows the exact SQL-equivalent summary before commit.
- **Server-side re-validation.** Every role check + emptiness check runs on the server in the API route, not just the client. The UI disables buttons for UX; the server enforces the actual gate.

## Scope boundaries

| In scope (v1) | Out of scope (v1) |
|---|---|
| Create `academic_years` + `terms` + `sections` + `subject_configs` rows | Runtime-writable column additions to admissions tables (dev still owns schema bumps) |
| Create the 4 admissions DDL tables (`ay{YY}_enrolment_*` + `ay{YY}_discount_codes`) via parameterised template | Schema-drift detection — if parent portal updates the DDL and forgets to update our template, we don't auto-detect |
| Copy-forward from previous AY with per-row opt-out | Retroactive DDL migrations on already-created AYs |
| Add / remove subjects + adjust weights inline | Bulk-edit weights across AYs after creation |
| Switch-active-AY action (admin + superadmin, confirmation required) | Auto-rolling over mid-year based on a date trigger |
| **Delete-AY action (superadmin-only, guarded to empty AYs)** | **Archive / retire an AY that has historical data** (revisit if HFSE asks) |
| Audit-logged create + switch + delete | Add-column / schema-modification UI (skipped per 2026-04-20 decision) |
| Per-row failure visibility in the transaction | Partial commits |

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

- **Route:** `/sis/ay-setup` (superadmin-only). Or nested `/sis/admin/ay-setup` if we grow a superadmin admin sub-area in Records.
- **Sidebar:** add under Records sidebar for superadmins only (gate in `NAV_BY_MODULE.sis` with a role check — or render conditionally in `components/sis-sidebar.tsx`).
- **Components:**
  - `app/(sis)/sis/ay-setup/page.tsx` — wizard landing (list existing AYs + "New AY" button + "Switch active" button).
  - `components/sis/ay-setup-wizard.tsx` — multi-step form (shadcn Tabs or stepped navigation, same pattern as existing SIS dialogs).
  - `components/sis/ay-copy-forward-preview.tsx` — the step-2 grid.

## Access

Per-action, not per-surface:

| Action | Roles allowed | Rationale |
|---|---|---|
| View AY list | `registrar`, `admin`, `superadmin` | Read-only visibility into what exists. |
| Create AY (wizard) | `admin`, `superadmin` | Aligned with KD #32: admin is "full operator." Reversible via delete. |
| Switch active AY | `admin`, `superadmin` | Same bracket as create — it's reversible (switch back) and audited. |
| Delete AY | `superadmin` only | Destructive + irreversible. Matches KD #2's destructive-ops carve-out. |

Registrar sees the AY list but none of the mutation buttons. Teachers, parents, p-file officers never reach this surface.

## Open questions

- [ ] **Where exactly does AY setup sit in the nav?** Nested under Records sidebar, or its own top-level admin surface? Depends on whether user-role / weight-config admin joins it later.
- [ ] **Term dates** — required, optional, or pre-filled from a school-calendar import? HFSE likely has a set calendar per AY.
- [ ] **Subject weight editing after AY creation** — the wizard handles initial setup; can superadmins edit `subject_configs` rows later, or does that require a separate UI?
- [ ] **Parent-portal coordination agreement** — the wizard now owns the DDL for AY-prefixed admissions tables. Need explicit agreement with the parent-portal team that (a) the SIS is the source-of-truth for new-AY DDL creation, (b) schema drift is caught by keeping `10-parent-portal.md` §Reference DDL in lockstep with `lib/sis/ay-setup/admissions-ddl.ts`, and (c) both codebases continue writing to the shared schema.
- [ ] **`create_ay_admissions_tables` helper function** — this needs to be a `security definer` Postgres function (DDL privileges required). Do we ship it via a migration (e.g. `012_ay_admissions_ddl_helper.sql`) or define it ad-hoc? Migration is cleaner.
- [ ] **Schema-drift detection** — if parent-portal bumps a column on AY2027 after we've created the table, who notices? Option: a `structure-diff` check on each wizard run comparing template vs canonical `10-parent-portal.md` DDL. Or accept manual discipline for v1.
- [ ] **Discount codes catalogue content** — DDL is now in scope; does the wizard offer to copy-forward existing discount-code rows from the prior AY, or leave the new AY's catalogue empty?
- [ ] **Returning-student re-enrolment tie-in** — when AY rolls, does the system also auto-create "renewal" applications for last year's students? Probably no (parent re-initiates via portal), but worth confirming.
- [ ] **Archive semantics** — when AY2027 becomes current, does AY2026 become "archived" in any visible way, or does it just stay in the switcher with `is_current=false`?
- [ ] **Audit retention** — should AY-setup audit actions have special retention rules (never pruned)?

## See also

- `04-database-schema.md` — DDL for `academic_years`, `terms`, `sections`, `subject_configs`.
- `lib/academic-year.ts` — `listAyCodes` (DB-driven switcher list), `getCurrentAcademicYear`, `requireCurrentAyCode`.
- `13-sis-module.md` — Records module audit action prefix + zod-schema validation pattern, to mirror.
- `CLAUDE.md` KD #2 (superadmin role carve-out) + KD #14 (dynamic AY).
- `10-parent-portal.md` — admissions DDL reference; the DDLs the parent-portal team would provision.
- `supabase/seed.sql` — the current manual path; wizard replaces the SIS-side rows it handles.
