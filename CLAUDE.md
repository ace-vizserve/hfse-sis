# HFSE SIS — Claude Instructions

A Student Information System for HFSE International School, Singapore. Modules — Markbook, Attendance, Evaluation, P-Files, Records, Admissions, SIS Admin — are surfaces of one student record, not sibling apps. The module switcher moves between them; `studentNumber` is the backbone.

## Stable rules — auto-loaded (every session)

**Everything inside `.claude/rules/` is read into context automatically, every session.** That is a Claude Code behaviour, not something a file can opt out of — a `load: on-demand` line in a file's frontmatter is descriptive only and does not stop it loading. So only four files live there, deliberately:

@.claude/rules/always-do-first.md
@.claude/rules/hard-rules.md

- `.claude/rules/design-system.md` — binding design pointer; too important to risk missing (it is small, and only points at the full docs).
- `.claude/rules/key-decisions.md` — the KD index, so a "KD #N" cite resolves with no extra read.

Do not edit any of the four without explicit user approval, and **do not add new files to `.claude/rules/`** — anything put there is paid for in every session. On-demand material goes in `docs/` (below).

## Stable rules — on-demand (read with the Read tool when relevant)

These live **outside** `.claude/rules/`, so they cost nothing until read. Read before acting when any of the "Read when..." conditions apply.

