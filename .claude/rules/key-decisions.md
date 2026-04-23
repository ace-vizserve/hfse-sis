---
name: key-decisions
description: 45 numbered architectural and behavioral decisions (KD #1–#47, gaps at 19/26/30). Read whenever a "KD #N" reference is cited in code or docs, when making a cross-cutting architectural choice, or when in doubt about module boundaries, roles, or conventions.
load: on-demand
---

<!-- Stable rule. NOT auto-loaded. Read via the Read tool when relevant. Numbering is load-bearing; downstream docs cite "KD #N". Edit only with explicit user approval. -->

## Key decisions

1. **Single Supabase project** for grading + admissions.
2. **Roles in `app_metadata.role`** (`teacher | registrar | school_admin | admin | superadmin | p-file`); no `user_roles` table. `p-file` is module-scoped; `school_admin`/`admin` are P-Files read-only. See KD #39 for the `admin` vs `school_admin` split.
3. **Teacher assignments** in `teacher_assignments(user, section, subject, role)` — `form_adviser` or `subject_teacher`. Gates grading-sheets list + section comments.
4. **Weights per `(subject × level × AY)`** in `subject_configs`; Primary 40/40/20, Secondary 30/50/20; never hardcoded.
5. **Max 5 WW + 5 PT slots per sheet; max 50 students per section.**
6. **Annual grade** = `T1×0.20 + T2×0.20 + T3×0.20 + T4×0.40`, 2dp. `lib/compute/annual.ts`.
7. **PDF generation deferred** — browser print covers current volume.
8. **RLS tightened**: JWT role gate + deny-writes on `authenticated` + per-teacher row scoping (migrations 004, 005).
9. **Generic `audit_log`** (migration 006); every mutating route logs via `lib/audit/log-action.ts`. Module-split render: `pfile.*` rows only on `/p-files/audit-log`.
10. **Publication windows** per `(section, term)` gate parent view (migration 007).
11. **Parents = null-role Supabase users**; `proxy.ts` routes them to `/parent/*` only. Linkage via admissions `motherEmail`/`fatherEmail`.
12. **Parent SSO handoff** via URL fragment at `/parent/enter` — `supabase.auth.setSession()` from hash tokens. `10-parent-portal.md`.
13. **Dynamic AY** via `lib/academic-year.ts`; never hardcode `'AY2026'`.
14. **Aurora Vault palette** in `app/globals.css`; raw values use `--av-*` prefix. `09-design-system.md`.
15. **`@tanstack/react-table` canonical** for filterable/sortable lists. Reference: `grading-data-table.tsx`.
16. **Email via Resend is best-effort**; no-op without `RESEND_API_KEY`; idempotent via DB flags (e.g. `report_card_publications.notified_at`).
17. **Admissions analytics consolidated into `/records`**; `/admin*` redirects there. Superadmin-only CSV at `/api/admissions/export`. `08-admission-dashboard.md`.
18. **Admissions read-only dashboard helpers** in `lib/admissions/dashboard.ts` — `unstable_cache` 10-min TTL, tag `admissions-dashboard:${ayCode}`.
20. **Forms use RHF + zod + shadcn `Form`**; autosave grids stay on raw state. Schemas in `lib/schemas/`.
21. **Feedback = toasts + dialogs** via sonner; `window.alert/confirm/prompt` banned. Locked-sheet dialogs use `components/grading/use-approval-reference.tsx`.
22. **Three Supabase clients, strict separation**: server (cookie-scoped, RLS-enforced), service (bypass, server-only), browser (rare — only `/parent/enter`).
23. **Request validation is mixed**: manual for simple mutations, zod `safeParse` for complex (every SIS PATCH). Don't migrate existing routes for uniformity.
24. **Client mutations = raw `fetch` + `toast.error`; no React Query.** Reference: `components/grading/totals-editor.tsx`.
25. **Locked-sheet edits** go through `grade_change_requests` workflow (migration 009); server derives `approval_reference`, rejects free-text values.
27. **Report card has interim (T1–T3) and final (T4) templates.** `ReportCardDocument` takes `viewingTermNumber`. `lib/compute/annual.ts` + `05-report-card.md`.
28. **Pre-publish readiness is a soft gate**, not a hard block. Registrar can always "Publish anyway".
29. **Dev email redirect** — outside production, all Resend emails rewrite `to` to a static dev address.
31. **P-Files is a repository, not a review queue.** `p-file`+`superadmin` write, `school_admin`+`admin` read. Never sets `'Rejected'` (KD #37). `12-p-files-module.md`.
32. **Dates: ISO 8601 UTC in storage/transit; local formatting at render** via `toLocaleString('en-SG')`. No `dayjs`/`date-fns`/`moment`.
33. **Module switcher** visible to `school_admin`/`admin`/`superadmin`/`registrar`; teachers + `p-file` users locked. `currentModule` type includes `null` for neutral pages.
34. **P-Files upload** = dual-table write + multi-PDF merge (`pdf-merger-js`) + archive-on-replace snapshot. 10MB/file, 30MB/request. `12-p-files-module.md`.
35. **Server-component auth uses `getSessionUser()`** (local JWT via `getClaims()`), not `getUser()`. API routes still use `requireRole()`. `11-performance-patterns.md` §1.
36. **P-Files revision history is append-only** (migration 011). `GET /api/p-files/[enroleeNumber]/revisions`. Hard Rule #6 applies.
37. **Records module writes admissions data**; sole writer of `'Rejected'`. Zod schemas + per-field audit diff + `revalidateTag('sis:${ayCode}')`. Stable IDs rejected from schemas. `13-sis-module.md`.
38. **This is an SIS; modules are surfaces, not apps.** Cross-module links resolve via `studentNumber` (Hard Rule #4). New per-student domains become another tab, not a silo.
39. **`admin` vs `school_admin`** — only the grade-change approval pool differs. `school_admin` + `superadmin` excluded from `listEligibleApproverCandidates`. HFSE mapping: Chandana+Tin = `admin`; office staff = `school_admin`; Joann = `registrar`; Amier+CEO = `superadmin`.
40. **AY rollover is a DB flag flip** — `rpc('create_academic_year')` from `/sis/ay-setup`. Superadmin delete is emptiness-guarded. DDL source of truth: `10a-parent-portal-ddl.md`. `18-ay-setup.md`.
41. **Approvers are per-flow + designated** (`approver_assignments`, migration 013). Teacher picks primary + secondary; only those two see the request. `superadmin` + `school_admin` excluded per KD #39.
42. **Records at `/records/*`; SIS Admin at `/sis/*`.** Superadmin defaults to `/sis` on `/` redirect. Internal identifiers (`lib/sis/*`, `sis.*` audit prefix, `sis:${ayCode}` cache tag) stay.
43. **Markbook at `/markbook/*`; `/` is a neutral peer-module picker.** Role redirects: `teacher`→`/markbook`, `p-file`→`/p-files`, parent→`/parent`, superadmin→`/sis`; registrar/`school_admin`/`admin` see the picker.
44. **`DatePicker` + `DateTimePicker` are canonical** (`components/ui/date-{picker,time-picker}.tsx`). Native `<input type="date">` / `datetime-local` / `time` are banned outside the primitives themselves.
45. **One consolidated dashboard per module; no cross-module data leaks.** `/records` absorbs admissions analytics because Records *is* the operational admissions surface.
46. **Each data dashboard owns `lib/<module>/dashboard.ts`** (SIS also owns `health.ts`). Cache-wrapper pattern: hoist `load*Uncached`, compose `unstable_cache` per-call for dynamic tags. Consistent hero + trust-strip shape.
47. **Attendance is sole writer of daily attendance** (Phase 1+1.1 shipped 2026-04-21). Markbook/Records/Parent are read-only consumers. Audit prefix `attendance.*`. `16-attendance-module.md`.
48. **SIS Admin (`/sis/*`) is the central config surface; operational modules consume config, don't define it.** School Calendar, Sections, Discount Codes, and Teacher Assignments moved to `/sis/*` in the 2026-04-22 consolidation sprint. Operational modules (Attendance, Markbook, Records) keep cross-module sidebar links to the relevant SIS surface for workflow continuity.
49. **Evaluation module owns the form-class-adviser write-up** (sole source for T1–T3 report card FCA comments). `evaluation_writeups` is the source of truth, read by `lib/report-card/build-report-card.ts`. `terms.virtue_theme` (SIS Admin → AY Setup → Dates) drives the parenthetical: "Form Class Adviser's Comments (HFSE Virtues: …)". `/markbook/sections/[id]/comments` and `/markbook/grading/advisory/[id]/comments` redirect to the Evaluation equivalents. T4 is excluded (no comment section on the final card). Grades come from Markbook, attendance from Attendance; Evaluation writeups are the only thing flowing from this module to the report card. `report_card_comments` is legacy — historical rows copied into `evaluation_writeups` by migration 018; no new writes land there.
50. **School calendar has five day-types** (`school_day`, `public_holiday`, `school_holiday`, `hbl`, `no_class`) per `school_calendar.day_type` (migration 019). `school_day` + `hbl` are **encodable** — attendance grid accepts writes, rollup counts them in `school_days`. The other three reject writes (409 on `/api/attendance/daily`). `is_holiday` is legacy, derived via BEFORE trigger from `day_type` — prefer `day_type` in new code. "Important dates / special events" stay on `calendar_events` as an overlay layer (primary-dot on the grid), not a day-type.
51. **Admissions is its own module; Records is enrolled-only.** `/admissions/*` hosts the pre-enrolment funnel (Inquiry → Applied → Interviewed → Offered → Accepted), SharePoint inquiries, and the applicant-detail profile/family/docs tabs. `/records/*` lists only Enrolled / Conditional students and resolves cross-year history via `studentNumber` (Hard Rule #4) through `lib/sis/records-history.ts`. Dedicated `admissions` role added to `Role` union + `ROUTE_ACCESS`. Module switcher derives allowed modules from `ROUTE_ACCESS` — never hardcode the allowed list.
52. **Test environment = AY9999 + Environment switcher** (`/sis/admin/settings`, superadmin only). `POST /api/sis/admin/environment` flips `is_current` to a test AY (`ay_code ~ '^AY9'`); first-time switch creates AY9999 via `create_academic_year` + seeds structure (sections, subject_configs, terms with dates, school_calendar, school_config, grading_sheets) + 200 `TEST-%` students + populated data (grade entries, daily attendance + rollups, teacher_assignments, evaluation writeups, Enrolled admissions rows, pre-enrolment funnel, discount codes, publication window). `DELETE` runs the full destructive cascade + `delete_academic_year` RPC. All seeders are idempotent via skip-guards. `lib/sis/{environment,seeder}/*` owns the flow. `components/sis/test-mode-banner.tsx` shows when `ay_code` matches `^AY9`.
53. **AY admissions tables use 4-digit slugs: `ay{YYYY}_*`** (migration 026). Matches existing production `ay2026_*`. Validators on `create_ay_admissions_tables` / `drop_ay_admissions_tables` are `^ay[0-9]{4}$`; `create_academic_year` / `delete_academic_year` compute `'ay' || substring(v_code from 3)`. Read-side helpers (`lib/sis/queries.ts`, `lib/admissions/dashboard.ts`, `lib/p-files/*`, the `app/api/sis/students/*` routes) all inline `ay${ayCode.replace(/^AY/i, '').toLowerCase()}` — copy this pattern when adding a new call site.
