# HFSE SIS — Claude Instructions

A Student Information System for HFSE International School, Singapore. It centralizes enrollment, grades, documents, and student records in one place, all tied to a single student profile. The app is organized into modules — Markbook (grades / report cards), P-Files (documents), Admissions (applicant pipeline), SIS (profiles / family / discount codes / document validation) — that are surfaces of one system, not sibling apps. The module switcher moves between them; the shared student record is the backbone. This file is the contract for everything that ships. Read it first.

## Always Do First

- **Invoke the 'ui-ux-pro-max@ui-ux-pro-max-skill' skill** before writing frontend code, every session, no exceptions.

## Reference docs

| Doc                                         | Read when...                                             |
| ------------------------------------------- | -------------------------------------------------------- |
| `docs/sprints/development-plan.md`          | Starting any task — has status snapshot + current sprint |
| `docs/context/01-project-overview.md`       | Onboarding                                               |
| `docs/context/02-grading-system.md`         | Anything touching grade computation or formula           |
| `docs/context/03-workflow-and-roles.md`     | Permissions, locking, workflow                           |
| `docs/context/04-database-schema.md`        | DB tables / queries                                      |
| `docs/context/05-report-card.md`            | Report card UI / PDF                                     |
| `docs/context/06-admissions-integration.md` | Admissions sync                                          |
| `docs/context/07-api-routes.md`             | API contracts                                            |
| `docs/context/09-design-system.md`          | Any UI work — tokens, components, what NOT to build      |
| `docs/context/10-parent-portal.md`          | Parent portal handoff, admissions DDL, parent flow       |
| `docs/context/11-performance-patterns.md`   | Any new page — auth/cache/parallel/loading checklist     |
| `docs/context/12-p-files-module.md`         | P-Files module — document types, statuses, architecture  |
| `docs/context/13-sis-module.md`             | Records module — Phases 1–3 shipped; replacing Directus      |
| `docs/context/14-modules-overview.md`       | Cross-module work — architecture, shared identity, data contract, navigation |
| `docs/context/15-markbook-module.md`        | Grading / report-card / attendance work — module scope doc |
| `docs/context/16-attendance-module.md`      | Attendance module — agreed frame (hybrid placement, daily-only Phase 1); schema pending HFSE Excel |
| `docs/context/17-process-flow.md`           | Cross-module lifecycle + soft gates + auto-completions — design sketch, no schema changes for v1 |
| `docs/context/18-ay-setup.md`               | Superadmin AY-rollover wizard — design sketch; copy-forward + parent-portal coordination |

## Hard rules — never violate

These are non-negotiable. Code that breaks any of them does not ship.

### 1. Formula must return 93 on the canonical test case

Input: `WW=[10,10]/max=[10,10]`, `PT=[6,10,10]/max=[10,10,10]`, `QA=22/30`, weights `40/40/20`. Expected `quarterly_grade=93`. Verified by `lib/compute/quarterly.ts` self-test on module load — if it throws at build time, stop and fix before anything else.

### 2. All grade computation is server-side

Clients send raw scores and receive computed PS / Initial / Quarterly. Never compute in the browser. Single source of truth: `lib/compute/quarterly.ts`.

### 3. Blank ≠ Zero

`null` = "did not take the assessment", excluded from both numerator and denominator. `0` = "took it, scored zero", included in both. `ScoreInput` preserves this through string-level local state — empty string → `null`, `"0"` → `0`.

### 4. `studentNumber` is the only stable student ID

Never use `enroleeNumber` — it resets each AY. Cross-year linking always goes through `studentNumber` from the admissions tables.

### 5. Post-lock edits require `approval_reference`

Any PATCH to a locked sheet must include a non-empty `approval_reference` in the body. Server returns 400 if missing. Each changed field appends one row to `grade_audit_log`.

### 6. Grade entries and audit logs are append-only

Removing a score sets it to `null` with an audit entry. Withdrawn students stay in `section_students` with `enrollment_status='withdrawn'`. Audit log is never updated or deleted; unlocking does not purge it.

### 7. Design system is binding; `app/globals.css` is the only source for tokens

All UI must conform to `docs/context/09-design-system.md`. Colors, fonts, radius, and shadows are defined exactly once in `app/globals.css` and consumed through shadcn semantic Tailwind classes (`bg-background`, `text-foreground`, `bg-card`, `bg-primary`, `text-muted-foreground`, `border-border`, `ring-ring`, `bg-chart-1…5`, `bg-sidebar*`, etc.). **Never** hardcode `#rrggbb`, `oklch(...)`, or use `slate-*` / `zinc-*` / `gray-*` Tailwind utilities in `app/` or `components/`. **Never** redefine tokens in component code or in a `tailwind.config.*` file — Tailwind v4 has no JS config in this project. To change a color, edit `globals.css`.

