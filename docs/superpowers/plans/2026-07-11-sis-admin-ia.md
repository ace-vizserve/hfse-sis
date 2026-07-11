# SIS Admin IA & Navigation Redesign — Fix Plan (sub-project 2, expanded)

## Context

The owner's complaint after using SIS Admin: too many clicks; the module should be straightforward. Three parallel design reviews (click-path audit of 11 real jobs · adversarial per-page verdicts · benchmark of Gibbon/openSIS/PowerSchool/Veracross admin IA) converge on the same diagnosis:

1. **Jobs are split across surfaces**: "create a staff account AND make them a teacher" spans 2 pages, 2 nav groups, 2 role gates; audit lives in two places (hub `?view=audit` BI tab + `/sis/audit-log`); adviser assignment has two competing entry points.
2. **Nav groups are named by cadence, not job** — "Year Setup" holds daily work (Calendar, Sections, Staff); "Organisation" mixes once-a-year config with daily tools.
3. **The hub is a second sidebar** — six cards verbatim-duplicate nav entries; a landing surface should show state + next actions, not a table of contents (Veracross hub pattern beats the Gibbon/openSIS menu-heavy trap).
4. **Gate mismatches create dead-ends**: registrar sees an "Admin Hub" link that bounces her; `/sis/admin/staff` has no ROUTE_ACCESS row (registrar's sidebar link is proxy-blocked); `/sis/admin/settings` inline guard admits school_admin vs superadmin-only everywhere else; the hub's School Config card claims superadmin-only while real access is school_admin+.
5. `/sis/sync-students` is verified-dead work (umbrella decision 8) still occupying a page, a hub card, and two nav entries.

Benchmark norms adopted: **hub = status + launch, not menu**; **≤2 clicks from hub/sidebar to any common task**; **three intent-named tiers** separating recurring / structural / break-glass.

This absorbs and expands umbrella sub-project 2. Branch: `feat/sis-admin-ia` stacked on `feat/levels-progression`. Execution: subagent-driven, phases with checks.

## Target IA (the design)

**Sidebar — 3 groups** (`lib/auth/roles.ts` SIS_NAV):

- **This year** (recurring; registrar + school_admin + superadmin per item): AY Setup (checklist + Manage years) · School Calendar · Sections · Staff (the merged directory) · Discount Codes.
- **Structure** (once-a-year; school_admin + superadmin): Grade Levels · Subject Weights · Structure Defaults (renamed Class Template — rename only here; full reframe stays sub-project 3).
- **Access & system** (break-glass; superadmin except School Config + Audit Log at school_admin+): Approvers · School Config · Settings · Audit Log.
- "Admin Hub" top link gated to school_admin + superadmin (kills the registrar dead-end; her direct entries remain).

**Hub** (`app/(sis)/sis/page.tsx`) keeps exactly: hero + SystemHealthStrip (superadmin) + KPI strip + class-assignment callout + Year Setup card + upcoming events. **Deletes**: Organisation/Access/Related card grids (page.tsx:345-462), the staffing card (demoted to a "Staff" link in the KPI area or dropped — implementer judgment, the Staff page owns those KPIs), the lifecycle card (admissions analytics; Records owns it), and the entire `?view=audit` tab (moves to the audit page).

**One audit surface**: `/sis/audit-log` gains a "Overview | Log" view (the hub's BI cards relocated); hub tab removed.

**One staff surface**: `/sis/admin/staff` becomes the RBAC staff directory (umbrella decision 7) — two cuts on one page: **Accounts** (create/invite, role, enable/disable — actions superadmin-gated, reusing `UsersAdminClient` machinery) and **Teaching assignments** (the existing StaffTable + assignment sheet, registrar+). `/sis/admin/users` becomes a redirect to `/sis/admin/staff?view=accounts`; nav entry removed.

## Phases (with checks)

### Phase 1 — Kill sync page + gate fixes (cheap, immediate)

- Delete `/sis/sync-students` page; remove hub card (page.tsx:361-370), SIS nav entry (roles.ts:469-473), Records sidebar cross-link (roles.ts:139-143), markbook dashboard link (`app/(markbook)/markbook/page.tsx:82`), and the `/markbook/sync-students` redirect stub. Keep the API (`app/api/students/sync`) and `auto-sync` sweep route.
- Wire the KD #90 cron: `vercel.json` cron entry invoking the existing auto-sync sweep route, guarded by `CRON_SECRET` exactly like `lock-overdue` (read that route for the idiom; the sweep route may need the Bearer-CRON_SECRET guard added).
- Gate fixes, one commit: add `{ prefix: '/sis/admin/staff', allowed: ['registrar','school_admin','superadmin'] }` to ROUTE_ACCESS before the `/sis` catch-all; tighten `admin/settings/page.tsx` inline guard to superadmin; fix subjects stale "Superadmin only" comment (`subjects/page.tsx:24`); fix approvers eyebrow "Records · Admin" (`approvers/page.tsx:47`); gate the sidebar "Admin Hub" link to school_admin+superadmin (roles.ts:417).
- _Check:_ full vitest + tsc + task review.

### Phase 2 — Sidebar IA regroup + hub slim

- Restructure SIS_NAV into the 3 groups above (labels: "This year" / "Structure" / "Access & system"); move Calendar/Sections/Staff out of "Year Setup"; move Discount Codes to This year; rename Class Template nav label → "Structure Defaults"; update `lib/sidebar/registry.ts` icon map keys if hrefs unchanged (they are) and `components/sis/command-palette.tsx` group labels to match.
- Hub slim per the design above (delete grids/lifecycle/audit-tab; school-config/staffing decisions per design; hub hero copy updated to the "run the school year" purpose; remove the retired-`admin`-tier comment rot page.tsx:232-240).
- _Check:_ build + task review + user browser smoke of the hub + sidebar in all three roles (registrar via her cross-links).

### Phase 3 — Audit consolidation

- `/sis/audit-log` gains an Overview tab hosting the relocated BI cards (`AuditDailyTrendCard`, `AuditByModuleDrillCard`, `ActivityByActorCard`, `GradeChangePipelineCard`, `AuditTopActionsCard`, `AuditAuthEventsCard`, InsightsPanel + MetricCards — components already exist under `components/sis/`, they re-mount on the new page with the same loaders); `?view=audit` branch deleted from the hub. Preserve the ComparisonToolbar range behavior.
- _Check:_ build + task review (loaders unchanged — presentation move only).

### Phase 4 — Staff directory merge (the big one)

- `/sis/admin/staff` becomes two-cut directory: Accounts cut (superadmin actions: create w/ password generator, role change, enable/disable — port from `users-admin-client.tsx`) + Assignments cut (existing). Role-aware: registrar sees assignments only; school_admin sees both read-only accounts + assignments actions; superadmin sees all actions. `/sis/admin/users` → redirect; ROUTE_ACCESS + nav + palette updated; users page files deleted.
- KD #2/#87 semantics unchanged (direct-create only, app_metadata.role).
- _Check:_ full vitest + tsc + build + task review; user smoke (create account → assign teacher in ONE surface).

### Phase 5 — Docs + final review

- KD #154 (SIS Admin IA: 3-tier nav, hub=status+launch, audit single-surface, staff directory merge, sync page removed + cron; cross-ref KD #90 cron wired, decisions 7/8/9 of the umbrella); index rows; dev-plan snapshot; CLAUDE.md session line; project-layout updates (sync-students gone, users merged).
- Whole-branch review (most capable model) → fix wave → re-review → push.
- _Check:_ READY TO MERGE verdict; user browser smoke checklist delivered.

## Deferred (explicitly out of this branch)

- Section-detail Overview merge into Markbook's detail (cross-module, riskier — noted for a later pass; Teachers tab + Move stay as-is).
- Calendar exceptions+events rework + public embed (sub-project 6; includes re-wiring the dead `copyFromPriorAyProps`).
- Template Apply-preview/drift chips (sub-project 3 — only the nav label changes now).
- Section creation at point-of-need (sub-project 4).
- Registrar-scoped hub variant (only if the gated link proves insufficient).

## Verification

1. Full `npx vitest run` + `npx tsc --noEmit` + `npx next build` at each phase gate.
2. Job-level click-count acceptance (from the audit): account+teacher = 1 surface; audit = 1 surface; every sidebar destination reachable by every role that can see its link (no dead-ends — assert via ROUTE_ACCESS vs SIS_NAV requiresRoles consistency check, worth a small unit test over the two structures).
3. User browser smoke at Phase 2 and Phase 4 gates.
