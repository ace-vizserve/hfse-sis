# HFSE SIS — Claude Instructions

A Student Information System for HFSE International School, Singapore. Modules — Markbook, Attendance, P-Files, Records, SIS Admin — are surfaces of one student record, not sibling apps. The module switcher moves between them; `studentNumber` is the backbone.

## Stable rules — auto-loaded (every session)

These two are `@`-imported so they're always in context. Do not edit without explicit user approval.

@.claude/rules/always-do-first.md
@.claude/rules/hard-rules.md

## Stable rules — on-demand (read with the Read tool when relevant)

Not `@`-imported. Each file carries YAML frontmatter (`description`, `load: on-demand`) explaining its trigger. Read before acting when any of the "Read when..." conditions apply.

| Rule | Read when... |
| --- | --- |
| `.claude/rules/tech-stack.md` | Touching code, installing/upgrading a dep, debugging a framework behavior, or a Next.js 16 gotcha |
| `.claude/rules/project-layout.md` | Creating new files, moving code between modules, or deciding where a new route or lib lives |
| `.claude/rules/env-vars.md` | Touching `.env.local`, Supabase/auth plumbing, or Resend emails |
| `.claude/rules/key-decisions.md` | A "KD #N" reference appears in code or docs; cross-cutting architectural choices; doubt about module boundaries, roles, or conventions |
| `.claude/rules/design-system.md` | Before any UI / frontend code; when choosing a shadcn primitive, token, color, or layout |
| `.claude/rules/workflow.md` | Finishing work — before reporting a task done, or at session wrap-up |

## Reference docs

