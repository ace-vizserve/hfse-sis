<!-- Topic file for `.claude/rules/key-decisions.md`. Numbering is global; do not renumber. -->

## Platform — auth, roles, Supabase, AY plumbing, conventions

### KD #1

Single Supabase project for grading + admissions.

### KD #2

Roles in `app_metadata.role` (`teacher | registrar | school_admin | superadmin | p-file | admissions`); no `user_roles` table. `p-file` is module-scoped; `school_admin` is the consolidated cross-cutting generalist (Sprint 33 — old `admin` retired, see KD #39). HFSE staff fall into one of: teacher (subject + form-class advisers), registrar (Joann), school_admin (office staff including IT-equivalent + executive viewers + the former admin tier), superadmin (system config break-glass), p-file (renewals officer), admissions (funnel team).

### KD #8

RLS tightened: JWT role gate + deny-writes on `authenticated` + per-teacher row scoping (migrations 004, 005).

### KD #9

Generic `audit_log` (migration 006); every mutating route logs via `lib/audit/log-action.ts`. **Per-module audit-log pages** (Sprint 38+): all 7 modules now have dedicated `/<module>/audit-log` pages using an explicit `.in('action', allowlist)` filter — never a `.like(...)` wildcard (allowlists prevent cross-module row leakage). Performance indexes added in migration 052a: `(action, created_at desc)`, `(actor_email, created_at desc)`, `(entity_id, created_at desc) WHERE entity_id IS NOT NULL`, `(entity_type, created_at desc)`.

### KD #13

Dynamic AY via `lib/academic-year.ts`; never hardcode `'AY2026'`. AY codes are single calendar years (`^AY[0-9]{4}$`): AY2026 = January–November 2026, NOT a 2025–2026 split. Display labels follow the same convention (`"Academic Year 2026"`). HFSE's term rhythm is Jan–Nov per calendar year; AY-prefixed admissions tables (`ay{YYYY}_*` per KD #53) and seed/wizard copy align to this.

### KD #16

Email via Resend is best-effort; no-op without `RESEND_API_KEY`; idempotent via DB flags (e.g. `report_card_publications.notified_at`).

### KD #22

Three Supabase clients, strict separation: server (cookie-scoped, RLS-enforced), service (bypass, server-only), browser (rare — only `/parent/enter`).

### KD #23

Request validation is mixed: manual for simple mutations, zod `safeParse` for complex (every SIS PATCH). Don't migrate existing routes for uniformity.

### KD #29

Dev email redirect: outside production, all Resend emails rewrite `to` to a static dev address.

### KD #32

Dates: ISO 8601 UTC in storage/transit; local formatting at render via `toLocaleString('en-SG')`. No `dayjs`/`date-fns`/`moment`.

**SGT calendar-date rule (2026-06-03).** School-calendar values — term windows, attendance dates, `enrollment_date`/`withdrawal_date` — are date-only **Singapore** (UTC+8) dates. Computing "today" as `new Date().toISOString().slice(0, 10)` takes the **UTC** calendar date, which is the _previous_ day during the 00:00–07:59 SGT window — so comparing a UTC "today" against an SGT term window mis-resolves the term at a boundary (e.g. a 7am-SGT enrolment on a term's first day reads as the prior break), and a UTC-sliced display date shows one day off. **Canonical helpers live in `lib/dates.ts`: `sgToday()` (SGT `yyyy-MM-dd`) and `sgDate(iso)` (SGT date of a UTC timestamp).** Use them anywhere a "today" or timestamp→date value is **compared against, or stored as, a school-calendar date** — never raw `.toISOString().slice(0,10)`. Storage/transit timestamps stay full UTC ISO (the rule above is unchanged). Adopted across the term resolver (`getEnrolmentPosition`), section-transfer term-of-date, enrollment/withdrawal date stamps (stage + section-students + sync routes), the attendance writer's today gate, the attendance current-term pages, and the movements feed. `lib/evaluation/ptc-resolver.ts::sgToday` re-exports from `lib/dates` for back-compat. **Deliberately not changed** (cosmetic / not calendar-boundary): dashboard date-range defaults, p-files expiry comparisons, and the seeders.

### KD #33

Module switcher visible to `school_admin`/`admin`/`superadmin`/`registrar`; teachers + `p-file` users locked. `currentModule` type includes `null` for neutral pages.

### KD #35

Server-component auth uses `getSessionUser()` (local JWT via `getClaims()`), not `getUser()`. API routes still use `requireRole()`. `11-performance-patterns.md` §1.

### KD #38

This is an SIS; modules are surfaces, not apps. Cross-module links resolve via `studentNumber` (Hard Rule #4). New per-student domains become another tab, not a silo.

### KD #39

`admin` role retired in Sprint 33; `school_admin` is the consolidated cross-cutting generalist. Migration 039 flips live `admin` users to `school_admin` and refreshes `is_registrar_or_above()` to include `school_admin`. Grade-change approver pool is `school_admin`-only (`listEligibleApproverCandidates` filters on `role === 'school_admin'`); `superadmin` is excluded because they manage approver assignments at `/sis/admin/approvers` but don't act on requests themselves. School_admin gained access to the previously-superadmin-only `/sis/admin/*` config sub-routes (users, settings, template, subjects, school-config, evaluation-checklists, approvers); superadmin retains access as break-glass + IT. HFSE mapping post-merge: Chandana+Tin = `school_admin` (was `admin`); office staff = `school_admin`; Joann = `registrar`; Amier+CEO = `superadmin`.

### KD #41

Approvers are per-flow + designated (`approver_assignments`, migration 013). Teacher picks primary + secondary; only those two see the request. Eligible pool = `school_admin` (KD #39); `superadmin` is excluded.

### KD #42

Records at `/records/*`; SIS Admin at `/sis/*`. Internal identifiers (`lib/sis/*`, `sis.*` audit prefix, `sis:${ayCode}` cache tag) stay.

### KD #43

Markbook at `/markbook/*`; `/` is a neutral peer-module picker. Tile picker scoped via `isRouteAllowed()` so each role only sees modules they can open. Forced redirects only when the picker would be useless: `null` → `/parent`, `p-file` → `/p-files`, `admissions` → `/admissions`. Everyone else lands on the picker.

### KD #52

Test environment = AY9999 + Environment switcher (`/sis/admin/settings`, superadmin only). `POST /api/sis/admin/environment` flips `is_current` to a test AY (`ay_code ~ '^AY9'`); first-time switch creates the AY + seeds structure + 200 `TEST-%` students + populated data. `DELETE` runs the destructive cascade + `delete_academic_year` RPC. All seeders are idempotent. `lib/sis/{environment,seeder}/*` owns the flow. `<TestModeBanner>` shows when `ay_code ~ '^AY9'`. **Sprint 37 additions:** (1) `POST /api/sis/admin/environment/topup` re-runs `seedPopulated` against the current test AY without wiping anything — every internal step is idempotent (skip-guards on natural keys), so this safely patches an existing test AY with new seeder code (e.g. when adding a new demo-extras pass). Surfaces as a mint **Top-up demo data** panel in `<EnvironmentCard>` (visible only when on Test); toast lists the inserted counts. Audit-logged as `environment.topup`. (2) When ≥2 non-test AYs exist (e.g. `AY2025` historical / `AY2026` current ops / `AY2027` early-bird per KD #77), the Production tile renders a `<Select>` so the user picks which AY becomes current. `EnvironmentSwitchSchema` accepts optional `ay_code`; `switchEnvironment` validates against the actual prodAys list and refuses test-AY codes under the production target. Falls back to legacy default-pick when only one prod AY exists.

### KD #53

AY admissions tables use 4-digit slugs: `ay{YYYY}_*` (migration 026). Validators on `create_ay_admissions_tables` / `drop_ay_admissions_tables` are `^ay[0-9]{4}$`; `create_academic_year` / `delete_academic_year` compute `'ay' || substring(v_code from 3)`. Read-side helpers all inline `ay${ayCode.replace(/^AY/i, '').toLowerCase()}` — copy this pattern when adding a new call site.

### KD #58

Single shared `<ModuleSidebar>` primitive. All per-module sidebars collapse into one `components/module-sidebar.tsx` consumed by every module layout. Module identity moves into the sidebar header as a `Popover` switcher; the topbar `<ModuleSwitcher>` is removed (a leaner `<TopbarModuleSwitcher>` survives only on the neutral `/` + `/account` shells). Active item adopts §9.3 non-flat (gradient wash + ring-inset, no left bar). Footer is a single profile pill that opens a popover for Account + Sign out. Generalized realtime-badge slot via `lib/sidebar/use-realtime-badges.ts`. Per-role quick action declarative in `lib/sidebar/registry.ts::SIDEBAR_REGISTRY[module].quickActionByRole`. **Toast shim:** `sonner` removed from `package.json`, `sileo` added; `tsconfig.json::compilerOptions.paths` rewires `'sonner'` → `components/ui/sonner.tsx`, a sonner-shaped facade over `sileo`. Call sites still `import { toast } from 'sonner'`.

### KD #87

User provisioning at `/sis/admin/users` is **direct-create only** — the magic-link invite flow was removed in Sprint 37. `POST /api/sis/admin/users` takes `{ email, role, displayName?, password }` and calls `auth.admin.createUser({ ..., email_confirm: true, app_metadata: { role }, user_metadata: { display_name } })` atomically. Account is active immediately; user signs in at `/login` with the superadmin-set password and can change it from `/account`. Audit-logged as `user.create` (the `user.invite` AuditAction enum entry is retained for back-compat with historical rows but no code emits it anymore). **Why invite was dropped:** there's no dedicated password-setup landing page in this app — `inviteUserByEmail` would sign the invitee in once via the callback at `/api/auth/callback` but leave them unable to reauthenticate from `/login` (which is `signInWithPassword`-only). The dialog at `<InviteUserDialog>` includes a 16-char password generator that avoids visually-confusable glyphs (no 0/O/1/l/I) and copies to clipboard. **Re-enabling invite later** requires: (1) a dedicated `/auth/setup?token=...` page that calls `supabase.auth.updateUser({ password })`, (2) passing `redirectTo: ${origin}/auth/setup` on `inviteUserByEmail`, (3) bringing back the schema's discriminated union + the dialog's mode-tabs.

### KD #121

Audit-log readability — humanizer + name preference (Sprint 54, 2026-06-05). Every audit-log surface previously rendered the raw `context` jsonb (`JSON.stringify`) + raw action codes — illegible to non-IT admins. New **`lib/audit/humanize.ts`** (pure, client-safe, unit-tested) is the single source of truth: `auditActionLabel(action)` (plain-English label for all ~112 `AuditAction`s; unknown codes prettified, never leaked), `auditActionTone(action)` → `default | info | warning | destructive`, and `auditContextSummary(action, context)` (concise ` · `-separated one-liner — per-action templates + a 4-tier generic fallback over the 3 common context shapes; reuses the `lib/schemas/*` enum label maps; **relabels identifier keys** `studentNumber`→"Student no." / `enroleeNumber`→"Application no.", and **prefers the student NAME when the context carries one**, suppressing the paired number; skips `id`/`*_id`/UUID noise; **never emits JSON or `{`/`}`**, empty→"—"). Both audit-table components — the shared markbook one (markbook/evaluation/admissions/records/p-files/sis) + the attendance one — render via the humanizer; the per-table `ActionDetails`/`ContextSummary` switches (incl. the `JSON.stringify` fallback) + local label maps were deleted; the action-badge variant derives from the tone. Companion **plain-English UI-copy sweep** replaced raw `studentNumber`/`enroleeNumber` + dev jargon (`encodable`, `UPSERT`, internal route paths, "grading-side") in user-facing prose (attendance tab, admissions search helper, records hero, template manager, allowance error toasts) — code identifiers + legitimate ID-value displays untouched. Cross-ref KD #9 (generic `audit_log` + per-module pages) + KD #84 (unified data-table). No schema change.
