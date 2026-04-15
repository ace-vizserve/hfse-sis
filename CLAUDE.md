# HFSE Markbook — Claude Instructions

A web app replacing manual Google Sheets grading at HFSE International School, Singapore. This file is the contract for everything that ships. Read it first.

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
│   ├── (dashboard)/
│   │   ├── page.tsx          ← root `/` — single dashboard; admin content inlined, role-gated
│   │   ├── account/          ← /account: self-serve password change (all roles)
│   │   ├── grading/          ← teacher path: list, [id] grid, advisory comments, requests (my change requests)
│   │   ├── admin/            ← /admin redirects to /; nested routes live here (admissions, sections, sync, audit-log, change-requests)
│   │   │   └── admissions/   ← Sprint 7 Part A full dashboard (pipeline, funnel, outdated, etc)
│   │   └── report-cards/     ← HTML preview + browser print + publication window
│   ├── (parent)/parent/      ← parent portal SSO landing + report card view
│   │   ├── enter/            ← token-fragment handoff from enrol.hfse.edu.sg
│   │   └── report-cards/     ← parent-scoped report card view
│   └── api/                  ← all routes (one folder per resource; incl. api/admissions/export)
├── lib/
│   ├── supabase/             ← client / server / service / middleware / admissions helpers
│   ├── auth/                 ← roles, require-role, teacher-assignments
│   ├── compute/              ← quarterly.ts + annual.ts (both with self-tests)
│   ├── audit/                ← log-action.ts (generic) + log-grade-change.ts (legacy)
│   ├── notifications/        ← email-parents-publication.ts (Resend)
│   ├── report-card/          ← build-report-card.ts (shared staff+parent fetch)
│   ├── admissions/           ← dashboard.ts — cached read-only query helpers for /admin/admissions
│   ├── schemas/              ← zod schemas shared by RHF forms (and by API routes once server validation is adopted)
│   ├── academic-year.ts      ← getCurrentAcademicYear / requireCurrentAyCode
│   └── sync/                 ← students planner, snapshot loader, normalizers
├── components/grading/       ← score-entry-grid, lock-toggle, totals-editor, use-approval-reference (shadcn Dialog hook replacing window.prompt), ...
├── components/admin/         ← teacher-assignments-panel, publish-window-panel, publication-status
├── components/admissions/    ← pipeline-cards, funnel/by-level/assessment/referral charts, outdated table, ay-switcher
├── components/report-card/   ← report-card-document (shared render, print CSS)
├── components/ui/            ← shadcn primitives (button/card/table/field/form/select/tabs/dropdown-menu/sheet/dialog/alert-dialog/sonner/popover/calendar/...) + DateTimePicker wrapper + PageShell layout wrapper
├── components/{app,parent}-sidebar.tsx
├── supabase/
│   ├── migrations/           ← 001_initial_schema → 009_change_requests
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
RESEND_FROM_EMAIL=                 # optional, defaults to "HFSE Markbook <noreply@hfse.edu.sg>"
```

Original plan had separate `ADMISSIONS_SUPABASE_*` vars; dropped because admissions and grading share one Supabase project. `lib/supabase/admissions.ts` reuses `createServiceClient()`.

## Key decisions

1. **Single Supabase project** for grading + admissions tables.
2. **Roles in `app_metadata.role`** (`teacher | registrar | admin | superadmin`). No `user_roles` table.
3. **Teacher assignments** in `teacher_assignments` table: `(user × section × subject × role)` where role is `form_adviser` (one per section) or `subject_teacher` (one per section × subject). Gates `/api/grading-sheets` list and `PUT /api/sections/[id]/comments`.
4. **Weights per `(subject × level × AY)`** in `subject_configs`. Primary 40/40/20, Secondary 30/50/20. Never hardcoded.
5. **Max 5 WW + 5 PT slots per sheet** (`subject_configs.ww_max_slots / pt_max_slots`).
6. **Max 50 students per section.**
7. **Overall annual grade** = `T1×0.20 + T2×0.20 + T3×0.20 + T4×0.40`, rounded 2dp. See `lib/compute/annual.ts`.
8. **PDF generation deferred** — browser print covers current volume.
9. **RLS tightened** via `supabase/migrations/004_tighten_rls.sql` (JWT role gate + deny-writes on authenticated role + grade_audit_log registrar-only) and `005_rls_teacher_scoping.sql` (per-teacher row scoping on grade/student tables). Apply both before production UAT.
10. **Comprehensive audit log** in `006_audit_log.sql` (`public.audit_log` — generic `{actor, action, entity_type, entity_id, context}` rows) written from every mutating API route via `lib/audit/log-action.ts`. Historical `grade_audit_log` kept intact; the `/admin/audit-log` page unions both. Hard Rule #6 still applies.
11. **Report card publication windows** in `007_report_card_publications.sql` — per-section, per-term `(publish_from, publish_until)` gates the parent view. Registrar publishes via `/report-cards` list page. See `docs/context/10-parent-portal.md`.
12. **Parents are null-role Supabase Auth users** in the shared project. `getUserRole()` returns `null` for them; `proxy.ts` routes null-role users to `/parent/*` only. Parent↔student linkage lives in admissions `ay{YY}_enrolment_applications` (`motherEmail`/`fatherEmail`) — resolved via `getStudentsByParentEmail()` in `lib/supabase/admissions.ts`.
13. **Parent portal SSO handoff** via URL fragment at `/parent/enter`. Parents sign in once at `https://enrol.hfse.edu.sg`, click "View report card" there, arrive at the markbook with `#access_token=&refresh_token=&next=` in the URL; client-side `supabase.auth.setSession()` establishes the markbook session without a second login. See `docs/context/10-parent-portal.md` for the integration snippet.
14. **Dynamic academic year** via `lib/academic-year.ts::getCurrentAcademicYear()` — reads `academic_years WHERE is_current=true`. Never hardcode `'AY2026'` in runtime code; admissions table prefixes (`ay{YY}_enrolment_*`) are derived from the current AY code so rolling to AY2027 is a DB flag flip, not a code change.
15. **Aurora Vault palette** — core shadcn semantic tokens in `app/globals.css` `:root` are remapped to the Aurora Vault hex palette (navy `#0B1120`, indigo `#4F46E5`, ink ramp `#0F172A`→`#94A3B8`, hairline `#E2E8F0`). Raw values use the `--av-*` prefix to avoid self-reference cycles with `@theme inline`. All shadcn semantic utilities (`bg-primary`, `text-foreground`, `border-border`, `bg-card`) and explicit Aurora Vault utilities (`bg-brand-indigo`, `text-ink`, `border-hairline`) render identically — use either. Full token table and page→component matrix in `docs/context/09-design-system.md`.
16. **`@tanstack/react-table` is the canonical data-table engine** for filterable/sortable/paginated lists. Reference implementation: `app/(dashboard)/grading/grading-data-table.tsx` (dashboard-01 toolbar pattern with global search, faceted level filter, column visibility, status tabs, pagination). New data tables start from there, not from a bare `<Table>` wrapper.
17. **Parent notifications via Resend** — `lib/notifications/email-parents-publication.ts` is called from `POST /api/report-card-publications` and is idempotent via the `report_card_publications.notified_at` column (`008_publication_notified_at.sql`). Best-effort: failures log but never fail the publication. Silently no-ops when `RESEND_API_KEY` / `NEXT_PUBLIC_PARENT_PORTAL_URL` are unset, so local dev works without the dep.
18. **Admissions dashboard is read-only** — Sprint 7 Part A. All queries live in `lib/admissions/dashboard.ts`, wrapped in `unstable_cache` (10-min TTL, tag `admissions-dashboard:${ayCode}`), hitting `ay{YY}_enrolment_applications` × `ay{YY}_enrolment_status` via the service-role client. Hero lives at `/admin/admissions`; the high-signal widgets (pipeline cards + outdated table) are also inlined on the root `/` dashboard for privileged roles so there's one landing page. Outdated-row staleness uses `applicationUpdatedDate ?? created_at` as a fallback because the admissions team never stamps `*UpdatedDate` columns in practice. Superadmin-only CSV export at `/api/admissions/export`. Part B (SharePoint inquiries) remains blocked on HFSE credentials.
19. **Single dashboard for everyone** — `/admin` index redirects to `/`. Teachers see school stats + grading/report-card quick links; registrar/admin/superadmin additionally see the admissions pipeline snapshot, stale-applications table, and inline admin tools grid. Nested admin routes (`/admin/admissions`, `/admin/sections`, `/admin/sync-students`, `/admin/audit-log`) are unaffected.
20. **Forms: RHF + zod + shadcn `Form`** — every submit-based form (`login`, `change-password`, `manual-add-student`, `new-sheet`) uses `useForm` with `zodResolver`, a schema from `lib/schemas/`, and `<FormField>`/`<FormMessage>` for per-field errors. Autosave grids (`score-entry-grid`, `letter-grade-grid`, `comments-grid`, `attendance-grid`), the slot-array editor (`totals-editor`), the inline-edit publish panel, and select-only admin panels stay on raw state — RHF's submit lifecycle is a bad fit for per-cell autosave. Schemas live outside `app/` and `components/` so API routes can import them later.
21. **Feedback: toasts + dialogs, never `window.*` and never inline error alerts** — all action feedback goes through `toast.success`/`toast.error` (sonner). Destructive confirmations use shadcn `AlertDialog`; locked-sheet approval-reference prompts use shadcn `Dialog` via the shared `components/grading/use-approval-reference.tsx` hook (returns a promise-based `requireApproval()` + the dialog JSX to mount). The only remaining inline `<Alert>` is the empty-state notice in `teacher-assignments-panel.tsx` (persistent informational content, not transient feedback). Native `window.alert` / `window.confirm` / `window.prompt` are banned.
22. **Three Supabase clients, strict separation.** `createClient()` from `lib/supabase/server.ts` is the default for server components and API route reads — cookie-scoped, RLS-enforced. `createServiceClient()` from `lib/supabase/service.ts` bypasses RLS and is reserved for (a) mutating API routes that write past row-level scoping, (b) school-wide read aggregations where RLS would leak per-user shapes (dashboard stats, admissions analytics), and (c) server-only helpers like `lib/notifications/email-parents-publication.ts`. `createClient()` from `lib/supabase/client.ts` (browser) is rarely used — the only current legitimate caller is `/parent/enter` for the SSO session handoff. Client components should go through API routes, not talk to Supabase directly.
23. **API route request validation is manual, not zod (yet).** Current shape across every `app/api/**/route.ts`: `const body = await request.json().catch(() => null)` → inline null/required/shape checks → return `NextResponse.json({ error }, { status: 400 })` on failure. Zod schemas in `lib/schemas/` are used by RHF forms only. This is a deliberate deferral — Key Decision #20 notes schemas "can be imported later" by API routes. When a future route is complex enough to justify it, import the schema from `lib/schemas/` and use `schema.safeParse(body)` rather than bolting on a new convention. Until then, match the existing manual pattern.
24. **Client mutations: raw `fetch` + `toast.error`, no React Query.** Client components mutate via `fetch(url, { method, body })` → `if (!res.ok) throw` → `catch(e) { toast.error(e.message) }`. Reference: `components/grading/totals-editor.tsx`. The one reserved candidate for `@tanstack/react-query` is the grading grid autosave — see `docs/context/11-performance-patterns.md` §4. Everywhere else, follow the raw-`fetch` pattern and do not introduce React Query as a general dependency.
25. **Locked-sheet edits go through a structured change-request workflow, not free-text approval strings.** Sprint 9, migration `009_change_requests.sql`. Teachers file a `grade_change_requests` row (RHF form in `app/(dashboard)/grading/[id]/request-edit-button.tsx`) with target field + proposed value + reason category + justification ≥20 chars. Admin+ approve/reject at `/admin/change-requests`. Registrar applies the approved request (Path A) or logs a structured data-entry correction (Path B) via a branched dialog in `components/grading/use-approval-reference.tsx`. The entry PATCH route now rejects any `approval_reference` in the body and instead requires `change_request_id` or `correction_reason`; the server re-validates the typed value against the approved proposal and derives the `approval_reference` string itself. Hard Rule #5 still holds (every post-lock mutation writes an `approval_reference` to `grade_audit_log`) — only the client contract changed. Notification emails flow through `lib/notifications/email-change-request.ts` (Resend, best-effort).
26. **Dates: ISO 8601 UTC in storage and transit, display-layer local.** Timestamps flow as UTC ISO strings end-to-end (Postgres `timestamptz`, API JSON, server component props). Display conversion to Singapore local happens at render time via `new Date(iso).toLocaleString('en-SG')`. No `dayjs` / `date-fns` / `moment` is imported anywhere — don't add one. Publication windows (`publish_from` / `publish_until`) and audit timestamps follow the same rule. When adding new timestamp fields, keep them UTC in the DB and let the UI format them.

## Workflow

1. Read `docs/sprints/development-plan.md` for current sprint + status snapshot.
2. Build against the sprint's Definition of Done. Don't ship anything that breaks a hard rule above.
3. Verify with `npx next build` (clean compile required) and a manual happy-path test in the browser before marking anything done.
4. After meaningful work, run **`/sync-docs`** to keep this file and the dev plan accurate. The slash command surveys the repo, diffs against both docs, and applies targeted edits.