| Rule                           | Read when...                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/rules/tech-stack.md`     | Touching code, installing/upgrading a dep, debugging a framework behavior, or a Next.js 16 gotcha                                                                                                                                                      |
| `docs/rules/project-layout.md` | Creating new files, moving code between modules, or deciding where a new route or lib lives                                                                                                                                                            |
| `docs/rules/env-vars.md`       | Touching `.env.local`, Supabase/auth plumbing, or Resend emails                                                                                                                                                                                        |
| `docs/rules/workflow.md`       | Finishing work — before reporting a task done, or at session wrap-up                                                                                                                                                                                   |
| `docs/key-decisions/*.md`      | A "KD #N" reference appears in code or docs; cross-cutting architectural choices; doubt about module boundaries, roles, or conventions. Find the topic file via the always-loaded index at `.claude/rules/key-decisions.md`, then Read only that file. |

## Reference docs

| Doc                                         | Read when...                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `docs/sprints/development-plan.md`          | Starting any task — status snapshot + current sprint                                                                             |
| `docs/context/01-project-overview.md`       | Onboarding                                                                                                                       |
| `docs/context/02-grading-system.md`         | Grade computation / formula                                                                                                      |
| `docs/context/03-workflow-and-roles.md`     | Permissions, locking, workflow                                                                                                   |
| `docs/context/04-database-schema.md`        | DB tables / queries                                                                                                              |
| `docs/context/05-report-card.md`            | Report card UI / PDF                                                                                                             |
| `docs/context/06-admissions-integration.md` | Admissions sync                                                                                                                  |
| `docs/context/admission-process.md`         | HFSE's 13-step intake process (Open House → Orientation); maps ~1:1 to the 9-stage SIS pipeline (`STAGE_KEYS`, KD #51/#59)       |
| `docs/context/07-api-routes.md`             | API contracts                                                                                                                    |
| `docs/context/08-admission-dashboard.md`    | Admissions analytics                                                                                                             |
| `docs/context/09-design-system.md`          | UI tokens, hard rules, page→component matrix, pre-delivery checklist                                                             |
| `docs/context/09a-design-patterns.md`       | Craft standard, canonical patterns, semantic color discipline                                                                    |
| `docs/context/10-parent-portal.md`          | Parent identity, linkage, SSO handoff                                                                                            |
| `docs/context/10a-parent-portal-ddl.md`     | Frozen admissions DDL (AY-prefixed tables)                                                                                       |
| `docs/context/11-performance-patterns.md`   | Any new page — auth/cache/parallel/loading checklist                                                                             |
| `docs/context/12-p-files-module.md`         | P-Files module — document types, statuses, architecture                                                                          |
| `docs/context/13-sis-module.md`             | Records module                                                                                                                   |
| `docs/context/14-modules-overview.md`       | Cross-module architecture, shared identity, navigation                                                                           |
| `docs/context/15-markbook-module.md`        | Markbook module scope                                                                                                            |
| `docs/context/16-attendance-module.md`      | Attendance module (Phase 1 + 1.1 shipped)                                                                                        |
| `docs/context/17-process-flow.md`           | Cross-module lifecycle + soft gates                                                                                              |
| `docs/context/18-ay-setup.md`               | Superadmin AY-rollover wizard                                                                                                    |
| `docs/context/19-evaluation-module.md`      | Student Evaluation module — FCA writeups + virtue theme (KD #49)                                                                 |
| `docs/context/20-dashboards.md`             | Any dashboard work — before touching a module's landing page or `lib/<module>/dashboard.ts`                                      |
| `docs/context/21-stp-application.md`        | Singapore ICA Student Pass workflow (HFSE Edutrust Certified) — `stpApplicationType` gating + STP-conditional doc slots (KD #61) |
| `docs/context/23-session-log.md`            | Session history before the current sprint — shipped work, closed decisions, superseded claims, and the gotchas they left behind  |

## Session context

✅ **A USER'S ROLES ARE A LIST NOW, AND `active_role` NAMES THE ONE IN FORCE — 2026-09-03, migrations 141 + 142 both APPLIED, browser-verified. Full account: KD #206.** Mr Ace: _"a user can have two roles"_, _"role will be an array then they will have active_role object identifier"_, _"just a simple page reload then voila"_. `app_metadata.role = ['school_admin','teacher']`, `app_metadata.active_role = 'teacher'`. **There is still exactly ONE role in force at any moment**, so `ROUTE_ACCESS`, `requireRole`, `requireCapability`, every per-role view and all ~34 RLS policies are UNTOUCHED — the database reaches the claim through one function (`current_user_role()`) and the app through one (`getRoleFromClaims`), so each side moved in a single place.

⚠ **THREE THINGS THAT WILL BITE.** (1) **`current_user_role()` REFUSES to read an array, deliberately** — `->> 'role'` on a list returns the literal text `["school_admin","teacher"]`, not null, so a naive fallback hands that back as the role and the account silently resolves to a non-role, which this app reads as **PARENT**. Migration 142 guards the fallback with `jsonb_typeof(...) = 'string'`. **Granting a list without setting `active_role` in the same statement is a LOCKOUT.** (2) **`getClaims()` verifies the JWT LOCALLY and does not re-mint it** — updating `app_metadata` never reaches a session already in flight, so the switch MUST call `supabase.auth.refreshSession()` and navigate only once it resolves. **It is the only `refreshSession()` call in the repo.** The same fact is why granting someone a second role shows them nothing until they sign out and back in — that cost an hour of "I can't see the switcher". (3) **A teaching assignment REQUIRES the teacher role** (_"teaching assignment cant be done unless youre a teacher role"_), so `getTeacherList()` is the only list and its filter is just `roles.includes('teacher')`. **Role = what you may do; assignment = which classes.** Granting is SIS Admin → Staff → Accounts, where **the Roles cell IS the control** (checkbox menu, superadmin only, blocked on your own row).

🔴 **A WHOLE DESIGN WAS BUILT AND DELETED, AND THE CAUSE WAS NOT TECHNICAL.** The first implementation kept one role per account, inferred teacher-ness from `teacher_assignments`, and threaded a second variable (`activeRole`) through ~30 files so rendering could change while permissions stayed on the admin role. It shipped as 8 reviewed commits and it was the wrong model; Mr Ace rejected it four times before it was heard. **Asked whether switching should change WHAT SHE SEES or WHAT SHE CAN DO, he chose "what she sees" — and that choice was presented as a RISK trade with no price attached. It is the difference between ~1 file and ~30. PRICE THE OPTIONS, NOT JUST THEIR RISKS.** His verdict on the session: _"its a simple task"_, and he was right. All of that plumbing — `lib/auth/active-role.ts`, `view-context.ts`, `in-app-path.ts`, `components/view-switch/`, `wrong-view-notice.tsx`, `getAssignableStaffList` and a dozen guard tests — is now deleted.

⚠ **FOUR FIXES SURVIVED THAT DETOUR AND ARE WORTH MORE THAN THE FEATURE.** (1) A shared `stripComments` treated `/**` inside a `//` comment as a block opener and **deleted 538 lines across 29 files before guard tests could scan them** — which any guard asserting ABSENCE reads as a PASS. Fixed in `__tests__/_utils/strip-comments.ts`, which now reports its terminal mode. ⚠ An apostrophe in ordinary JSX prose desyncs it too. (2) **`link-capability-consistency.test.ts` is blind to ~a third of the app's role guards** (41 modelled, 32 ignored) — it models `role !== 'x'` chains and cannot see `ALLOWED_ROLES.has(...)` or `||`. NOT widened; needs its own pass. (3) `isRouteAllowed` **default-allows an unmatched pathname**, and a nav href carrying `?query` matches no prefix, so 11 rows sailed through; enforcement was never affected (`proxy.ts` passes a clean pathname). One `hrefPathname` now, was five copies. (4) 🔴 **Two Cmd+K dead ends were live for EVERY real teacher**, and a teacher-only name lookup meant **the four form classes with a `school_admin` adviser showed NO ADVISER AT ALL** across six surfaces — because a name lookup built on a narrow list refuses nothing, it silently renders a blank. Guarded by `__tests__/sis/name-lookups-include-disabled.test.ts`.

⚠ **OPEN.** Only two accounts hold a list today (`kohsuat.hoon@`, `ace.guevarra@`); the other four teaching admins need the role granted before they see the switcher. The audit log records `actor_role` (migration 141, required on `logAction` so the compiler finds all 112 sites) and logs each switch as `user.view.switch`.

**Older entries have moved.** Everything before the current sprint now lives in `docs/context/23-session-log.md` — shipped features, closed decisions, superseded claims, and the gotchas they left behind. Read it when you pick up a quiet module, meet a reference you do not recognise, or are about to reopen something that may already have been measured and closed.

## Cross-reference note

Cross-references elsewhere in the repo such as "CLAUDE.md Hard Rule #N" or "CLAUDE.md KD #N" now resolve to `.claude/rules/hard-rules.md` and `.claude/rules/key-decisions.md` respectively. Numbering is preserved across all moves. KDs were split into per-topic files under `docs/key-decisions/` (the root file is the index + KD-to-topic map); existing "KD #N" cites still resolve via the index, and global numbering is unchanged.

Historical plan and spec docs under `docs/superpowers/` cite the older `.claude/rules/key-decisions/<topic>.md` paths. Those are archival records of past work and were deliberately left as-written — read them as "the topic file for that KD", which now lives under `docs/key-decisions/`.