| Doc | Read when... |
| --- | --- |
| `docs/sprints/development-plan.md` | Starting any task — status snapshot + current sprint |
| `docs/context/01-project-overview.md` | Onboarding |
| `docs/context/02-grading-system.md` | Grade computation / formula |
| `docs/context/03-workflow-and-roles.md` | Permissions, locking, workflow |
| `docs/context/04-database-schema.md` | DB tables / queries |
| `docs/context/05-report-card.md` | Report card UI / PDF |
| `docs/context/06-admissions-integration.md` | Admissions sync |
| `docs/context/07-api-routes.md` | API contracts |
| `docs/context/08-admission-dashboard.md` | Admissions analytics |
| `docs/context/09-design-system.md` | UI tokens, hard rules, page→component matrix, pre-delivery checklist |
| `docs/context/09a-design-patterns.md` | Craft standard, canonical patterns, semantic color discipline |
| `docs/context/10-parent-portal.md` | Parent identity, linkage, SSO handoff |
| `docs/context/10a-parent-portal-ddl.md` | Frozen admissions DDL (AY-prefixed tables) |
| `docs/context/11-performance-patterns.md` | Any new page — auth/cache/parallel/loading checklist |
| `docs/context/12-p-files-module.md` | P-Files module — document types, statuses, architecture |
| `docs/context/13-sis-module.md` | Records module |
| `docs/context/14-modules-overview.md` | Cross-module architecture, shared identity, navigation |
| `docs/context/15-markbook-module.md` | Markbook module scope |
| `docs/context/16-attendance-module.md` | Attendance module (Phase 1 + 1.1 shipped) |
| `docs/context/17-process-flow.md` | Cross-module lifecycle + soft gates |
| `docs/context/18-ay-setup.md` | Superadmin AY-rollover wizard |
| `docs/context/19-evaluation-module.md` | Student Evaluation module — FCA writeups + virtue theme (KD #49) |
| `docs/context/20-dashboards.md` | Any dashboard work — before touching a module's landing page or `lib/<module>/dashboard.ts` |
| `docs/context/21-stp-application.md` | Singapore ICA Student Pass workflow (HFSE Edutrust Certified) — `stpApplicationType` gating + STP-conditional doc slots (KD #61) |

## Session context

<!--
Scratch surface for session-learned context, temporary caveats, in-flight
investigations. Safe to edit; pruned periodically. Stable rules do NOT go
here — they live in `.claude/rules/*.md`.
-->

- **Forty-first pass — role-aware audit closures + parent surface dedicated-page treatment + publishing checklist quick-links + grading list curated dropdowns, uncommitted on `main` 2026-05-03**. Three new KDs (#73 parent surface sidebar-less + never-bounce-to-/, #74 page-level role differentiation, #75 publishing checklist as navigation hub) plus migrations 035 + 036. **(1) Role audit closures** (KD #74): closed all 5 gaps surfaced by the role-aware audit. **P-Files** `/p-files` + `/p-files/[enroleeNumber]` page-level role check fixed to admit `school_admin` (was a real bug — gate-allowed in `ROUTE_ACCESS:441` but blocked at the page); new `isOfficer = role === 'p-file' || role === 'superadmin'` gates `<PriorityPanel>` + `<DocumentChaseQueueStrip>` + bulk-notify in focused-status views, hero copy reframed for oversight. Detail page eyebrow flips to "Read-only oversight" when `canWrite=false`. **Records** `/records` new `isOperational = role === 'registrar'` gates the chase strip + "Documents to collect" `ActionList` + `<ClassAssignmentReadinessCard>`. **Admissions** `/admissions` new `isOperational = role === 'admissions' || role === 'registrar'` gates `<NewApplicationsPriority>` + chase strip + chase priority + chaseInsights (oversight roles keep KPIs). **SIS Admin** `/sis` hero copy branches by tier (school_admin / admin / superadmin); Access + System sections (Approvers / School Config / Users / Settings, all superadmin-only) **hidden entirely** for non-superadmin instead of greyed-out. **Sidebar prose** (`lib/auth/roles.ts::PFILES_NAV`): "Expiring soon" quicklinks gated to `['p-file', 'superadmin']` (officer-only — bulk-remind launching pads); "Document validation" expanded to include `school_admin`. Audit summary persisted at `~/.claude/plans/hmmm-im-thinking-cause-kind-crystal.md`. **(2) Parent surface stripped** (KD #73): `app/(parent)/layout.tsx` rewritten — `<ModuleSidebar>` + `<SidebarProvider>` + `<SidebarInset>` removed; replaced with thin `print:hidden` top header (HFSE identity tile + signed-in email + "Back to parent portal" button). Fixed staff-fallback redirect: when `parent_session` is invalid, real staff (`role !== null`) → `/`, **everyone else** (anonymous OR null-role JWT leftover from pre-KD-#65 setSession flow) → `NEXT_PUBLIC_PARENT_PORTAL_URL` — closes the path where stale null-role JWTs landed parents on `/login` then bounced via the proxy to `/` showing the SIS module picker. New `app/(parent)/parent-signout-button.tsx` client component (formerly "Sign out" → "Back to parent portal", `ArrowLeft` icon; behavior identical, framing shifted from "log out" to "navigate back"). "Parent Portal" eyebrow + "Secure Parent Portal" footer dropped from `/parent` page. **(3) Parent empty states polished**: `/parent` distinguishes 3 sub-cases when no children have active publications — `allScheduled` (amber `Clock`, "Coming soon — available from <date>"), `allExpired` (amber `CalendarX`, "Window has ended — was available until <date>"), `revoked-or-never` (destructive `ShieldOff`, "No report cards to view"). New `<EmptyStateCard>` helper with gradient icon tile + serif title + mono eyebrow. `/parent/report-cards/[studentId]` parallel treatment via new `<UnavailableState>` helper — handles `expired` / `scheduled` / `revoked` / generic variants; replaces 2 prior raw-text fallbacks (`no_current_ay` red div + `not_enrolled_this_ay` muted div). Both surfaces include a back-to-/parent button. **(4) `/markbook/grading` curated dropdowns** (extends 40th pass teacher combobox): Teacher dropdown options sourced server-side from `lib/auth/staff-list.ts::getTeacherList()` distinct subject_teacher user_ids → display names (independent of other filters' state); fixes the email-label + shrinking-dropdown problems from prior pass. New Form Adviser `<FacetDropdown>` + `form_adviser` column (hidden by default via `columnVisibility`). New "My sheets" toggle button — gated to `role === 'teacher'` (registrars + admins manage every section, no useful narrowing). URL persistence wired via `useSearchParams` + `router.replace` for all 8 dimensions (`q` debounced 300ms · `status` · `level` · `subject` · `term` · `teacher` · `adviser` · `mine`). Page extended `teacher_assignments` query to fetch BOTH `subject_teacher` + `form_adviser` roles in one round-trip. Active-filter chip strip extended with Form adviser + Mine chips. **(5) Publishing checklist redesign** (KD #75): `components/admin/publish-window-panel.tsx` `<AlertDialog>` rebuilt — new `<ChecklistRow>` helper (status-tinted gradient icon tile, mint→sky for passed, amber for warning) per check; per-row deep-link button routes registrar straight into the relevant module to fix the issue. Quick-link map: grading sheets → `/markbook/grading?section={sectionId}`; adviser comments → `/evaluation/sections/{sectionId}`; attendance → `/attendance/{sectionId}`; T4 unlocked terms + missing quarterly grades → `/markbook/grading?section={sectionId}`. T4 sub-section behind centered horizontal-rule divider with mono eyebrow. Dialog widened `max-w-xl!` → `max-w-2xl!`. **(6) Migrations 035 + 036**: `035_grade_entries_unique.sql` adds unique constraint on `grade_entries(grading_sheet_id, section_student_id)` so the seed RPC's UPSERT is idempotent; `036_seed_grade_entries.sql` ships `seed_grade_entries_for_sheets(sheet_ids[])` + extended `create_grading_sheets_for_ay` self-heal step that pre-sizes ww/pt arrays to the sheet's `ww_max_slots`/`pt_max_slots` so newly-generated sheets land with the canonical WW (w1–w5) + PT (p1–p5) shape and full enrollment seeding, instead of `'{}'` empty-array totals + missing entry rows. Closes the "generated sheets but grading grid is empty" bug. Build clean throughout.
- **Fortieth pass — records-detail rebuild + admissions table funnel filter + teacher combobox, uncommitted on `main` 2026-05-01**. **(1) `<StudentDataTable>` `statusBuckets` prop**: hardcoded `StatusBucket` literal + `statusBucket()` function replaced with a data-only `StatusBucketDef` type (server-component-safe). New `statusBuckets?: StatusBucketDef[]` prop with `DEFAULT_STATUS_BUCKETS` (records-shape: All/Enrolled/Pipeline/Withdrawn). `/admissions/applications` passes `APPLICATIONS_STATUS_BUCKETS` (All/Submitted/Ongoing Verification/Processing). **(2) `/records/students/[studentNumber]` major rebuild**: 5-tab structure (Overview · Family & care · Placements · Academic · Lifecycle) with `?tab=` URL param; header + 3 stat cards + `QuickActionsStrip` always-visible above tabs. Five new RSC sections: QuickActionsStrip (3 CTA link cards), PostEnrolmentChecklist (8 stages with left-edge stripe color-keyed off `<StageStatusBadge>`), FamilyContactCard (mother/father/guardian with `size-10` indigo→navy role tile), ServicePreferencesCard (3 service tiles + 3 BillingTiles), MedicalCard (gradient blocked Badge condition flags + tinted DetailRow). **(3) Per-tab navigation linkification**: `lib/sis/records-history.ts::PlacementRow` gains `sectionId`. New `<AyLink>` helper deep-links AY references to `/admissions/applications/[enroleeNumber]?ay=...&tab=enrollment`. **(4) Card-header canonicalization**: new local `<ActionTile>` helper across all 5 tabs; Placement StatusBadge flipped from inline color shorthands to canonical `<Badge variant="success|warning|muted">`. **(5) `/markbook/grading/new` teacher combobox**: free-text `<Input>` for `teacher_name` replaced with Popover + Command (cmdk) combobox. New `lib/auth/staff-list.ts::getTeacherList()` (5-min cache, shared `'teacher-emails'` invalidation tag). Convention: **no free-text fallback for staff/teacher pickers — every staff member has an account**. **(6) Pending reconciliation**: `getTeacherList()` "exclude disabled" filter checks `app_metadata.disabled` but `/sis/admin/users` uses Supabase's `banned_until`; should switch to `banned_until > now()`. Also pending: prioritize teachers assigned to the selected section in the combobox via `teacher_assignments`. Build clean.
- **Thirty-ninth pass — full-day simulation-driven session, uncommitted on `main` 2026-04-30**. Six new KDs (#67 atomic section transfer, #68 late-enrollee term detection, #69 documents-stage parent-email-conditional gate, #70 admissions chase scope split, #71 P-Files renewal-only scope guard, #72 class-template subject CRUD). Highlights: section transfer via dedicated `POST /api/sis/students/[enroleeNumber]/transfer-section` route + `lib/sis/{section-transfer,section-history,terms}.ts`; late-enrollee `enrollment_date=today` boundary refresh; father/guardian doc slots conditionally skipped from documents-Verified gate when respective email is null; chase scope split (chase = To follow + Rejected + Expired vs validation = Uploaded); P-Files renewal-only scope (sidebar prune + `isStudentEnrolled` whitelist gate + dashboard prune); 3-tab class-template editor (Sections · Subjects · Subject weights). Companion fixes: `pickSectionForApplicant` levels word-form lookup (`eq('label', ...)` not `eq('code', ...)`); `'to-follow'` first-class DocumentStatus + `resolveStatus` source-of-truth rewrite; `freshenAyDocuments` revive direction (Expired+future-expiry → Valid). All application-layer; no migrations. Build clean.


## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved; only the host file moved.
