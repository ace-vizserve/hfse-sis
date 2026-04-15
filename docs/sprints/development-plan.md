# Development Sprints

## Overview

Development is split into 6 sprints. Each sprint produces working, testable software. Later sprints build on earlier ones. Do not start a sprint until the previous one is verified working.

**Stack:** Next.js 16 (App Router) + Supabase + Vercel. Python/FastAPI/WeasyPrint PDF service from the original plan has been deferred (see Sprint 6 decision note); browser print handles current volume.

## Status snapshot (last updated 2026-04-15)

| Sprint | Title | Status |
|---|---|---|
| 1 | Foundation | ✅ Done |
| 2 | Student Roster | ✅ Done |
| 3 | Grade Entry | 🔶 Mostly done (comparison column deferred — needs a second term of data) |
| 4 | Locking & Audit Trail | ✅ Done (comprehensive audit log covers all mutations; `is_na` UI toggle shipped in Sprint 6 close-out) |
| 5 | Comments, Attendance & Report Card Data | 🔶 Done with deferrals (Sec 3–4 profile, attendance import) |
| 6 | PDF Generation & Polish | ✅ Done (2026-04-16) — Aurora Vault v2 + close-out pass: grading grid polish (exceeds-max ring, withdrawn strike, plain-text locked mode, `is_na` toggle, quarterly color coding), blank-counts column on `/grading`, Resend-powered parent email notifications on publication (idempotent via `notified_at`). PDF automation, mobile pass, and previous-term comparison intentionally deferred — see backlog |
| — | Teacher Assignments _(added mid-flight)_ | ✅ Done — `teacher_assignments` table + CRUD UI + gates on grading list & comments |
| 7 | Admissions Dashboard (Phase 2) | 🔶 Part A done (2026-04-17) — pipeline cards, funnel, applications-by-level, outdated table, doc completion (live), assessment outcomes, referral sources, AY switcher, superadmin CSV export. Part B (SharePoint inquiries) still blocked on HFSE credentials |
| 8 | Verified Student P-Files (Document Management) | 📋 Planned (post-phase-2) — dedicated module for admissions staff to create/update verified p-files against `enrolment_documents` with full revision history. Details TBD |
| 9 | Locked-sheet Change Request Workflow | ✅ Done (2026-04-15) — replaces free-text `approval_reference` with structured teacher→admin→registrar state machine. Migration `009_change_requests.sql` + `/api/change-requests` + teacher request form + `/admin/change-requests` inbox + registrar Path A/B dialog + Resend notifications |
| — | Forms + feedback polish pass _(cross-cutting, post-Sprint 7)_ | ✅ Done — RHF+zod+shadcn `Form` on all 4 submit-based forms (schemas in `lib/schemas/`), sonner `<Toaster>` mounted once in `app/layout.tsx`, shadcn `AlertDialog` for destructive confirms, shadcn `Dialog` via shared `useApprovalReference()` hook replacing all `window.prompt()`, `tw-animate-css` wired up (with `.animate-in`/`.animate-out` longhand overrides in `globals.css` because the package's minified shorthand was breaking dialog/sheet animations) |

### Cross-cutting improvements backlog

These came up during sprints but were intentionally deferred to keep scope tight:

- Previous-term comparison column on the grade entry grid (Sprint 3) — needs a second full term of data before it's meaningful
- Automated PDF generation + Supabase Storage archival (Sprint 6) — browser Print / Save as PDF covers current volume; Puppeteer-in-Next.js is the path of least resistance if automation is ever needed
- Mobile / tablet responsive pass (Sprint 6) — punted until after UAT signoff; registrar + teachers are all on desktop today
- End-of-year "mid-year T1–T3" vs "full year T1–T4" report card toggle (Sprint 5) — end-of-year concern, no students past T2 yet
- Secondary Sec 3–4 Economics variant template (Sprint 5) — no Sec 3–4 students enrolled yet
- Virtue-theme header label on comments / report card (Sprint 5) — ornamental, no schema + no stakeholder ask
- Origin check (HMAC) on `/parent/enter` handoff as defense-in-depth. Deliberately skipped for UAT — the existing parent↔student gate is sufficient. Revisit if a real threat materializes.
- Broader loading-states pass on async actions — folded into each future bite as needed
- Sprint 6 Bite 5 wishlist: grade color coding (✅ shipped), exceeds-max red border (✅ shipped), withdrawn strike-through (✅ shipped), locked-sheet plain-text mode (✅ shipped). Tab-key cell navigation verified working via native DOM order — no change needed.
- ~~**No `error.tsx` error boundaries** anywhere in the app~~ — ✅ shipped 2026-04-15. `app/(dashboard)/error.tsx` and `app/(parent)/error.tsx` both render a centered shadcn Card with `AlertTriangle` icon, retry button, and dev-only error details (`error.message` / `digest` gated behind `NODE_ENV`). `role="alert"` + `aria-live="assertive"` for screen readers. `global-error.tsx` and `not-found.tsx` still deferred — add if a UAT failure demands them.
- **No test framework configured** — no `vitest` / `@testing-library` / `.test.ts` files exist. The `lib/compute/quarterly.ts` build-time self-test is the only automated check. Worth revisiting if a complex feature lands; today, manual happy-path testing per Workflow §3 is the explicit contract.

**Reference docs:**

- `docs/context/01-project-overview.md` — architecture and people
- `docs/context/02-grading-system.md` — formula and rules
- `docs/context/03-workflow-and-roles.md` — workflow and sections
- `docs/context/04-database-schema.md` — full DB schema
- `docs/context/05-report-card.md` — report card structure
- `docs/context/06-admissions-integration.md` — Supabase admissions sync
- `docs/context/07-api-routes.md` — all API routes
- `docs/context/09-design-system.md` — tokens, components, forbidden patterns (read before any UI work)

---

## Sprint 1 — Foundation ✅ Done

**Goal:** Project scaffolding, database setup, authentication working

### Tasks

- [x] Initialize Next.js project with App Router and TypeScript _(Next.js 16.2.3, Tailwind v4)_
- [x] Set up Supabase project (or connect to existing) _(single shared project with admissions)_
- [x] Create all database tables from `docs/context/04-database-schema.md` _(`001_initial_schema.sql`; `002_widen_grade_entry_numerics.sql` fixed a numeric precision bug)_
- [x] Seed reference data: levels, subjects, subject_configs (weights), academic_years, terms _(levels/subjects/AY2026/sections in Sprint 1, terms + subject_configs seeded in Sprint 3)_
- [x] Implement Supabase Auth (email/password) _(via `@supabase/ssr`)_
- [x] Implement role-based access: `teacher`, `registrar`, `admin`, `superadmin` _(stored in `app_metadata.role`; enforced in `proxy.ts`)_
- [x] Basic layout: sidebar navigation, role-aware menu items _(`NAV_BY_ROLE` in `lib/auth/roles.ts`)_
- [x] Environment variables — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `PDF_SERVICE_URL` _(admissions vars dropped; single shared project)_

### Seed Data to Insert

```sql
-- Levels
INSERT INTO levels (code, label, level_type) VALUES
('P1','Primary 1','primary'), ('P2','Primary 2','primary'),
('P3','Primary 3','primary'), ('P4','Primary 4','primary'),
('P5','Primary 5','primary'), ('P6','Primary 6','primary'),
('S1','Secondary 1','secondary'), ('S2','Secondary 2','secondary'),
('S3','Secondary 3','secondary'), ('S4','Secondary 4','secondary');

-- Subjects (Primary)
INSERT INTO subjects (code, name, is_examinable) VALUES
('ENG','English',true), ('MATH','Mathematics',true),
('MT','Mother Tongue',true), ('SCI','Science',true),
('SS','Social Studies',true), ('MUSIC','Music Education',false),
('ARTS','Arts Education',false), ('PE','Physical Education',false),
('HE','Health Education',false), ('CL','Christian Living',false);

-- Subjects (Secondary)
INSERT INTO subjects (code, name, is_examinable) VALUES
('HIST','History',true), ('LIT','Literature',true),
('HUM','Humanities',true), ('ECON','Economics',true),
('CA','Contemporary Art',false),
('PEH','Physical Education and Health',false),
('PMPD','Pastoral Ministry and Personal Development',false),
('CCA','Co-curricular Activities',false);
```

### Definition of Done

- User can log in and see a dashboard appropriate to their role
- All tables exist in Supabase with correct constraints
- Role middleware correctly blocks unauthorized routes

---

## Sprint 2 — Student Roster ✅ Done

**Goal:** Admissions sync working, students visible per section

### Tasks

- [x] Build admissions sync API route (`POST /api/students/sync`)
- [x] Handle null `studentNumber` — skip and report to registrar
- [x] Normalize section names on sync (typos + hyphens: "Courageos" → "Courageous", "Integrity-1" → "Integrity 1")
- [x] Build sync preview (`GET /api/students/sync/stats`) — show counts before committing
- [x] Admin UI: Sync Students page with preview and confirm button
- [x] Create sections for AY2026 per level
- [x] Index number assignment on sync (append-only, never reassign)
- [x] Withdrawn student handling (grey out, preserve index)
- [x] Section roster view: list students per section with index number and status
- [x] Manual student add (fallback when admissions data is missing) _(edit-existing not built; add covers the stated need)_
- [x] Also added: level-label normalizer ("Primary Two" → "Primary 2")

### Definition of Done

- [x] Registrar can trigger sync and see a summary of changes
- [x] All AY2026 sections show correct student rosters _(90 students synced; 1 genuine admissions-data inconsistency left visible in the error list by design)_
- [x] Withdrawn students appear greyed out with index preserved
- [x] Manual add works as a fallback

---

## Sprint 3 — Grade Entry 🔶 Mostly done

**Goal:** Teachers can enter scores, system computes grades correctly

### Tasks

- [x] Build grading sheet creation (registrar creates per subject + section + term)
- [x] Grade entry UI: grid view — rows = students, columns = W1..W5, PT1..PT5, QA
- [x] Display index number, student name alongside score inputs
- [x] Configure max scores (WW totals, PT totals, QA total) per sheet _(inline `TotalsEditor` panel also lets registrars add/remove slots mid-term, with automatic recompute)_
- [x] Real-time computation on score change (server-side, not client-side):
  - WW_PS, PT_PS, QA_PS
  - Initial Grade
  - Quarterly Grade (transmutation formula) _(pure `lib/compute/quarterly.ts` with self-test asserting `quarterly=93` on module load)_
- [x] Validate: score cannot exceed max for that column
- [x] Blank vs zero distinction: empty input = null, explicit "0" = 0
- [x] Non-examinable subjects: show letter grade dropdown (A/B/C/IP/UG/NA/INC/CO/E) instead of score inputs
- [ ] Term-over-term comparison column: show previous term's quarterly grade, highlight if delta > 5 points _(deferred — no prior-term data exists yet; revisit after a full term cycle)_
- [x] Teacher sees only their assigned subjects and sections _(done in Sprint 6 / teacher assignments, not Sprint 3; list filter now gated by `teacher_assignments`)_

### Transmutation Implementation

```python
import math

def compute_quarterly_grade(
    ww_scores: list[float | None],
    ww_totals: list[float],
    pt_scores: list[float | None],
    pt_totals: list[float],
    qa_score: float | None,
    qa_total: float,
    ww_weight: float,
    pt_weight: float,
    qa_weight: float
) -> dict:
    # Only count non-null scores
    ww_sum = sum(s for s in ww_scores if s is not None)
    ww_max = sum(t for t, s in zip(ww_totals, ww_scores) if s is not None)
    pt_sum = sum(s for s in pt_scores if s is not None)
    pt_max = sum(t for t, s in zip(pt_totals, pt_scores) if s is not None)

    ww_ps = (ww_sum / ww_max * 100) if ww_max > 0 else 0
    pt_ps = (pt_sum / pt_max * 100) if pt_max > 0 else 0
    qa_ps = (qa_score / qa_total * 100) if qa_score is not None and qa_total > 0 else 0

    initial = (ww_ps * ww_weight) + (pt_ps * pt_weight) + (qa_ps * qa_weight)

    if initial < 60:
        quarterly = math.floor(60 + (15 * initial / 60))
    else:
        quarterly = math.floor(75 + (25 * (initial - 60) / 40))

    return {
        "ww_ps": round(ww_ps, 4),
        "pt_ps": round(pt_ps, 4),
        "qa_ps": round(qa_ps, 4),
        "initial_grade": round(initial, 4),
        "quarterly_grade": quarterly
    }
```

### Definition of Done

- [x] Teacher can open a grading sheet and enter scores
- [x] Grades compute correctly against known test cases from existing sheets _(verified end-to-end: 89.33 → 93 on real P1 Patience × Math row)_
- [x] Blank and zero are handled distinctly
- [x] Non-examinable subjects show letter grade selector
- [ ] Comparison column shows previous term grade _(deferred)_

---

## Sprint 4 — Locking & Audit Trail 🔶 Mostly done

**Goal:** Registrar can lock sheets, post-lock edits are tracked

### Tasks

- [x] Lock/unlock API routes with role guard (registrar only)
- [x] Locked sheet: all inputs become read-only for teachers _(server 403 + disabled UI)_
- [x] Registrar can still edit a locked sheet (post-lock edit mode)
- [x] Post-lock edit requires `approval_reference` field (email subject/ref) _(enforced server-side; grid prompts once and caches for the session)_
- [x] All post-lock edits written to `grade_audit_log` _(per-field diff rows with bracket notation, e.g. `ww_scores[1]`)_
- [x] Comprehensive audit log — every mutating action logged _(migration `006_audit_log.sql` added a generic `public.audit_log`; `lib/audit/log-action.ts` is called from sheet create/lock/unlock, entries PATCH (pre-lock AND post-lock), totals, student sync, manual student add, teacher assignment POST/DELETE, attendance PUT, comments PUT, publication create/delete)_
- [x] Audit log UI: filterable by sheet + action _(unions `audit_log` + legacy `grade_audit_log`; renders action-specific rows; `?sheet_id=` and `?action=` query params)_
- [x] Update QA/WW/PT totals (max scores) post-lock also requires approval ref and is logged _(full-sheet recompute cascades automatically)_
- [x] Lock timestamp and locked-by recorded on `grading_sheets`
- [x] Late enrollee flag: registrar can mark specific assessments as N/A per student _(`is_na` supported in PATCH + audit-logged; no dedicated UI toggle yet — set via DB or API)_
- [ ] Registrar dashboard: overview of all sheets — which are locked, which have blanks _(lock status shown on `/grading` list; "sheets with blanks remaining" indicator not built)_

### Definition of Done

- [x] Locked sheet is read-only for teachers
- [x] Registrar edits on locked sheet create audit log entries
- [x] Approval reference is mandatory for post-lock edits
- [x] Registrar dashboard shows lock status across all sections _(on the grading list page; a dedicated summary dashboard with blank-counts is a polish follow-up)_

---

## Sprint 5 — Comments, Attendance & Report Card Data 🔶 Done with deferrals

**Goal:** All report card data is collectable and viewable

### Tasks

- [x] Teacher comment entry UI per student per term (per section) _(registrar path at `/admin/sections/[id]/comments`; teacher/form-adviser path at `/grading/advisory/[id]/comments`; gated server-side to `form_adviser` role)_
- [x] Attendance entry UI: school days, days present, days late per student per term _(registrar at `/admin/sections/[id]/attendance`; teachers cannot edit)_
- [ ] Attendance import from existing system _(no attendance module exists at HFSE; deferred until one does)_
- [x] Report card data aggregation API (`GET /api/report-card/[studentId]`)
  - All quarterly grades per subject across T1–T4
  - Overall annual grade (T1×0.2 + T2×0.2 + T3×0.2 + T4×0.4, rounded 2dp) _(pure `lib/compute/annual.ts` with self-test)_
  - Attendance per term
  - Teacher comment
- [x] Report card preview UI (HTML rendering, matches PDF layout) _(`/report-cards/[studentId]` with print-friendly styles and a browser Print / Save as PDF button)_
- [ ] Student development profile (secondary only — Sec 3–4 Economics handling) _(deferred — no Sec 3–4 students yet in AY2026)_

### Definition of Done

- [x] Teacher can enter comments for all their students _(form adviser only)_
- [x] Attendance is recordable per term per student
- [x] Report card preview shows correctly assembled data
- [x] Overall grade formula matches the masterfile formula exactly

---

## Sprint 6 — PDF Generation & Polish 🔶 Mostly deferred / in progress

**Decision (2026-04):** The Python/WeasyPrint service is deferred indefinitely. HFSE's actual volume (one registrar, ~90 students × 4 terms) is comfortably handled by the browser's Print / Save as PDF dialog, which is already wired into the preview page. If automation or archival becomes a need, the next step is Puppeteer-in-Next.js (no second deployment), with optional Supabase Storage archival.

**Design system pass (2026-04):** Added `docs/context/09-design-system.md` — industrial / utilitarian dark theme with DM Sans + DM Mono, token palette in Tailwind v4 `@theme`, no gradients, no emoji in UI, square containers. Being applied in 5 bites; see the "Design system pass" subsection below.

### Tasks

#### Python PDF Service — ⏭️ deferred

- [ ] Initialize FastAPI project
- [ ] Create Jinja2 HTML templates:
  - `templates/primary_report_card.html`
  - `templates/secondary_sec12_report_card.html`
  - `templates/secondary_sec34_report_card.html`
- [ ] Style templates with CSS to match existing report card layout exactly
- [ ] `POST /generate-pdf` endpoint — accepts JSON, returns PDF binary
- [ ] `GET /health` and `GET /ping` endpoints
- [ ] Deploy to Render or Railway

#### Next.js Integration — ⏭️ deferred (browser print covers the use case)

- [ ] `POST /api/report-card/[studentId]/pdf` — calls PDF service, streams back PDF
- [ ] `POST /api/report-card/section/[sectionId]/pdf` — batch PDF for whole section
- [ ] Keep-warm ping to PDF service every 10 minutes (to avoid Render cold start)
- [x] Download button in report card preview UI _(browser Print / Save as PDF — user picks destination)_

#### Polish & Hardening

- [ ] Error handling: what happens if PDF service is down _(N/A while PDF service is deferred)_
- [ ] Loading states for all async operations _(partial — grading grid has saving/error states; broader pass pending)_
- [x] Input validation on all grade entry fields _(server-side range checks; client-side blank-vs-zero preserved)_
- [ ] Mobile-responsive layout (at minimum tablet-friendly for teachers entering grades) _(deferred — desktop-only for now)_
- [x] User management: teachers created in Supabase dashboard, assigned via `teacher_assignments` on the section page
- [x] Self-serve password change _(`/account` page + `change-password-form.tsx` using `supabase.auth.updateUser`, linked from sidebar footer; commit 60b63c4)_
- [x] End-to-end test: create sheet → enter grades → lock → post-lock edit with approval → audit log → report card preview _(manually walked through; no automated E2E suite)_
- [x] Deploy to Vercel _(live; monorepo flattened from `hfse-markbook/app/` to repo root, Root Directory blank, env vars + Supabase redirect URLs configured)_
- [x] Tighten RLS _(migrations `004_tighten_rls.sql` + `005_rls_teacher_scoping.sql`: JWT role gate, deny-writes on authenticated role, `grade_audit_log` registrar-only, per-teacher row scoping on grade/student tables via `teacher_assignments` joins)_

#### Accountability & parent-facing features — shipped 2026-04-14

Added after the UAT message went out. Separate from Sprint 5's "teacher comment entry" and "report card preview" because these are downstream features the registrar specifically asked for.

- [x] **Comprehensive audit log** _(migration `006_audit_log.sql`; generic `public.audit_log` table with action/entity/context JSONB. `lib/audit/log-action.ts` wired into 11 mutating API routes: sheet create/lock/unlock, entries PATCH (pre-lock + post-lock), totals, student sync, manual student add, teacher assignment POST/DELETE, attendance PUT, comments PUT, publication create/delete. Audit-log UI rewritten to UNION `audit_log` + legacy `grade_audit_log` with action-specific row renderers.)_
- [x] **Report card publication windows** _(migration `007_report_card_publications.sql`; registrar publishes per-section per-term via `<PublishWindowPanel>` on `/report-cards`; parents only see report cards while `publish_from <= now() <= publish_until`. API at `/api/report-card-publications`.)_
- [x] **Parent route group `(parent)`** _(layout + sidebar gated on `getUserRole() === null`; `/parent` lists the parent's children via `getStudentsByParentEmail()` admissions lookup; `/parent/report-cards/[studentId]` re-verifies the parent↔student linkage and the publication window; reuses the shared `<ReportCardDocument>` via `buildReportCard()`.)_
- [x] **Parent portal SSO handoff** _(`/parent/enter` client component reads access_token/refresh_token from URL fragment, calls `supabase.auth.setSession()`, redirects to `next`. Parents sign in once at `enrol.hfse.edu.sg` — no second login on the markbook. `NEXT_PUBLIC_PARENT_PORTAL_URL` env var for the error fallback. `PUBLIC_PATHS` updated in `proxy.ts`. Per-environment integration docs in `docs/context/10-parent-portal.md`.)_
- [x] **Dynamic academic year** _(`lib/academic-year.ts::getCurrentAcademicYear` / `requireCurrentAyCode` reads `academic_years WHERE is_current=true`. Replaced hardcoded `'AY2026'` in parent pages, sync routes. Rolling to AY2027 is a DB flag flip, not a code change — admissions table prefixes derive from the current AY code.)_
- [x] **Admissions reference doc** _(`docs/context/10-parent-portal.md` with full frozen DDL for `ay2026_enrolment_applications` / `_status` / `_documents`, per-environment env var tables, integration snippet for the parent portal team, troubleshooting table.)_
- [x] **Case-insensitive parent email match** _(`getStudentsByParentEmail` uses `.ilike` so parents whose auth email differs in case from their admissions record still match. Fix spotted during the reference doc pass.)_

#### Design system pass — fully revamped 2026-04-14

Original plan (industrial dark DM Sans, `.btn-*` CSS primitives) was **discarded** in favour of a new "Digital Ledger" corporate editorial system built entirely on shadcn primitives. All 14 private pages + login + account were rebuilt.

- [x] New typography: Inter (`--font-sans`) + Source Serif 4 (`--font-serif`) + JetBrains Mono (`--font-mono`) via `next/font/google` in `app/layout.tsx`
- [x] Tokens: shadcn semantic palette in `app/globals.css` via `@theme inline`, consumed everywhere through `bg-background` / `bg-card` / `bg-muted` / `bg-primary` / `text-foreground` / `text-muted-foreground` etc. **Zero hex/oklch/`slate-*`/`zinc-*`/`gray-*` in `app/` or `components/`.**
- [x] Shared wrappers: `components/ui/page-shell.tsx`, `page-header.tsx`, `surface.tsx` (+ `SurfaceHeader`/`Title`/`Description`). Every dashboard page uses them.
- [x] Dashboard layout: `bg-muted` canvas with glass sticky header, `print:hidden` / `print:bg-background` so the report-card paper prints clean
- [x] Sidebar: serif brand lockup, role pill, `/account` link in footer next to Sign out
- [x] Added missing shadcn primitives: `components/ui/select.tsx` (`@radix-ui/react-select`), `checkbox.tsx` (`@radix-ui/react-checkbox`), `textarea.tsx`
- [x] Replaced all raw `<select>` (new-sheet-form, letter-grade-grid, teacher-assignments-panel), `<textarea>` (comments-grid), `<input type="checkbox">` (manual-add), stray `<button>` (login, score-entry-grid) with shadcn equivalents
- [x] Replaced raw `<table>` in attendance-grid, comments-grid, score-entry-grid with shadcn `Table` (report-card print tables kept as documented exception for print pagination)
- [x] `components/ui/sheet.tsx` scrim: `bg-black/80` → `bg-foreground/60` (theme-aware)
- [x] Design doc `docs/context/09-design-system.md` rewritten with §10 "Always use shadcn components (binding rule)" and §11 "Color emphasis — use `--primary` meaningfully"
- [x] Hard Rule #7 added to `CLAUDE.md`: "Design system is binding; `app/globals.css` is the only source for tokens"

**Deferred from the original Bite 5 wishlist** (not blocking UAT):

- [ ] Grade color coding on quarterly column (<75 danger, 75–84 warning, 85+ neutral)
- [ ] Locked-sheet plain-text mode
- [ ] Tab key navigation between score cells
- [ ] `.score-input.exceeds-max` red border + danger bg
- [ ] Withdrawn-row line-through (partially done — muted-foreground applied, no strike-through)

#### Design system v2 "Aurora Vault" — 2026-04-14

The first design pass (Digital Ledger / Inter + Source Serif + JetBrains Mono + shadcn semantic tokens) was working but felt generic. Second pass introduces a crafted corporate palette + component rebuild across every staff page. **All edits are uncommitted; review and ship as one sprint-close commit.**

**Tokens added to `app/globals.css`:**

- [x] Aurora Vault palette under `--av-*` prefix in `:root` (navy `#0B1120`, indigo ramp `#4F46E5/#4338CA/#5B52ED/#818CF8`, sky `#38BDF8`, mint `#A5F3B7`, ink ramp `#0F172A/#334155/#475569/#64748B/#94A3B8`, hairline `#E2E8F0/#CBD5E1`), mapped via `@theme inline` to Tailwind utilities `bg-brand-navy`, `text-ink`, `border-hairline`, etc. Core shadcn semantic tokens (`--foreground`, `--primary`, `--border`) remapped to these values so legacy utilities inherit the aesthetic without per-file edits.
- [x] Crafted shadow tokens: `--av-shadow-input` / `--av-shadow-brand-tile` / `--av-shadow-button` / `--av-shadow-button-hover` / `--av-shadow-button-active` / `--av-shadow-glass-card`. Default shadcn `Button` ships the gradient indigo + `shadow-button` recipe so every CTA cascades the depth automatically.

**Primitives upgraded or installed:**

- [x] `components/ui/button.tsx` — default variant now `bg-gradient-to-b from-brand-indigo to-brand-indigo-deep shadow-button`, outline variant uses `border-hairline bg-white text-ink shadow-input`, link variant uses `text-brand-indigo`, focus ring `ring-brand-indigo/25`
- [x] `components/ui/card.tsx` — upgraded via `npx shadcn@latest add card` to the newer version with `data-slot="card"`, `@container/card` container queries, and `CardAction` grid slot
- [x] `components/ui/badge.tsx` — default variant gets the mini-button gradient treatment, secondary uses `border-hairline bg-muted`, outline matches the hero role/AY pills, shouty `font-bold uppercase` default dropped
- [x] `components/ui/tabs.tsx` — list gains `border-hairline shadow-input`, active trigger uses `bg-white text-brand-indigo ring-1 ring-inset ring-hairline` + inset highlight shadow, `line` variant uses `after:bg-brand-indigo` for the underline accent
- [x] `components/ui/input.tsx` + `textarea.tsx` — `border-hairline bg-white shadow-input`, `focus-visible:ring-4 focus-visible:ring-brand-indigo/15`, `aria-invalid` destructive ring, ink placeholder
- [x] `components/ui/select.tsx` — trigger matches Input styling, content uses `rounded-lg border-hairline bg-white` with a crafted 2-layer drop shadow, `SelectLabel` becomes mono uppercase eyebrow, `SelectItem` checked state uses `text-brand-indigo`
- [x] `components/ui/alert.tsx` — `border-hairline bg-white shadow-input` default + `bg-destructive/5 border-destructive/30` destructive; `AlertTitle` is serif semibold
- [x] `components/ui/table.tsx` — `border-hairline` throughout, `TableHead` becomes mono uppercase tracking-[0.14em] text-ink-4
- [x] `components/ui/tooltip.tsx` — dark navy tooltip with mono text
- [x] `components/ui/checkbox.tsx` — gradient primary fill on checked state matching the Button
- [x] `components/ui/sheet.tsx` — navy-tinted backdrop-blur overlay, crafted left-side shadow, close button rebuilt as a hairline-bordered square, `SheetTitle` serif xl
- [x] `components/ui/dropdown-menu.tsx` — content uses `rounded-lg border-hairline bg-white` + crafted shadow, labels as mono eyebrows
- [x] `components/ui/separator.tsx` + `label.tsx` + `skeleton.tsx` — hairline + ink tweaks
- [x] `components/ui/page-header.tsx` — `variant="hero"` added with serif `text-[38px]`/`md:text-[44px]` headline and ink ramp description; default variant retained for backwards compat
- [x] `components/ui/surface.tsx` — `border-hairline bg-white` + crafted rest shadow; kept as legacy wrapper, new work uses `Card` directly per design-system §4
- [x] **New installs:** `components/ui/dropdown-menu.tsx`, `tabs.tsx`, `calendar.tsx`, `popover.tsx`, plus npm `@tanstack/react-table` and `react-day-picker`
- [x] **New custom component:** `components/ui/date-time-picker.tsx` — `Popover` + `Calendar` + `Input type="time"` wrapper replacing native `datetime-local` inputs; used in `PublishWindowPanel`

**Pages rebuilt (uncommitted):**

- [x] `/login` (`app/(auth)/login/page.tsx`) — `@shadcn/login-02` split-screen with Aurora Vault tokens, navy brand panel with radial glows + hairline grid mask + glass product-glimpse card
- [x] `/` (`app/(dashboard)/page.tsx`) — dashboard-01 `SectionCards` pattern with 4 live stat cards (students enrolled, grading sheets, sheets locked %, publications live) backed by server-side Supabase queries, plus 3 role-aware quick-link cards and mono trust strip
- [x] `/admin` (`app/(dashboard)/admin/page.tsx`) — same hero + card pattern, 4 tool cards in 2×2
- [x] `/parent` (`app/(parent)/parent/page.tsx`) — narrow "published report cards" list (not a portal hub — corrected misframing; the real parent portal lives at `enrol.hfse.edu.sg`), child cards with gradient icon tiles and per-term publication badges
- [x] `/grading` (`app/(dashboard)/grading/page.tsx` + `grading-data-table.tsx`) — full `@tanstack/react-table` implementation with global fuzzy search, faceted `DropdownMenuCheckboxItem` level filter, column visibility, status tabs with live counts, sortable columns, pagination bar. Canonical data-table reference per design-system §8.
- [x] `/grading/new` (`app/(dashboard)/grading/new/page.tsx` + `new-sheet-form.tsx`) — 3-step card wizard (Assignment / Score slots / Teacher) with `Field` / `FieldLabel` / `FieldDescription` throughout, summary card with submit button
- [x] `/admin/sections` (`app/(dashboard)/admin/sections/page.tsx`) — 3 summary stat cards + per-level container `Card`s with `divide-y` list rows for sections; clear visual separation between "stats" and "groups"
- [x] `/admin/sections/[id]` (`page.tsx` + subcomponents) — hero + 3 stat cards + `Tabs` (Roster / Teachers). Roster tab has `Card`-wrapped `Table`. Manual-add-student now a `Sheet`-triggered form in the hero actions row (primary gradient button, `ManualAddStudent` refactored to `SheetTrigger` + `SheetContent` + `Field`-based form). Teacher assignments panel split into 3 cards (form adviser / subject teachers / new assignment).
- [x] `/admin/sections/[id]/attendance` — hero + 3 live stat cards (School days / Average attendance / Perfect attendance) + URL-driven `Tabs` term switcher (`TabsTrigger asChild` wrapping `Link`) + `Card`-wrapped numeric grid with per-row save indicator (spinner → green check)
- [x] `/admin/sections/[id]/comments` — hero + 3 stat cards (Written / Pending / Average length) + `Tabs` term switcher + **vertical list of `Card`s, one per student** instead of table (multi-line text needs breathing room); each card has status badge in `CardAction` and inline save indicator
- [x] `/admin/sync-students` — hero + wizard-style Step 1 action card + 7 stat cards (Source rows / New / Updates / Enrolments / Withdrawals / Reactivations / Errors — destructive-tinted when non-zero) + `Card`-wrapped diff & errors tables
- [x] `/admin/audit-log` — **not yet touched** in the v2 pass; next logical data-table redesign
- [x] `/report-cards` (`app/(dashboard)/report-cards/page.tsx` + `section-picker.tsx`) — hero with `Select`-based section picker (grouped by level via `SelectGroup` / `SelectLabel`), 3 live publication stat cards, rebuilt `PublishWindowPanel` as a `Card` with `divide-y` term rows using the new `DateTimePicker` for publish windows, `Card`-wrapped roster table with per-row preview button
- [x] `/account` — inherits via shared components; no per-file rewrite this pass

**Pages still pending in the v2 pass:** _none — closed in the sprint-close pass below._

**Docs:**

- [x] `docs/context/09-design-system.md` rewritten from 581 → 426 lines: added §5 "Page construction process" (review → pick → build), §6 full registry matrix of every route → shadcn block/primitive, §8 canonical patterns library with code snippets referencing live files, §10 pre-delivery checklist, §11 "adding a new token" with `--av-*` prefix rule and the self-reference-cycle incident documented, §11c craft standard, §11d "prefer shadcn primitives over custom wrappers" policy.
- [x] Memory `feedback_design_tokens.md` updated with token equivalence table and the critical "verify compiled CSS, not just build success" note.

#### Aurora Vault v2 — sprint-close pass (2026-04-15)

Closing pass that finished every legacy page, removed the deprecated wrappers, and made the design system colour rules a written contract. **All edits are uncommitted**; review and ship as one commit.

**Legacy page rebuilds (all migrated off `PageHeader` / `Surface`):**

- [x] `/admin/audit-log` — full rebuild: hero + 3 stat cards (Entries loaded / Unique actors / Post-lock edits — replaced the dead "Active filter" card), filter status panel removed in favour of an interactive toolbar; new client component `app/(dashboard)/admin/audit-log/audit-log-data-table.tsx` using `@tanstack/react-table` with global text search, faceted Action multi-select dropdown, deep-link `?sheet_id=` chip with clearable X, sortable When/Who/Action columns, 25/50/100 pagination. `ActionDetails` switch renderer relocated to the client component.
- [x] `/grading/[id]` — hero + 3 stat cards (Students / Graded with % complete / Weights `WW/PT/QA`), `TotalsEditor` rebuilt as a `Sheet`-triggered form with `FieldGroup`/`Field`/`FieldLabel`/`FieldDescription` matching `ManualAddStudent`, lock-status panel rewritten as a §9.4 bordered status panel (destructive tint for read-only teacher view, accent tint for registrar approval-required view).
- [x] `/grading/advisory/[id]/comments` — mirrors the registrar comments page: hero with level/section badge, 3 stat cards (Written / Pending / Average length), `Tabs` term switcher replacing the legacy `<Surface>`-wrapped term picker, §9.4 destructive panel for the access-denied early return.
- [x] `/account` + `change-password-form.tsx` — inline hero + two `Card`s (Signed-in identity / Change password); form migrated to `FieldGroup`/`Field` with an inline `Eye`/`EyeOff` show-hide toggle absolutely positioned inside the New password field.
- [x] `/report-cards/[studentId]` — inline hero with `PrintButton` in the actions row; `ReportCardDocument` body untouched.
- [x] `/parent/enter` — `Card`-wrapped loading state, §9.4 destructive panel for sign-in failures, hero header for the error state.
- [x] `/parent/report-cards/[studentId]` — inline hero on both the "not yet published" and the document views.
- [x] `components/grading/score-entry-grid.tsx` + `letter-grade-grid.tsx` — visual refresh: legacy `Surface` wrapper → `<Card className="overflow-hidden p-0">` + `<TableRow className="bg-muted/40 hover:bg-muted/40">` headers matching the other data tables. `weights` prop dropped from `ScoreEntryGrid` (info now lives in the hero stat card).

**Deprecated wrappers deleted:**

- [x] `components/ui/page-header.tsx` and `components/ui/surface.tsx` removed from the repo. Final grep confirmed zero remaining imports across `app/` and `components/`. `CLAUDE.md` project-layout footnote updated to drop the legacy wrappers note.

**Design system §9 — "Semantic color discipline" rewrite:**

- [x] Section renamed from "Primary color discipline" to **"Semantic color discipline"** in `docs/context/09-design-system.md`. Adds §9.1 semantic palette table (primary / destructive / mint / accent / muted with "reads as" mental model), §9.2 button variants by purpose (with hard rules: exactly one `default` per view, never `outline` for destructive, promote per-instance treatments to the variant), §9.3 three status-badge recipes (mint healthy / destructive blocked / secondary informational) with ready-to-paste JSX, §9.4 bordered status panel pattern (replacing default `<Alert>` for high-visibility status), §9.5 updated review checklist.
- [x] Existing badges across the app brought in line with §9.3:
  - `app/(dashboard)/grading/grading-data-table.tsx` Locked/Open status column
  - `components/admin/publish-window-panel.tsx` Published/Scheduled/Expired/Not-published states
  - `app/(dashboard)/admin/sections/[id]/page.tsx` roster Active/Late-enrollee/Withdrawn
  - `app/(dashboard)/admin/sections/[id]/comments/comments-grid.tsx` Written/Pending/Withdrawn
- [x] `Button` outline variant base styling promoted in `components/ui/button.tsx` to the indigo wash treatment (`border-brand-indigo-soft/60 bg-accent/40 text-brand-indigo-deep`) so every outline button across the app inherits it without per-instance overrides.

**Lucide icon convention:**

- [x] Every visible `→` glyph replaced with a lucide icon. Convention: `<ArrowUpRight />` for action / navigation links ("Manage", "View audit log", "Comments", "open sheet"); `<ArrowRight />` for inline data flow / range / diff separators (date ranges, old→new value diffs in audit log, "Withdrawn → active" sync footer). `StatCard.footer` prop in `app/(dashboard)/admin/sync-students/page.tsx` relaxed from `string` to `React.ReactNode` to accept the inline icon. Audit pass verified every `<ArrowUpRight />` link uses `inline-flex items-center gap-1` + an explicit icon size class so text and icon sit on a single horizontal baseline.

**Report card document redesign (`components/report-card/report-card-document.tsx`):**

- [x] Letterhead now uses `public/report-card/report-card-header.png` (full-width brand image with logo, address, contact, registration baked in) instead of the text-only "HFSE INTERNATIONAL SCHOOL · Singapore" header.
- [x] Footer brand strip now uses `public/report-card/report-card-footer.jpg` (HFSE Global Education Group affiliated brands).
- [x] Outer wrapper is `<article>` with edge-to-edge images flush against the rounded card boundaries; print CSS still strips the rounded edges and shadow.
- [x] Body sections polished: student info on a `bg-muted/40` card, table headers `bg-muted/60` + uppercase mono labels, grading legend on `bg-accent/50` indigo wash, signature lines using `border-ink-5`. `print:break-inside-avoid` on every section.

**`PublicationStatus` parent-access panel rebuild (`components/admin/publication-status.tsx`):**

- [x] Replaced the cramped one-line strip with a proper `Card`: brand-tile gradient icon chip + serif title + dynamic description ("2 of 4 terms are currently visible to parents") + Manage link in `CardAction`. Body is a 2-column responsive grid of per-term mini-tiles, each showing the publish window in mono tabular-nums and a status badge color-coded per §9.3 (mint Visible / accent Scheduled / destructive Expired / dashed muted Not-published).

**Sidebar redesign (`components/app-sidebar.tsx` + `parent-sidebar.tsx`):**

- [x] Brand chip upgraded from flat indigo square to the indigo→navy gradient + `shadow-brand-tile` (matches stat cards and status panels everywhere). Two-line label uses the §8 hero pattern: mono uppercase `HFSE` eyebrow over a serif `Markbook` / `Parent Portal` title. Header is now a clickable Link to `/` (or `/parent`).
- [x] Group labels promoted to mono `tracking-[0.14em]` matching every eyebrow in the app.
- [x] Active menu item gets a left-edge indigo accent bar via `before:` pseudo-element, only visible when `data-[active=true]`.
- [x] Footer profile rebuilt: avatar circle uses the indigo→navy gradient with white initials and `shadow-brand-tile`; role label is now a title-cased mono uppercase eyebrow (`TEACHER`, `REGISTRAR`, etc.) via a `ROLE_LABEL` map.
- [x] Sign out hover state shifts to `bg-destructive/10 text-destructive` to signal it ends the session (per §9.2 destructive intent).
- [x] `SIDEBAR_WIDTH_ICON` in `components/ui/sidebar.tsx` bumped from `3rem` → `4rem` so the collapsed icon-only rail fits the `size-9` brand chip + `px-3` header padding without clipping.

#### Sprint 6 close-out pass — 2026-04-16

Final bite closing every deferred polish item that could ship without new data, plus the one real feature gap (parent notifications on publication).

- [x] **Grade entry grid polish** (`components/grading/score-entry-grid.tsx`, `components/grading/letter-grade-grid.tsx`, `app/(dashboard)/grading/[id]/page.tsx`):
  - Quarterly column rendered as color-coded pill per §9.3 recipes — `<75` destructive, `75–84` neutral muted, `85+` mint
  - `ScoreInput` takes a `max` prop and sets `aria-invalid` with destructive ring when the entered value exceeds the per-cell max (client-side mirror of the server 400)
  - Withdrawn students get `line-through` on the student name (parity with `letter-grade-grid` and `comments-grid`)
  - Locked-sheet plain-text mode — when `readOnly && !requireApproval`, score cells render as `<span>` instead of disabled `<input>` (same treatment in `letter-grade-grid` for non-examinable subjects)
  - `is_na` late-enrollee toggle shipped as a per-row `Checkbox` in a new rightmost "N/A" column; toggling disables the score inputs and greys the row. API already supported `is_na` — this was the missing UI. Audit-log flow unchanged (goes through the same PATCH → `log-grade-change` plumbing)
  - Tab-key navigation verified already working via native DOM order — no code change
- [x] **Blank-counts column on `/grading`** (`app/(dashboard)/grading/page.tsx` + `grading-data-table.tsx`):
  - Server component fetches `grade_entries` alongside the sheet list and buckets `{ blanks, total }` by `grading_sheet_id`. Blank = any null WW/PT/QA slot for examinable subjects, or null `letter_grade` for non-examinable. Withdrawn + `is_na` students excluded from both numerator and denominator (matches `lib/compute/quarterly.ts` rules)
  - New `Blanks` column renders mint "Complete" badge when 0, destructive "N of M blank" pill otherwise. Sortable asc/desc
  - New "With blanks" status tab with live count, synced to the column filter alongside Open/Locked
- [x] **Parent email notification on publication** (`lib/notifications/email-parents-publication.ts`, `lib/supabase/admissions.ts::getParentEmailsForSection`, `app/api/report-card-publications/route.ts`, `supabase/migrations/008_publication_notified_at.sql`):
  - New `resend` npm dep + `RESEND_API_KEY` / `RESEND_FROM_EMAIL` env vars
  - `getParentEmailsForSection(sectionId, ayCode)` resolves active section members → `students.student_number` → admissions `ay{YY}_enrolment_applications.motherEmail/fatherEmail`, de-dupes + lowercases
  - `emailParentsPublication` composes a branded HTML email (indigo CTA button, matches the Aurora Vault palette) linking to `NEXT_PUBLIC_PARENT_PORTAL_URL` — parents always re-enter via the SSO handoff, never directly at the markbook URL
  - Hook lives in `POST /api/report-card-publications` after the upsert, gated on `notified_at == null` for idempotency. Migration `008` adds the `notified_at` column
  - Best-effort: Resend failures log + count but do not fail the publication. Notification result logged into the `publication.create` audit context for traceability
  - Fully skipped (and logged) if `RESEND_API_KEY` or `NEXT_PUBLIC_PARENT_PORTAL_URL` are unset — keeps local-dev happy without Resend

### Definition of Done

- [x] Report card preview matches the spec layout _(browser-rendered; PDF service deferred)_
- [ ] Batch PDF generation works for a full section _(deferred — Puppeteer-in-Next.js is the path if automation is ever needed)_
- [x] System is deployed and accessible to Joann for UAT _(live on Vercel; UAT message sent 2026-04-14)_
- [x] At least one full term's worth of data has been entered and a report card successfully previewed
- [x] Parents are notified when a report card is published _(Resend-powered email, idempotent via `notified_at`)_

---

## Phase 2

> Phase 2 begins only after all 6 Phase 1 sprints are complete and the grading module has been verified in production (UAT signed off by Joann and Amier).

---

## Sprint 7 — Admissions Dashboard & Inquiry Tracking

**Goal:** Admissions team has a real-time dashboard for pipeline visibility, outdated application alerts, and inquiry tracking from SharePoint

**Full spec:** `docs/context/08-admissions-dashboard.md`

### Part A — Applications Dashboard ✅ Done (2026-04-17)

- [x] Applications pipeline overview — 7 summary cards per `applicationStatus` (Submitted, Ongoing Verification, Processing, Enrolled, Enrolled Conditional, Withdrawn, Cancelled)
- [x] Outdated applications table — TanStack table with red/amber/green staleness tiers rendered as badge + icon + label (never color-only)
- [x] Day counter per application — `daysInPipeline` column, matches spec SQL
- [x] Average time to enrollment metric — dedicated card with sample size
- [x] Applications by level bar chart — grouped Submitted vs Enrolled per level
- [x] Conversion funnel visualization — horizontal bar chart (reads clearer at low n than recharts FunnelChart), drop-off % per stage in tooltip
- [x] Document completion rate — live query against `ay{YY}_enrolment_documents`, all 5 core docs (medical, passport, birthCert, educCert, idPicture) must be non-null to count as complete
- [x] Assessment outcomes chart — stacked bar (Math, English) with Pass/Fail/Unknown, 60% pass threshold, handles both numeric and letter grades
- [x] Referral source breakdown — horizontal bar from `howDidYouKnowAboutHFSEIS`, top 8 + "Other" rollup
- [x] AY switcher — `?ay=AY2026` searchParam, dropdown reads from `academic_years`, no hardcoding
- [x] Cache dashboard queries — `unstable_cache` wrapper with 600s TTL and `admissions-dashboard:${ayCode}` tag
- [x] Superadmin-only CSV export at `/api/admissions/export` for the outdated-applications view
- [x] High-signal widgets also inlined on the root `/` dashboard (merged /admin into /; /admin redirects to /) so privileged roles land on a single dashboard
- [x] Outdated-row staleness falls back to `applicationUpdatedDate ?? created_at` — the admissions team never stamps `*UpdatedDate` columns (0/471 populated in AY2026), so without the fallback every row collapsed to "Never updated"
- [x] Outdated table follows the `grading-data-table.tsx` canonical pattern — pagination, tabs (All / Critical / Warning / Never), sortable headers, mono-caps badges with icons, searchable Level combobox (Popover + Input, no cmdk dep)
- [x] Pipeline-age column shows a compact RAG dot + tinted count reusing the spec §1.2 thresholds
- [x] Status badges use distinct icon + brand-token tint per `applicationStatus` (Submitted → indigo, Verification → sky, Processing → soft indigo, Enrolled → mint, etc.) instead of a plain secondary variant
- [x] AY switcher promoted from a cramped hero toolbar to a dedicated right-column "Viewing" card with full-width controls

### Part B — Inquiry Tracking via SharePoint (blocked until HFSE provides credentials)

**Blockers — get these from HFSE before starting Part B:**

1. SharePoint site URL and list name (to resolve site ID and list ID via Graph Explorer)
2. Azure AD app registration — Tenant ID, Client ID, Client Secret
3. Exact column names in the SharePoint inquiries list

**Tasks (after blockers resolved):**

- [ ] Set up M365 Graph API client in Next.js — client credentials flow (server-side only)
- [ ] Add environment variables: `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `SHAREPOINT_SITE_ID`, `SHAREPOINT_LIST_ID`
- [ ] Build SharePoint list sync API route — polls Graph API every 15 minutes, caches results
- [ ] Inquiry dashboard view — total inquiries, converted to application count, conversion rate
- [ ] Last updated timestamp — when was the most recent inquiry record added to SharePoint
- [ ] Staleness alert — warning banner if inquiry list not updated in 3+ school days
- [ ] Inquiry-to-application matching — match by email to show conversion funnel from inquiry to enrolled
- [ ] Unmatched inquiries view — leads that never became applications
- [ ] Weekly inquiry trend chart — volume over time vs same period last AY

### Access Control

| Role         | Access                    |
| ------------ | ------------------------- |
| `registrar`  | View only                 |
| `admin`      | Full dashboard access     |
| `superadmin` | Full access + data export |
| `teacher`    | No access                 |

### Definition of Done

- Applications dashboard is live and showing correct pipeline data for current AY
- Outdated applications table correctly flags stale records
- Day counter is accurate against known application dates
- Conversion funnel percentages are verified against raw counts
- Part B: Inquiry list last-updated timestamp is visible and staleness alert triggers correctly
- Part B: Inquiry-to-application matching correctly identifies converted leads

---

## Sprint 8 — Verified Student P-Files (Document Management) 📋 Planned

**Goal:** Give admissions staff a dedicated module to create, update, and audit verified student p-files — one per enrolled student — with full revision history. This is a **separate concern from Sprint 7 Part A's live doc-completion widget**, which only reports against the raw admissions intake (`ay{YY}_enrolment_documents`). Sprint 8 is the canonical, verified record that admissions maintains after intake.

**Phasing:** Post-phase-2. Pick up after Sprint 7 Part B (SharePoint inquiries) or in parallel once requirements are frozen.

### Scope (from initial brief — details TBD)

- **Table of record:** `enrolment_documents` — supports create/update against enrolled students with revision history. Schema, FK conventions, and storage strategy to be documented in a dedicated `docs/context/11-document-management.md` once details land.
- **All documents are required.** There is no "core vs. optional" split. Every listed document must be present, with one explicit escape hatch:
  - **"To follow" flag** — parents/guardians can mark an individual document as pending (e.g. passport application in progress). A p-file with "to follow" items is still incomplete, but the incompleteness is *expected and acknowledged*, not a data-quality gap. This supersedes the Sprint 7 Part A "all 5 non-null = complete" heuristic for the authoritative view.
- **Parent/guardian passports** are part of the required set, alongside the existing student documents (medical, passport, birth cert, educational cert, ID picture, etc.).
- **Document status is category-dependent** — every document falls into one of two categories, and the allowed status set differs per category:
  - **Non-expiring** (birth certificate, educational certificate, ID picture, …) → statuses: `Uploaded`, `Valid`, `Rejected`
  - **Expiring** (passport, medical, visa, guardian passport, …) → statuses: `Valid`, `Expired`, `Rejected`
  - Expiring documents carry a paired expiration column (e.g. `passport` → `passportExpiry`, `medical` → `medicalExpiry`). The UI should read the expiry and auto-compute `Valid` vs `Expired` based on today's date — `Rejected` stays manual. A dashboard filter for "expiring in the next N days" falls out of this model for free and should ship with the first cut.
- **Revision history:** every create/update writes a new revision row rather than mutating in place; the module reads "current" via the latest revision per (student, document_type).
- **Admissions staff** own the module. Registrar/admin/superadmin see everything; teachers have no access; parents see their own child's p-file status (read-only) if the parent portal is extended later.

### Open questions (to resolve with user before execution)

- [ ] Full document checklist — which document types count, and are any level-specific (Sec 3–4 transcripts, etc.)?
- [ ] Storage — Supabase Storage bucket layout, file-type and size limits, retention policy
- [ ] Revision semantics — is a revision created on every save, or only on file replacement vs. metadata-only edits?
- [ ] "To follow" expiry — do pending items get a due date / auto-reminder?
- [ ] Parent-facing view — read-only status page only, or can parents upload new revisions themselves?
- [ ] Relationship to `ay{YY}_enrolment_documents` — is Sprint 8's `enrolment_documents` a promotion of verified rows out of the admissions intake, or a completely separate table that references the student by `studentNumber`?
- [ ] Audit log integration — reuse `public.audit_log` via `lib/audit/log-action.ts`, or add a domain-specific audit trail?
- [ ] Dashboard impact — should Sprint 7's live "Document completion rate" widget read from `enrolment_documents` instead of the raw admissions table once this ships?

### Definition of Done (draft)

- `enrolment_documents` schema migrated, with revision history working end-to-end
- Admissions UI lists every enrolled student with a per-document status (present / to-follow / missing), filterable and searchable via the `grading-data-table.tsx` canonical pattern
- Upload + replace writes a new revision; old revisions are retrievable
- "To follow" flag round-trips via the same form that handles file upload
- Every mutation writes to the audit log (actor, action, entity_type=`p_file`, entity_id=revision id)
- RLS on `enrolment_documents` scoped to admissions staff roles

---

## Sprint 9 — Locked-sheet Change Request Workflow ✅ Done (2026-04-15)

**Goal:** Replace the free-text `approval_reference` flow for post-lock edits with a structured request/approve/apply state machine that can be audited, reviewed, and notified on. Hard Rule #5 is preserved — every post-lock mutation still writes an `approval_reference` string to `grade_audit_log` — but the client no longer types it, and the server now derives it from either an approved request (Path A) or a structured data-entry correction reason (Path B).

### Backend (commit `80033c0`)

- [x] Migration `009_change_requests.sql` — `grade_change_requests` table with full lifecycle columns (`pending → approved → applied`, plus `rejected` / `cancelled`), slot-shape constraint, 4 indexes, RLS (authenticated SELECT via `current_user_role()`, deny-all writes — mutations go through service-role in API routes)
- [x] `lib/schemas/change-request.ts` — zod schemas for create/review/apply payloads, `reason_category` enum, `justification` ≥20 chars
- [x] `app/api/change-requests/route.ts` — POST (teacher files a request, snapshots `current_value`, audit-logged) + GET (teachers see own, admin+ see all, filterable by `?mine=1` / `?status=` / `?sheet_id=`)
- [x] `app/api/change-requests/[id]/route.ts` — PATCH (admin+ approve/reject; teacher cancel-own-pending), state-machine validation, `decision_note` required on reject, audit-logged
- [x] `lib/notifications/email-change-request.ts` — Resend-powered notifier with 3 templates (submitted → admins, decided → teacher, applied → teacher), Aurora Vault branded HTML, best-effort (silent no-op when `RESEND_API_KEY` unset)
- [x] `lib/audit/log-action.ts` — new action types (`change_request.create` / `.approve` / `.reject` / `.cancel` / `.apply`) wired through

### UI + entry-route integration (commit `3019028`)

- [x] `app/(dashboard)/grading/[id]/request-edit-button.tsx` — teacher RHF form (shadcn `Sheet` + `Form` + `FieldGroup`) to file a change request against a specific `(student × field × slot)`: field picker, proposed-value input validated against sheet max, reason category select, justification textarea (≥20 chars client + server)
- [x] `app/(dashboard)/grading/requests/page.tsx` + `my-requests-cancel-button.tsx` — teacher-facing "My change requests" list with status badges, cancel-own-pending action
- [x] `app/(dashboard)/admin/change-requests/page.tsx` + `decision-buttons.tsx` — admin inbox: pending tab with per-row Approve/Reject `AlertDialog`s, reviewed history tab, deep-links to the target sheet
- [x] `components/grading/use-approval-reference.tsx` rebuilt — Path A/B branched dialog: Path A shows the list of approved requests for the current row and applies the selected one; Path B captures a structured `correction_reason` from a fixed enum (typo, miscounted, wrong-student, etc.). Free-text approval strings no longer possible from the UI.
- [x] `app/api/grading-sheets/[id]/entries/[entryId]/route.ts` — entry PATCH route rewritten: rejects any `approval_reference` in the body with a 400, requires `change_request_id` (Path A) or `correction_reason` (Path B), re-validates typed values against the approved proposal (typed value must match), derives the `approval_reference` string server-side, marks the change request `applied` with `applied_by` / `applied_at`, audit-logged via `change_request.apply`. Totals PATCH route (`app/api/grading-sheets/[id]/totals/route.ts`) gets the same Path B gate for max-score updates on a locked sheet.
- [x] `components/grading/score-entry-grid.tsx` + `letter-grade-grid.tsx` + `totals-editor.tsx` — call sites updated to use the new `useApprovalReference()` promise-based hook and the new request-file entry point
- [x] `lib/auth/roles.ts` + `app/(dashboard)/layout.tsx` — sidebar nav gains "Change requests" entries (teacher: `/grading/requests`; admin+: `/admin/change-requests`)

### Definition of Done

- [x] Teacher can file a change request against a locked sheet row and see it in their "My requests" list
- [x] Admin/superadmin see pending requests in the inbox and can approve or reject with a decision note
- [x] Registrar applying an approved request on the grading grid re-validates the typed value matches the proposal and writes `approval_reference = "Request #... approved by ..."` to `grade_audit_log`
- [x] Registrar can also bypass the request flow for pure data-entry corrections via Path B — a structured `correction_reason` is logged as `approval_reference = "Data entry correction: ..."`
- [x] Free-text `approval_reference` is no longer accepted by the API (returns 400)
- [x] Resend emails fire at submit / decide / apply, best-effort, idempotent per transition

---

## Testing Checklist (before each sprint sign-off)

### Formula verification

Use these known values from the actual Math grading sheet (P1 Patience, student 1):

- WW: W1=10, W2=10 out of 10,10 → WW_PS = 100, WW_WS = 40.0
- PT: PT1=6, PT2=10, PT3=10 out of 10,10,10 → PT_PS = 86.67, PT_WS = 34.67
- QA: 22 out of 30 → QA_PS = 73.33, QA_WS = 14.67
- Initial Grade: 89.34
- Quarterly Grade (transmuted): **93** ✓

### Section names to use for testing

```
P1 Patience, P1 Obedience
P2 Honesty, P2 Humility
S1 Discipline 2, S2 Integrity 2
```

### Known data quality issues to test

- Student with all null WW scores (late enrollee)
- Student with zero QA score (took exam, scored zero)
- Section name typo normalization ("Courageos" → "Courageous")