## Tech stack

- **Next.js 16** (App Router, Turbopack, TypeScript) — single deployable at the repo root
- **Supabase** (Postgres + Auth, `@supabase/ssr`) — single shared project also hosting admissions tables
- **Tailwind CSS v4** via `@tailwindcss/postcss` (no `tailwind.config.js`)
- **`tw-animate-css`** — Tailwind v4 animation utilities (`animate-in`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*`). Imported in `app/globals.css`; `.animate-in` / `.animate-out` are overridden with longhand `animation-*` properties there because the package's minified shorthand doesn't parse.
- **`react-hook-form` + `zod` + `@hookform/resolvers`** + shadcn `Form` primitive (`components/ui/form.tsx`) — canonical stack for any submit-based form. Schemas live in `lib/schemas/`.
- **`sonner`** via shadcn `components/ui/sonner.tsx` — canonical toast system. `<Toaster />` mounted once in `app/layout.tsx` (light theme, top-right, richColors). All action feedback flows through `toast.success` / `toast.error`, not inline `<Alert>` blocks.
- **`@tanstack/react-table`** + **`recharts`** — canonical data-table and charting engines for dashboards
- **`pdf-merger-js`** — server-only PDF merger for P-Files upload pipeline. When staff select multiple PDFs in the upload dialog, the API route merges them into a single `.pdf` before writing to Storage. Marked in `next.config.ts::serverExternalPackages` so the `pdf-lib` transitive doesn't trip the bundler.
- **Vercel** — deployment target (Root Directory: repo root / blank)
- **PDF generation deferred** — browser Print / Save as PDF covers current volume. If automation is needed later, prefer Puppeteer-in-Next.js over the original Python/WeasyPrint plan.

### Next.js 16 gotchas

These differ from Next 15 and from typical training data. Authoritative reference: `node_modules/next/dist/docs/`.

- **`middleware.ts` is renamed to `proxy.ts`**. The exported function must be named `proxy`. See `proxy.ts` at the repo root.
- `cookies()`, `headers()`, `params`, `searchParams` are async — always `await`.
- Use `@supabase/ssr`, never the deprecated `@supabase/auth-helpers-nextjs`.
- Use `next/navigation` for redirects in server components, never `next/router`.

## Project layout

Single deployable at the repo root. The Next.js project lives directly in the repo root — there is no `app/` wrapper subdirectory. The `app/` directory below is the Next.js **App Router**, not a subproject.

```
hfse-markbook/
├── proxy.ts                  ← auth + role gate (renamed from middleware.ts)
├── app/                      ← App Router
│   ├── (auth)/login/
│   ├── (dashboard)/          ← neutral shared shell (no module sidebar) — hosts only /, /account, and redirect stubs
│   │   ├── page.tsx          ← root `/` — role-based redirect + 4-tile peer-module picker (school_admin+admin); teacher→/markbook, p-file→/p-files, parent→/parent, superadmin→/sis (KD #42)
│   │   ├── account/          ← /account: self-serve password change (all roles)
│   │   └── admin/
│   │       ├── page.tsx      ← /admin → redirects to /records (legacy bookmark; was /admin/admissions)
│   │       └── admissions/   ← redirect stub → /records (dashboard consolidated per KD #45)
│   ├── (markbook)/markbook/  ← Markbook module: page.tsx (dashboard — grading-specific charts: grade distribution, sheet lock progress, change-request summary, publication coverage, recent activity), grading/{page,[id],new,requests,advisory/[id]/comments}, report-cards/{page,[studentId]}, sections/{page,[id]/{page,attendance,comments}}, sync-students/, change-requests/, audit-log/
│   ├── (parent)/parent/      ← parent portal SSO landing + report card view
│   │   ├── enter/            ← token-fragment handoff from enrol.hfse.edu.sg
│   │   └── report-cards/     ← parent-scoped report card view
│   ├── (p-files)/p-files/    ← P-Files module: dashboard (summary + completion-by-level + top-missing + revisions-over-time + expiring), [enroleeNumber] student detail, audit-log (module-scoped)
│   ├── (records)/records/    ← Records module: dashboard (consolidated — 5 Records aggregators + 5 admissions widgets + activity feed), students list + detail (4 tabs), discount-codes, audit-log
│   ├── (sis)/sis/            ← SIS Admin hub: /sis (landing — 3 admin cards + superadmin health strip), /sis/ay-setup (wizard), /sis/admin/approvers (superadmin)
│   └── api/                  ← all routes (one folder per resource; incl. api/admissions/export, api/p-files/[enroleeNumber]/{upload,revisions}, api/sis/{search,students/[enroleeNumber]/{profile,family/[parent],stage/[stageKey]},ay-setup,admin/approvers}, api/users/approvers)
├── lib/
│   ├── supabase/             ← client / server / service / middleware / admissions helpers
│   ├── auth/                 ← roles, require-role, teacher-assignments
│   ├── compute/              ← quarterly.ts + annual.ts (both with self-tests)
│   ├── audit/                ← log-action.ts (generic) + log-grade-change.ts (legacy)
│   ├── notifications/        ← email-parents-publication.ts + email-change-request.ts (Resend)
│   ├── report-card/          ← build-report-card.ts (shared staff+parent fetch)
│   ├── admissions/           ← dashboard.ts — cached read-only query helpers (consumed by /records post-KD #45)
│   ├── markbook/             ← dashboard.ts — grade distribution, sheet lock progress, change-request summary, publication coverage, recent markbook activity (5 aggregators)
│   ├── p-files/              ← document-config.ts + queries.ts + mutations.ts + dashboard.ts (completion-by-level, revisions-over-time)
│   ├── sis/                  ← queries.ts (Records reads) + dashboard.ts (records aggregators: pipeline/documents/levels/expiring/activity) + health.ts (SIS hub system-health strip) + ay-setup/{queries,admissions-ddl}.ts + approvers/queries.ts
│   ├── change-requests/      ← sidebar-counts.ts — per-role pending-count badge query
│   ├── schemas/              ← zod schemas shared by RHF forms (and by API routes once server validation is adopted)
│   ├── academic-year.ts      ← getCurrentAcademicYear / requireCurrentAyCode
│   ├── csv.ts                ← toCsvValue + buildCsv — shared RFC-4180 escape used by every /api/**/export route
│   └── sync/                 ← students planner, snapshot loader, normalizers
├── components/grading/       ← score-entry-grid, lock-toggle, totals-editor, use-approval-reference (shadcn Dialog hook replacing window.prompt), ...
├── components/admin/         ← teacher-assignments-panel, publish-window-panel, publication-status
├── components/admissions/    ← pipeline-cards, funnel/by-level/assessment/referral charts, outdated table, ay-switcher (consumed by /records)
├── components/markbook/      ← grade-distribution-chart, sheet-progress-chart, change-request-panel, publication-coverage-chart, recent-markbook-activity (module-specific dashboard widgets)
├── components/report-card/   ← report-card-document (shared render, print CSS)
├── components/ui/            ← shadcn primitives (button/card/table/field/form/select/tabs/dropdown-menu/sheet/dialog/alert-dialog/sonner/popover/calendar/...) + DatePicker (date-only) + DateTimePicker (datetime-local) wrappers + PageShell layout wrapper
├── components/p-files/       ← summary-cards, completeness-table, document-card, upload-dialog, history-dialog, completion-by-level-chart, revisions-over-time-chart, top-missing-panel
├── components/sis/           ← Records UI (student-data-table, cross-ay-search, status-badge, field-grid, enrollment-history-chips, edit-{stage,profile,family}-{dialog,sheet}) + dashboard widgets ({pipeline-stage,document-backlog,level-distribution}-chart, expiring-documents-panel [parameterised studentHrefBase for cross-module reuse], recent-activity-feed) + SIS Admin UI (ay-setup-wizard, ay-switch-active-dialog, ay-delete-dialog, approver-assign-dialog, approver-revoke-button, system-health-strip)
├── components/{markbook,parent,p-files,records,sis}-sidebar.tsx
├── components/module-switcher.tsx ← school_admin+admin+superadmin header dropdown: Markbook ↔ P-Files ↔ Records ↔ SIS Admin
├── supabase/
│   ├── migrations/           ← 001_initial_schema → 013_approver_assignments
│   └── seed.sql              ← AY2026 + levels + subjects + sections + terms + configs
├── docs/                     ← context docs (incl. 08-admission-dashboard.md, 10-parent-portal.md) + sprint plan
└── types/index.ts
```

## Environment variables

```bash
# .env.local (at repo root)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=              # server-only, bypasses RLS
PDF_SERVICE_URL=                   # reserved, currently unused
NEXT_PUBLIC_PARENT_PORTAL_URL=     # parent-portal dashboard, per-environment (see docs/context/10-parent-portal.md)
RESEND_API_KEY=                    # server-only, parent report-card notifications via Resend
RESEND_FROM_EMAIL=                 # optional, defaults to "HFSE SIS <noreply@hfse.edu.sg>"
# Microsoft 365 / SharePoint — unblocks Sprint 7 Part B + Sprint 10 Phase 4 (inquiry sync).
# All 5 required together; integration silently no-ops if any unset.
M365_TENANT_ID=                    # Azure AD tenant GUID (Azure Portal)
M365_CLIENT_ID=                    # App registration client ID
M365_CLIENT_SECRET=                # App registration client secret (shown once — copy immediately)
SHAREPOINT_SITE_ID=                # Graph: GET /sites/{hostname}:/{site-path}
SHAREPOINT_LIST_ID=                # Graph: GET /sites/{site-id}/lists
```

Original plan had separate `ADMISSIONS_SUPABASE_*` vars; dropped because admissions and grading share one Supabase project. `lib/supabase/admissions.ts` reuses `createServiceClient()`.

## Key decisions

1. **Single Supabase project** for grading + admissions tables.
2. **Roles in `app_metadata.role`** (`teacher | registrar | school_admin | admin | superadmin | p-file`). No `user_roles` table. `p-file` is module-scoped to `/p-files/*`; `school_admin`, `admin`, and `superadmin` see all modules via the module switcher. Within P-Files, `school_admin` and `admin` are read-only (browse, view files, see history) — only `p-file` officers and `superadmin` can upload / replace. The `admin` vs `school_admin` split is intentional: see KD #39 (academic approvals vs operations).
3. **Teacher assignments** in `teacher_assignments` table: `(user × section × subject × role)` where role is `form_adviser` (one per section) or `subject_teacher` (one per section × subject). Gates `/api/grading-sheets` list and `PUT /api/sections/[id]/comments`.
4. **Weights per `(subject × level × AY)`** in `subject_configs`. Primary 40/40/20, Secondary 30/50/20. Never hardcoded.
5. **Max 5 WW + 5 PT slots per sheet** (`subject_configs.ww_max_slots / pt_max_slots`).
6. **Max 50 students per section.**
7. **Overall annual grade** = `T1×0.20 + T2×0.20 + T3×0.20 + T4×0.40`, rounded 2dp. See `lib/compute/annual.ts`.
8. **PDF generation deferred** — browser print covers current volume.
9. **RLS is tightened** — JWT role gate + deny-writes on `authenticated` + per-teacher row scoping on grade/student tables (migrations `004`, `005`). Must be applied before production UAT.
10. **Comprehensive audit log** in `006_audit_log.sql` (`public.audit_log` — generic `{actor, action, entity_type, entity_id, context}` rows) written from every mutating API route via `lib/audit/log-action.ts`. Historical `grade_audit_log` kept intact. **Audit log is split by module**: `/admin/audit-log` excludes rows with `action LIKE 'pfile.%'`; `/p-files/audit-log` includes *only* those rows. Both pages render via the same `AuditLogDataTable` component. Hard Rule #6 still applies.
11. **Report card publication windows** in `007_report_card_publications.sql` — per-section, per-term `(publish_from, publish_until)` gates the parent view. Registrar publishes via `/report-cards` list page. See `docs/context/10-parent-portal.md`.
12. **Parents are null-role Supabase Auth users** in the shared project. `getUserRole()` returns `null` for them; `proxy.ts` routes null-role users to `/parent/*` only. Parent↔student linkage lives in admissions `ay{YY}_enrolment_applications` (`motherEmail`/`fatherEmail`) — resolved via `getStudentsByParentEmail()` in `lib/supabase/admissions.ts`.
13. **Parent portal SSO handoff** via URL fragment at `/parent/enter`. Parents sign in once at `https://enrol.hfse.edu.sg`, click "View report card" there, arrive at the markbook with `#access_token=&refresh_token=&next=` in the URL; client-side `supabase.auth.setSession()` establishes the markbook session without a second login. See `docs/context/10-parent-portal.md` for the integration snippet.
14. **Dynamic academic year** via `lib/academic-year.ts::getCurrentAcademicYear()` — reads `academic_years WHERE is_current=true`. Never hardcode `'AY2026'` in runtime code; admissions table prefixes (`ay{YY}_enrolment_*`) are derived from the current AY code so rolling to AY2027 is a DB flag flip, not a code change.
15. **Aurora Vault palette** — core shadcn semantic tokens in `app/globals.css` `:root` are remapped to the Aurora Vault hex palette (navy `#0B1120`, indigo `#4F46E5`, ink ramp `#0F172A`→`#94A3B8`, hairline `#E2E8F0`). Raw values use the `--av-*` prefix to avoid self-reference cycles with `@theme inline`. All shadcn semantic utilities (`bg-primary`, `text-foreground`, `border-border`, `bg-card`) and explicit Aurora Vault utilities (`bg-brand-indigo`, `text-ink`, `border-hairline`) render identically — use either. Full token table and page→component matrix in `docs/context/09-design-system.md`.
16. **`@tanstack/react-table` is the canonical data-table engine** for filterable/sortable/paginated lists. Reference implementation: `app/(markbook)/markbook/grading/grading-data-table.tsx` (dashboard-01 toolbar pattern with global search, faceted level filter, column visibility, status tabs, pagination). New data tables start from there, not from a bare `<Table>` wrapper.
17. **Email via Resend is best-effort** — `lib/notifications/*` (parent publications + change-requests). Failures log but never fail the request. Idempotent via DB flags (e.g. `report_card_publications.notified_at`). No-ops without `RESEND_API_KEY`.
18. **Admissions analytics are read-only and consolidated into `/records`** — aggregates in `lib/admissions/dashboard.ts` (`unstable_cache`, 10-min TTL, tag `admissions-dashboard:${ayCode}`). Post-KD #45 they render inside the Records dashboard (`/records`) alongside the internal 9-stage pipeline; `/admin/admissions` and `/admin` are pure redirects to `/records` for legacy bookmarks. Superadmin-only CSV export at `/api/admissions/export`. Sprint 7 Part B + Sprint 10 Phase 4 (SharePoint inquiries) unblock as soon as HFSE IT provides the 5 M365 env vars; `.env.local.example` has the slots. Details: `docs/context/08-admission-dashboard.md`.
20. **Forms: RHF + zod + shadcn `Form`** — every submit-based form (`login`, `change-password`, `manual-add-student`, `new-sheet`) uses `useForm` with `zodResolver`, a schema from `lib/schemas/`, and `<FormField>`/`<FormMessage>` for per-field errors. Autosave grids (`score-entry-grid`, `letter-grade-grid`, `comments-grid`, `attendance-grid`), the slot-array editor (`totals-editor`), the inline-edit publish panel, and select-only admin panels stay on raw state — RHF's submit lifecycle is a bad fit for per-cell autosave. Schemas live outside `app/` and `components/` so API routes can import them later.
21. **Feedback: toasts + dialogs, never `window.*` and never inline error alerts** — all action feedback goes through `toast.success`/`toast.error` (sonner). Destructive confirmations use shadcn `AlertDialog`; locked-sheet approval-reference prompts use shadcn `Dialog` via the shared `components/grading/use-approval-reference.tsx` hook (returns a promise-based `requireApproval()` + the dialog JSX to mount). The only remaining inline `<Alert>` is the empty-state notice in `teacher-assignments-panel.tsx` (persistent informational content, not transient feedback). Native `window.alert` / `window.confirm` / `window.prompt` are banned.
22. **Three Supabase clients, strict separation.** `createClient()` from `lib/supabase/server.ts` is the default for server components and API route reads — cookie-scoped, RLS-enforced. `createServiceClient()` from `lib/supabase/service.ts` bypasses RLS and is reserved for (a) mutating API routes that write past row-level scoping, (b) school-wide read aggregations where RLS would leak per-user shapes (dashboard stats, admissions analytics), and (c) server-only helpers like `lib/notifications/email-parents-publication.ts`. `createClient()` from `lib/supabase/client.ts` (browser) is rarely used — the only current legitimate caller is `/parent/enter` for the SSO session handoff. Client components should go through API routes, not talk to Supabase directly.
23. **API route request validation is mixed: manual for simple shapes, zod `safeParse` for complex ones.** Simple mutating routes (grading, attendance, publications, etc.) still use the manual pattern: `const body = await request.json().catch(() => null)` → inline null/required/shape checks → `NextResponse.json({ error }, { status: 400 })`. Complex routes — notably every SIS PATCH (`/api/sis/students/[enroleeNumber]/{profile,family/[parent],stage/[stageKey]}`) — import a schema from `lib/schemas/` and call `schema.safeParse(body)` → return `{ error, details: parsed.error.flatten() }` on failure. Both patterns coexist; pick based on field count. Don't migrate existing routes just to align.
24. **Client mutations: raw `fetch` + `toast.error`, no React Query.** Client components mutate via `fetch(url, { method, body })` → `if (!res.ok) throw` → `catch(e) { toast.error(e.message) }`. Reference: `components/grading/totals-editor.tsx`. The one reserved candidate for `@tanstack/react-query` is the grading grid autosave — see `docs/context/11-performance-patterns.md` §4. Everywhere else, follow the raw-`fetch` pattern and do not introduce React Query as a general dependency.
25. **Locked-sheet edits go through a structured change-request workflow, not free-text approval strings.** Teachers file a `grade_change_requests` row (RHF form in `app/(markbook)/markbook/grading/[id]/request-edit-button.tsx`); admin+ approve/reject at `/markbook/change-requests`; registrar applies the approved request (Path A) or logs a correction (Path B) via `components/grading/use-approval-reference.tsx`. The entry PATCH route rejects free-text `approval_reference` in the body and requires `change_request_id` or `correction_reason`; the server derives the `approval_reference` string itself. Hard Rule #5 still holds (migration `009_change_requests.sql`).
27. **Report card has two templates: interim (T1–T3) and final (T4).** `ReportCardDocument` takes a `viewingTermNumber` prop. Final shows all four terms + Final Grade column + General Average + cumulative Attendance %; interim is T1–T3 side-by-side, no Final Grade. Non-examinable subjects show "Passed" in T4. Compute: `lib/compute/annual.ts` (with self-tests). Rendering detail: `docs/context/05-report-card.md`.
28. **Pre-publish readiness is a soft gate, not a hard block.** `publish-window-panel.tsx` calls `GET /api/sections/[id]/publish-readiness?term_id=` and shows a per-item checklist. Registrar can always "Publish anyway". See `docs/context/05-report-card.md` for the exact checks.
29. **Dev email redirect** — in non-production (`NODE_ENV !== 'production'`), all Resend emails are redirected to a static dev address. Both `email-parents-publication.ts` and `email-change-request.ts` override the `to` field.
31. **P-Files is a repository, not a review queue.** Three-tier access at `/(p-files)/p-files/*`: `p-file` + `superadmin` write, `school_admin` + `admin` read, all others blocked. P-Files writes URLs + metadata + archives prior versions on replace — it NEVER sets `'Rejected'` (that's SIS's job per KD #37). Staff uploads auto-status to `'Valid'`; parent uploads come in as `'uploaded'` (rendered "Pending review"). Storage bucket: `parent-portal`. Full contract: `docs/context/12-p-files-module.md`.
32. **Dates: ISO 8601 UTC in storage and transit, display-layer local.** Timestamps flow as UTC ISO strings end-to-end (Postgres `timestamptz`, API JSON, server component props). Display conversion to Singapore local happens at render time via `new Date(iso).toLocaleString('en-SG')`. No `dayjs` / `date-fns` / `moment` is imported anywhere — don't add one (`date-fns` sits in `package.json` as a transitive of `react-day-picker` only). Publication windows (`publish_from` / `publish_until`) and audit timestamps follow the same rule. When adding new timestamp fields, keep them UTC in the DB and let the UI format them.
33. **Module switcher** — `components/module-switcher.tsx` is a shadcn `Select` rendered in all five layouts' sticky header (`app/(dashboard)/layout.tsx` + `app/(markbook)/layout.tsx` + `app/(p-files)/layout.tsx` + `app/(records)/layout.tsx` + `app/(sis)/layout.tsx`). `currentModule` is typed `"markbook" | "p-files" | "records" | "sis" | null` — `null` is used by the `(dashboard)` shell (neutral pages like `/` and `/account`) so the trigger renders as "Home" rather than a specific module. When `canSwitch` is false it renders a plain icon + label lockup. When the current user is `school_admin`, `admin`, or `superadmin`, it renders a select trigger with a stacked up/down chevron (Vercel-style) that `router.push`es between `/markbook`, `/p-files`, `/records`, and `/sis`. `p-file` users stay locked to P-Files; `registrar` reaches Records via the sidebar nav link but never sees the switcher; teachers never reach any of them.
34. **P-Files upload is dual-table + merge + archive-on-replace.** `POST /api/p-files/[enroleeNumber]/upload` writes the URL to `ay{YY}_enrolment_documents` AND mirrors passport/pass metadata to `ay{YY}_enrolment_applications`. Multi-PDF inputs merge via `pdf-merger-js`; 10MB/file, 30MB/request. When a file exists at the canonical path, the route archives it to `…/revisions/<iso>.<ext>` and writes a `p_file_revisions` snapshot before overwriting. Slot→column map in `lib/p-files/document-config.ts::SlotMeta`. Full contract: `docs/context/12-p-files-module.md`.
35. **Server-component auth uses `getSessionUser()`**, not `getUser()`. `lib/supabase/server.ts` exports `getSessionUser()` which wraps `supabase.auth.getClaims()` (local JWT verification against cached JWKS — no network round-trip) and returns `{ id, email, role: Role | null }`. All three layouts and every role-gated page use it. API routes still use `requireRole()` (which calls `getUser()` internally); the nav hot path is what matters for latency. Full rationale + migration list in `docs/context/11-performance-patterns.md` §1.
36. **P-Files revision history is append-only.** Each replacement writes a `p_file_revisions` snapshot (migration `011`); reads via `GET /api/p-files/[enroleeNumber]/revisions?slotKey=…`. P-Files `DocumentStatus` excludes `'rejected'` — document validation is SIS's job (KD #37). Hard Rule #6 applies.
37. **Records module writes admissions data; SIS is the sole writer of `'Rejected'`.** Three PATCH routes under `/api/sis/students/[enroleeNumber]/{profile,family/[parent],stage/[stageKey]}` + catalogue CRUD at `/api/sis/discount-codes` + document validation at `/api/sis/students/[enroleeNumber]/document/[slotKey]`. All writes go through zod schemas in `lib/schemas/sis.ts::safeParse`, write a per-field `context.changes` diff to `audit_log` under the `sis.*` action prefix, then `revalidateTag('sis:${ayCode}', 'max')`. Stable IDs (`enroleeNumber`, `studentNumber`) are NOT in any schema — routes 400 if sent. Discount-code catalogue is Records-owned; per-student grants are written directly by the enrolment portal into `discount1/2/3`. Full contract: `docs/context/13-sis-module.md`.
38. **This product is an SIS; modules are surfaces, not apps.** Markbook, P-Files, Admissions, and Records all read/write facets of the same student record. Cross-module links resolve through `studentNumber` (Hard Rule #4), never `enroleeNumber` (which resets each AY). When a new per-student domain arrives (attendance, medical, communications, etc.), treat it as another tab on the same profile, not a silo.
39. **`admin` vs `school_admin` — only difference is the grade-change approval pool.** `admin` = academic-admin / grade-change approvers (principals, academic head). `school_admin` = everyone else with admin-grade access (AY setup, Records, discount codes, P-Files read, exports). `school_admin` is excluded from `listEligibleApproverCandidates` and cannot approve grade-change requests; they get admin access everywhere else. Superadmin is reserved for destructive/IT/CEO ops and is NOT in the grade-approval pool either. HFSE mapping: Chandana + Tin = `admin`; office staff = `school_admin`; Joann = `registrar`; Amier + CEO = `superadmin`.
40. **AY rollover is a DB flag flip, not a code deploy.** `/sis/ay-setup` wizard calls `rpc('create_academic_year')` — atomically inserts the year + 4 terms + copies sections/subject_configs + creates the 4 AY-prefixed admissions tables. Superadmin-only `rpc('delete_academic_year')` is emptiness-guarded across 10+ child tables. AY switcher reads `listAyCodes()` at runtime (migration `012`). DDL source of truth: `docs/context/10-parent-portal.md` §Reference DDL. Details: `docs/context/18-ay-setup.md`.
41. **Approver routing is per-flow + designated, not broadcast.** `approver_assignments(user_id, flow)` (migration `013`) maps admin users to approval pools (today: `markbook.change_request`; extensible for future flows). Teacher picks primary + secondary at submission; only those two see the request. Approve/reject requires actor-is-designated AND `role === 'admin'` (superadmin is NOT in the grade-approval pool — they manage the list at `/sis/admin/approvers`). `school_admin` is deliberately excluded from eligibility per KD #39.
42. **Records module routes at `/records/*`; `/sis` is the SIS Admin hub.** Records module (registrar + school_admin + admin + superadmin) lives at `app/(records)/records/*` with its own sidebar (`components/records-sidebar.tsx`) and layout. SIS Admin hub at `app/(sis)/sis/*` hosts `/sis` (landing with 4 admin cards), `/sis/ay-setup`, `/sis/admin/approvers` — access gated to school_admin + admin + superadmin (approvers page tightens to superadmin only). Module switcher carries 4 entries: Markbook / P-Files / Records / SIS Admin. **Superadmin defaults to `/sis`** on navigation to `/` (redirect in `app/(dashboard)/page.tsx`) — their job is structural oversight, not Markbook daily use. Internal identifiers (API paths `/api/sis/*`, cache tag `sis:${ayCode}`, audit prefix `sis.*`, filenames `13-sis-module.md`, `lib/sis/*`, `components/sis/*`) stay unchanged for stability — renaming would invalidate historical audit rows + cache entries. The `Module` union now has four values (`"markbook" | "p-files" | "records" | "sis"`); `"records"` identifies the Records module, `"sis"` identifies the admin hub.
43. **Markbook routes at `/markbook/*`; `/` is a neutral peer-module picker.** Markbook (`app/(markbook)/markbook/*`) has its own sidebar (`components/markbook-sidebar.tsx`) and layout, mirroring the other three modules. Inside: `/markbook` (dashboard — grading-specific charts only, no cross-module data; see KD #46), `grading/*`, `report-cards/*`, `sections/*`, `sync-students`, `change-requests`, `audit-log` (all moved from the legacy `(dashboard)` group). The root `/` is now a role-based redirect + 4-tile peer-module picker (Markbook / Records / P-Files / SIS Admin) rendered in the slim `(dashboard)` shell: `teacher` → `/markbook`, `p-file` → `/p-files`, parent → `/parent`, `superadmin` → `/sis` (KD #42), and `registrar`/`school_admin`/`admin` see the picker. There is no "main" module — all four are peers; the picker exists because multi-module roles have no single "default" surface. The `(dashboard)` shell also hosts `/account` (shared) and two redirect stubs (`/admin`, `/admin/admissions`) that bounce to `/records` per KD #45. `ROUTE_ACCESS` retired the legacy `/grading` / `/report-cards` / `/admin` prefixes in favor of `/markbook`.
44. **DatePicker is canonical; no native `<input type="date">`.** `components/ui/date-picker.tsx` is a shadcn `Popover` + `Calendar` wrapper for date-only fields; it returns `yyyy-MM-dd` strings (matching the schemas in `lib/schemas/`). Datetime fields use the sibling `components/ui/date-time-picker.tsx` (ISO-8601 UTC). Native `<input type="date">` / `type="datetime-local">` / `type="time">` are banned anywhere in `app/` or `components/` except inside the primitives themselves. Every existing consumer — `edit-discount-code-dialog.tsx`, `p-files/upload-dialog.tsx` — now uses the wrapper. Design-system rule: §4.1 "shadcn primitive or shadcn registry only."
45. **One consolidated dashboard per module; no cross-module data leaks.** Each module's landing page shows only its own data — Markbook reads grading tables, P-Files reads documents + revisions, Records reads admissions + documents + stages, SIS shows system health. `/records` deliberately absorbs the admissions analytics lens (conversion funnel, time-to-enroll, outdated applications, assessment outcomes, referral sources) because Records *is* the operational admissions surface (KD #42); `/admin/admissions` and `/admin` are pure redirect stubs to `/records`. The SIS hub keeps 3 AdminCards (Records / AY Setup / Approvers) — the 4th "Admissions Dashboard" card is gone since Records subsumes it. Previously Markbook borrowed admissions widgets (`PipelineCards`, `OutdatedApplicationsTable`) on its dashboard; those were removed 2026-04-21.
46. **Module-specific dashboard aggregator libraries.** Every module that ships a data dashboard owns its own `lib/<module>/dashboard.ts` (or `health.ts` for SIS): `lib/markbook/dashboard.ts` (grade distribution, sheet lock progress, change-request summary, publication coverage, recent markbook activity; tag `markbook:${ayId}`), `lib/p-files/dashboard.ts` (completion-by-level, revisions-over-time; tag `p-files-dashboard:${ayCode}`), `lib/sis/dashboard.ts` (5 Records aggregators; tag `sis:${ayCode}`), `lib/sis/health.ts` (AY + approver-flow coverage; tag `sis` + `markbook`), `lib/admissions/dashboard.ts` (8 admissions aggregators consumed by `/records`; tag `admissions-dashboard:${ayCode}`). Cache-wrapper pattern: hoist the inner `load*Uncached` functions to module scope; per-AY wrappers compose `unstable_cache` per-call for dynamic tags; static-tag aggregators fully hoist. Matches `lib/p-files/queries.ts::loadRawData` + `lib/admissions/dashboard.ts` convention. Chart components live alongside under `components/<module>/`. Design rule: consistent canonical hero + trust-strip shape across data dashboards (`/records`, `/markbook`, `/p-files`, `/admin/admissions`); the `/sis` hub stays simpler as a navigation surface.

## Workflow

1. Read `docs/sprints/development-plan.md` for current sprint + status snapshot.
2. Build against the sprint's Definition of Done. Don't ship anything that breaks a hard rule above.
3. Verify with `npx next build` (clean compile required) and a manual happy-path test in the browser before marking anything done.
4. After meaningful work, run **`/sync-docs`** to keep this file and the dev plan accurate. The slash command surveys the repo, diffs against both docs, and applies targeted edits.
