# Parent Portal Integration

Reference for how the HFSE SIS integrates with the existing HFSE parent portal. Read this before touching anything under `app/(parent)/`, `lib/supabase/admissions.ts`, or the `report_card_publications` migration.

## The parent portal is a separate codebase

The HFSE parent portal (where parents enrol, add, review, edit, and update their student applications) is a **separate Next.js project** maintained outside this repo. It shares the same Supabase project with the HFSE SIS — which is how the SIS reaches parent data without parents needing a second account.

This repo has **no code for** enrolment, application editing, document upload, or any other parent-portal feature. The SIS only serves report cards to parents and relies on the parent portal to do everything else.

## Shared Supabase project

Both systems point at the same Supabase project. The grading schema tables (`academic_years`, `terms`, `levels`, `subjects`, `students`, `section_students`, `grading_sheets`, `grade_entries`, `grade_audit_log`, `evaluation_writeups`, `attendance_records`, `teacher_assignments`, `audit_log`, `report_card_publications`) live in `public` and are owned by this repo's migrations.

The **admissions tables** that the parent portal owns live in the same Supabase project but are managed by the parent portal's own migrations. The SIS reads from them as a foreign schema would — we never `ALTER`, `INSERT`, `UPDATE`, or `DELETE` any admissions row from this repo.

## Parent identity: no role = parent

Both systems authenticate against the **same `auth.users` table**.

- **Staff** (teacher / registrar / admin / superadmin) have their role set in `app_metadata.role` via `getUserRole()` in `lib/auth/roles.ts`.
- **Parents** have **no** `app_metadata.role`. A signed-in user with a null role is treated as a parent.

This is enforced in two layers:

1. **`proxy.ts`** — treats `/parent/*` as fully cookie-gated by the HMAC-signed `parent_session` cookie (KD #65); skips Supabase claim checks inside `/parent`. Null-role users *outside* `/parent` get bounced to `/login`. The `(parent-handoff)` route group (`/parent/enter`) is the one bypass for the HMAC gate so the handoff itself can land.
2. **`app/(parent)/layout.tsx`** — verifies the `parent_session` cookie. If invalid: real staff (`role !== null`) → `/`; **everyone else** (anonymous OR null-role Supabase JWT leftover from pre-KD-#65 `setSession` flow) → `NEXT_PUBLIC_PARENT_PORTAL_URL`. Never bounces parents to `/` or `/login` (KD #73).

Never add `'parent'` to the `Role` type — it would break this heuristic and require schema-level role storage that neither system needs. KD #11's "parents = null-role Supabase users" pattern is **deprecated for fresh logins** (KD #73) but still tolerated as fallback identity.

## Parent → student linkage: via admissions emails

The link between a parent Supabase account and a student is **implicit** via email match against the admissions tables:

- A parent signs in with, say, `jane.smith@example.com`
- `lib/supabase/admissions.ts::getStudentsByParentEmail()` queries `ay{YY}_enrolment_applications` with `.or('motherEmail.eq.jane.smith@example.com,fatherEmail.eq.jane.smith@example.com')`
- Every matching row is a child linked to this parent for the given academic year
- The child's `studentNumber` from admissions is then resolved to a `students.id` in the grading schema via `students.student_number`

**This means the parent's account email must exactly match an entry in `motherEmail` or `fatherEmail` in admissions.** There is no manual link table. If a parent wants to update their email, they do it in the parent portal (which writes back to `ay{YY}_enrolment_applications`), and the SIS picks up the new email on their next login.

**`fatherEmail` may be null** in admissions — the `.or(...)` query handles this correctly.

## Admissions tables the SIS reads

Three admissions tables live in the shared Supabase project under `public.ay{YY}_enrolment_*`. The parent portal owns the DDL; the SIS only SELECTs from them via the service-role client. **Never INSERT / UPDATE / DELETE these tables from this repo** — the parent portal is the source of truth.

**The `{YY}` prefix is resolved dynamically**, not hardcoded. Every call site that needs to query admissions first reads the current academic year via `lib/academic-year.ts::getCurrentAcademicYear()` (or `requireCurrentAyCode()`), which returns the `ay_code` of the row in `public.academic_years` where `is_current = true`. That `ay_code` is then passed to `fetchAdmissionsRoster()` / `getStudentsByParentEmail()` and normalized to a table name prefix (e.g. `"AY2026"` → `ay2026_enrolment_applications`). When Joann flips the current-AY flag to `AY2027`, the admissions queries switch automatically with no code change, **on the assumption that the parent portal has created `ay2027_enrolment_*` tables with the same column shape as the DDL documented at the bottom of this file**.

The real DDL is at the bottom of this doc under [§ Reference DDL](#reference-ddl). The subsections below list only the columns this repo actually reads, so you can see at a glance which parts of the admissions schema are load-bearing for the SIS.

### `ay{YY}_enrolment_applications` — one row per enrolee

Used by: `lib/supabase/admissions.ts::fetchAdmissionsRoster()`, `getStudentsByParentEmail()`, `lib/sync/students.ts`.

| Column | Type | Nullable | Used for |
|---|---|---|---|
| `enroleeNumber` | `text` | yes | Join key to `ay{YY}_enrolment_status` |
| `studentNumber` | `text` | yes | Stable cross-year student ID (Hard Rule #4). `null` means the registrar hasn't assigned one yet — that row is skipped by the sync. |
| `lastName`, `firstName`, `middleName` | `text` | yes | Name sync into `public.students` |
| `motherEmail` | `text` | yes | Parent auth lookup (**case-insensitive** — the SIS matches with `.ilike`) |
| `fatherEmail` | `text` | yes | Parent auth lookup (same) |
| `applicationStatus` | `text` | yes | **Parent-portal-side** — tracks the application *form* submission state, not the enrollment pipeline. Production value seen: `"Registered"` (set when parent finishes the form). `"Draft"` is presumed for in-progress rows but unconfirmed. **Do not use this for enrollment filtering** — that lives on `ay{YY}_enrolment_status.applicationStatus`. The two columns share a name but have completely disjoint value spaces; see `06-admissions-integration.md` § The two `applicationStatus` columns. |
| `category` | `varchar` | yes | One of `New` / `Current` / `VizSchool New` / `VizSchool Current`. Mirrors `enrolment_status.enroleeType`. |
| `stpApplicationType` | `text` | yes | Gates the 3 STP-conditional document slots (`icaPhoto`, `financialSupportDocs`, `vaccinationInformation`). HFSE is now Edutrust Certified, so the school can sponsor Singapore Student Pass applications via ICA on behalf of foreign students. See `21-stp-application.md` for the full workflow. |

Columns the SIS does **not** currently read (but which exist on the table and may be useful later): `guardianEmail`, `levelApplied`, structured medical flags (`allergies`, `asthma`, `foodAllergies`, `heartConditions`, `epilepsy`, `diabetes`, `eczema`, etc.), all `father*` / `mother*` / `guardian*` personal data beyond email, sibling tracking columns (`siblingFullName1..5` etc.), `residenceHistory` (jsonb — used by the STP workflow), consent flags (`socialMediaConsent`, `feedbackConsent`, `*WhatsappTeamsConsent`), pre-course + feedback workflow columns (`preCourseAnswer`, `preCourseDate`, `feedbackRating`, `feedbackComments`, etc.), `vizSchoolProgram`, `enroleePhoto`, `creatorUid`. The full reference DDL lives at `10a-parent-portal-ddl.md`.

> **`passCodeStudent` is legacy and should be ignored.** It was the parent-portal's pre-account auth mechanism (parents entered a per-student code to view their application back when there were no `auth.users` rows for them). Supabase Auth accounts superseded it. The SIS should **not** use `passCodeStudent` for anything, and new features shouldn't revive it as a fallback — if email matching ever proves unreliable, fix it at the account/email level, not by resurrecting a deprecated code.

### `ay{YY}_enrolment_status` — workflow state per enrolee

Used by: `fetchAdmissionsRoster()`, `getStudentsByParentEmail()`.

| Column | Type | Nullable | Used for |
|---|---|---|---|
| `enroleeNumber` | `text` | yes | Join to applications |
| `classLevel` | `character varying` | yes | Section level label in **word form** (e.g. `"Primary One"`, `"Secondary Three"`, `"Cambridge Secondary One (Year 8)"`, `"Youngstarters \| Little Stars"`). Migration 029 aligned both sides on word form, so admissions and SIS now agree on the canonical label; `lib/sync/level-normalizer.ts` is retained as a defensive fallback that still accepts legacy digit input (`"Primary 1"`) and known typos, normalizing them to the current word form. |
| `classSection` | `character varying` | yes | Section name (e.g. `"Patience"`). **Primary liveness signal** — `classSection IS NOT NULL` filters to currently-enrolled students. May contain typos; normalized by `lib/sync/section-normalizer.ts`. |
| `classAY` | `character varying` | yes | AY code (e.g. `"AY2026"`) |
| `applicationStatus` | `character varying` | yes | **SIS-side workflow pipeline.** One of `Submitted` / `Ongoing Verification` / `Processing` / `Enrolled` / `Enrolled (Conditional)` / `Cancelled` / `Withdrawn` (canonical list in `lib/schemas/sis.ts:STAGE_STATUS_OPTIONS.application`). Filter — rows where this is `"Cancelled"` or `"Withdrawn"` are excluded from sync. **Not the same column as `ay{YY}_enrolment_applications.applicationStatus`** — see `06-admissions-integration.md` § The two `applicationStatus` columns. |
| `enroleeType` | `character varying` | yes | One of `New` / `Current` / `VizSchool New` / `VizSchool Current`. Mirrors `enrolment_applications.category`. The discount-codes catalogue stores a 6-value superset that adds `Both` and `VizSchool Both`. |

Columns the SIS does **not** read but that exist: `registrationStatus`, `documentStatus`, `assessmentStatus`, `assessmentGradeMath`, `assessmentGradeEnglish`, `contractStatus`, `feeStatus`, `suppliesStatus`, `orientationStatus`, all their `Remarks`/`UpdatedDate`/`Updatedby` siblings. These drive the admissions dashboard (Sprint 7 Part A) but are out of scope for the SIS proper.

### `ay{YY}_enrolment_documents` — per-enrolee document upload state

Used by the parent portal for document upload tracking, and by the SIS's P-Files + Records modules for staff-side validation + history. The full canonical slot list (16 slots) is in `12-p-files-module.md` § Required Documents Per Student. The status workflow distinction (expiring vs non-expiring slots have different value spaces) is documented there too.

Notable columns: `form12`, `medical`, `passport`, `birthCert`, `educCert`, `idPicture`, `icaPhoto`, `financialSupportDocs`, `vaccinationInformation` — each paired with a `*Status` column (e.g. `form12Status`). The 3 STP-conditional slots (`icaPhoto`, `financialSupportDocs`, `vaccinationInformation`) are gated on `enrolment_applications.stpApplicationType`; see `21-stp-application.md`.

## RLS consequences

The parent portal operates on admissions tables that live outside this repo's RLS domain. This repo's migrations 004/005 gate the **grading** tables; they do not touch admissions.

- `report_card_publications` has a **parent-read RLS policy** (`rcp_parent_read`) that allows any null-role authenticated user to SELECT all rows. The real gate is at the application layer: `app/(parent)/parent/page.tsx` and `app/(parent)/parent/report-cards/[studentId]/page.tsx` verify parent↔student via `getStudentsByParentEmail()` before fetching anything.
- Every query for grading data inside the parent route group uses the **service-role client** (`createServiceClient()`) because parents' cookie-bound clients cannot read `students`, `section_students`, `grading_sheets`, or `grade_entries` under migration 005.

Never change this to "parents read directly via RLS." The parent↔student relationship lives in admissions, which Postgres RLS policies in this repo cannot see. Keeping the gate in application code is the only workable option.

## What the parent flow actually does, step-by-step

1. Parent signs in at the parent portal (`https://enrol.hfse.edu.sg/`) — that's their existing, primary auth point.
2. From the authenticated parent dashboard (`/admission/dashboard`), the parent clicks "View report card". The parent-portal code reads `supabase.auth.getSession()` and navigates the browser to `https://<sis>/parent/enter#access_token=…&refresh_token=…&next=/parent/...` (see [§ Parent portal → SIS handoff](#parent-portal--sis-handoff) below for the integration snippet).
3. The SIS's `/parent/enter` client page reads the URL fragment, POSTs the tokens to `/api/parent/handoff`. The handoff route verifies the inbound `access_token` via the service client (without `setSession`) and sets the HMAC-signed `parent_session` cookie scoped to the SIS (2h TTL, KD #65). Parent never sees a login screen on the SIS side. The Supabase session cookies are **not** written — that was the pre-KD-#65 behavior and clobbered staff sessions in shared browsers.
4. Post-handoff, `router.replace(next)` redirects to `/parent` or directly to `/parent/report-cards/{studentId}`. `proxy.ts` sees the valid `parent_session` cookie and admits the request to `/parent/*`.
5. `/parent` calls `getStudentsByParentEmail(user.email, currentAy.ay_code)` to look up children in `ay{YY}_enrolment_applications` where `motherEmail` or `fatherEmail` matches (case-insensitive). Cross-AY visibility: `getAllStudentsByParentEmail` walks every `academic_years` row and dedupes by `student_number`.
6. For each admissions row, the server resolves `studentNumber` → grading `students.id` via the service-role client.
7. For each student, the server finds their current-AY `section_students` enrolment and any `report_card_publications` on that section.
8. Per term, the server computes whether each publication is `active` / `scheduled` / `expired` based on `publish_from` / `publish_until` vs `now()`.
9. The page renders one card per child with a "View report card" link per active publication.
10. Clicking the link goes to `/parent/report-cards/{studentId}`, which re-runs the parent→student verification and re-checks the publication window, then renders the shared `<ReportCardDocument>` via `buildReportCard()`.
11. Parent presses `Ctrl+P` to print / save as PDF — the print CSS in `components/report-card/report-card-document.tsx` produces the same paper layout the staff view uses.

The SIS's own `/login` route still exists as a fallback (staff use it for sign-in; a parent could technically use it too if they ever arrive at the SIS without going through the handoff), but the intended parent entry point is always the "View report card" button on the parent portal.

## Parent portal → SIS handoff

The handoff mechanism that lets parents cross from `enrol.hfse.edu.sg` into the SIS without a second sign-in, based on Path B of the design discussion (token-in-URL-fragment).

### Why it exists

Parent accounts live in the shared Supabase project's `auth.users`. The parent portal and the SIS are separate codebases on **different origins**, which means their Supabase Auth session cookies are not shared. Without a handoff mechanism, a parent who signed in at the parent portal would face a second login screen on the SIS — same credentials, different cookie jar, bad UX. The handoff lets us hand over the signed-in session cleanly.

### How it works (canonical — KD #65, since Sprint 28)

1. **Parent portal builds a URL** with the parent's current Supabase session tokens in the **URL fragment** (the part after `#`):
   ```
   https://<sis-domain>/parent/enter#access_token=<jwt>&refresh_token=<jwt>&next=/parent/report-cards/<studentId>
   ```
2. **Browser navigates** to the SIS. The URL fragment is **not sent to any server** — it stays in the browser, so the tokens never appear in the SIS's access logs, the parent-portal's `Referer` header, or any intermediate proxy. `/parent/enter` lives in its own `(parent-handoff)` route group so `proxy.ts` can bypass the `parent_session` cookie gate just for this endpoint without making the rest of `/parent` permissive.
3. **The SIS's `/parent/enter` client page** reads `window.location.hash` on mount, parses `access_token` / `refresh_token` / `next`, and POSTs them to `/api/parent/handoff`. The handoff route verifies the `access_token` via the service client (no `setSession` — that's what KD #12 did and clobbered staff sessions in shared browsers) and sets a separate HMAC-signed `parent_session` cookie scoped to the SIS, 2h TTL. Signing key is `PARENT_HANDOFF_SECRET` (≥32 chars per `lib/parent/cookie.ts`), MUST differ per environment; rotating invalidates all live parent sessions.
4. **`router.replace(next)`** navigates to the target path. The URL fragment drops from history, and `proxy.ts` on the next hop sees the valid `parent_session` cookie → parent routing kicks in → the report card renders.
5. **Sign-out** is a parent-only path: `<SidebarProfile>` (in the sidebar-less parent layout, KD #73) branches on role — parents call `/api/parent/exit` (clears the cookie) + `window.location` to the portal, so a co-resident staff Supabase session is untouched. `<ParentSessionWatcher>` also clears the cookie via `navigator.sendBeacon` on `pagehide`.

### Why this design (vs the prior `setSession` flow)

The previous KD #12 flow called `supabase.auth.setSession()` on the SIS browser client, which wrote the standard `sb-*-auth-token` cookies. In a shared browser where a staff member was also signed in to the SIS, those writes clobbered the staff session — staff would discover they'd been silently logged out (or worse, granted parent-scoped null-role access on their next request) when the parent visited their machine. The HMAC parallel-cookie design isolates the parent session from the staff Supabase session: the two cookies have different names, different sign keys, and different scopes.

### Security

- The fragment is origin-local to the browser — it's not in Referer (browsers strip fragments), not in access logs, not in redirect chains.
- The `next` parameter is validated to start with `/parent` — anything else falls back to `/parent`. No open redirect.
- Tokens are never logged, sent to telemetry, or passed through `fetch` to anything other than the same-origin `/api/parent/handoff`. The handoff route does **not** call `setSession`; it only verifies the JWT against the Supabase service client and mints the parallel signed cookie.
- If the access token is expired, the handoff returns an error and the `/parent/enter` page renders a "Back to parent portal" button pointing at `NEXT_PUBLIC_PARENT_PORTAL_URL`.
- The real authorization gate is still `getStudentsByParentEmail()` (Sprint 28 update: `getAllStudentsByParentEmail` walks every AY) in the parent-scoped pages — an attacker with stolen tokens can still only see children linked to that parent's email. The handoff does not widen the blast radius.
- The HMAC cookie is signed (not encrypted); its body is `{ email, exp, sub }` — enough to look up the parent. Tampering invalidates the signature.

### Environment variables

Both sides of the handoff need **per-environment** env vars — the staging parent portal talks to the SIS's staging/preview deployment, and the production parent portal talks to the SIS's production. Vercel (and most platforms) support different env var values per environment on the same project, so you set each variable multiple times, once per environment, without touching the code.

#### Markbook — `PARENT_HANDOFF_SECRET`

Server-only HMAC signing key for the `parent_session` cookie (KD #65). ≥32 chars (`openssl rand -hex 32`). MUST differ per environment. Rotating invalidates all live parent sessions; nobody currently signed in via the SIS will retain access until they re-handoff from the parent portal.

| Vercel environment | Notes |
|---|---|
| **Production** | Generate a fresh secret per environment; never share with non-production. |
| **Preview** | Distinct from production. |
| **Development** (local `.env.local`) | Distinct again; rotating doesn't break anyone. |

#### Markbook — `NEXT_PUBLIC_PARENT_PORTAL_URL`

Used by `/parent/enter` as the "Back to parent portal" button destination when the handoff fails, **and** by `app/(parent)/layout.tsx` as the redirect target when an anonymous or null-role JWT visitor lands on `/parent/*` without a valid `parent_session` cookie (KD #73). Read on every request, so changing it takes effect on the next page load — no redeploy needed.

| Vercel environment | Value |
|---|---|
| **Production** | `https://enrol.hfse.edu.sg/admission/dashboard` |
| **Preview** | `https://online-admission-staging.vercel.app/admission/dashboard` |
| **Development** (local `.env.local`) | `https://online-admission-staging.vercel.app/admission/dashboard` (or whatever parent-portal instance you develop against) |

Configure all three at **Vercel → your SIS project → Settings → Environment Variables**. Select the environment scope for each value individually; don't paste one value into "All Environments" or staging will point at production by accident.

#### Parent portal — `NEXT_PUBLIC_MARKBOOK_HANDOFF_URL`

Used by the `<ViewReportCardButton>` snippet as the handoff URL. The parent-portal team sets this in **their** Vercel project, not the SIS's.

| Vercel environment | Value |
|---|---|
| **Production** | `https://<sis-production-domain>/parent/enter` |
| **Preview** | `https://<sis-staging-or-preview-domain>/parent/enter` |
| **Development** | `https://<sis-staging-or-preview-domain>/parent/enter` |

If there is only one SIS deployment today, both Production and Preview point at the same URL — that's fine, the SIS accepts handoffs from any origin (no origin checks were added this sprint). When a dedicated staging SIS exists later, bump the Preview value to point at it.

#### Why per-environment matters

Shipping the button to production parent portal with a staging SIS URL (or vice versa) leaks staging data into a production UX or breaks the handoff entirely. Treat both URLs as environment-scoped from day one — you avoid the "works on staging, breaks on production, I swear I tested it" class of bug.

### Integration snippet for the parent-portal team

Drop this component into the parent-portal repo (e.g. at `components/ViewReportCardButton.tsx`) and render it from the authenticated dashboard at `/admission/dashboard`. It assumes the parent portal already exposes a Supabase browser client via `@/lib/supabase/client` (or equivalent) — adapt the import path if yours differs.

```tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Markbook handoff URL. MUST be configured per-environment in Vercel
// (Production, Preview, Development) so staging parent portal points at
// the staging SIS and production points at production. Do NOT ship
// without setting NEXT_PUBLIC_MARKBOOK_HANDOFF_URL in your parent-portal
// Vercel project's environment variables.
//
// The fallback literal below is defensive only — it's the value the
// snippet reaches for if the env var is somehow missing at runtime, and
// it should match your default/staging SIS URL, not production.
const MARKBOOK_HANDOFF_URL =
  process.env.NEXT_PUBLIC_MARKBOOK_HANDOFF_URL ??
  'https://hfse-markbook.vercel.app/parent/enter';

type Props = {
  /**
   * Optional deep-link. **Leave this undefined in normal usage** — the
   * parent lands on the SIS's "My children" page, which already
   * lists every child linked to their email plus every currently-
   * published report card per child. That landing page is the intended
   * parent experience.
   *
   * Only set `studentId` if you have a reason to skip the list view and
   * jump straight to one specific report card. It must be the SIS's
   * `public.students.id` UUID, which the parent portal doesn't have
   * natively — you'd need to resolve it from `studentNumber` first.
   * For that reason, deep-linking is more trouble than it's worth on the
   * parent portal side; use the no-arg form unless you have a specific
   * need.
   */
  studentId?: string;
  className?: string;
  children?: React.ReactNode;
};

export function ViewReportCardButton({ studentId, className, children }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) {
        setError('Your session has expired. Please sign in again.');
        setLoading(false);
        return;
      }

      const next = studentId
        ? `/parent/report-cards/${studentId}`
        : '/parent';

      const fragment = new URLSearchParams({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        next,
      }).toString();

      // Full browser navigation (not router.push) so the target origin
      // reads the fragment fresh on page load.
      window.location.href = `${MARKBOOK_HANDOFF_URL}#${fragment}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to open report card');
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={go} disabled={loading} className={className}>
        {children ?? (loading ? 'Loading…' : 'View report card')}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
```

**Usage on the authenticated parent dashboard — recommended:**

Render **one button** somewhere on `/admission/dashboard`. Don't pass `studentId`. The parent lands on the SIS's `/parent` page, which shows every child linked to their email plus every currently-published report card per child, with proper empty states for children whose report cards haven't been published yet. This is the default experience and works cleanly for parents with one child or multiple children.

```tsx
// Anywhere under /admission/dashboard
<ViewReportCardButton>View report cards</ViewReportCardButton>
```

That's it. No prop plumbing, no student ID lookup, no per-child loop. The SIS's landing page does the list-all-children rendering for you.

**Deep-link variant — not recommended, listed for completeness:**

If you ever want to skip the SIS's list view and jump straight into one child's report card, pass `studentId`. The catch: the value must be the SIS's `public.students.id` UUID, which the parent portal doesn't have directly — it has `studentNumber` from admissions. Resolving one to the other would require either an SIS API lookup or a direct query into `public.students` on the shared Supabase project. For this reason, deep-linking is usually more work than it's worth — stick with the no-arg form above.

```tsx
// Only if you have the SIS UUID and really want to skip /parent
<ViewReportCardButton studentId={markbookStudentUuid}>
  View {child.firstName}&apos;s report card
</ViewReportCardButton>
```

### Troubleshooting

- **"This handoff link is missing its session tokens"** — the URL fragment is empty or malformed. Check that the parent-portal snippet is constructing the URL correctly with `#` (not `?`) and that both `access_token` and `refresh_token` are present.
- **"Your session has expired"** — the refresh token is no longer valid. The parent needs to sign in fresh on the parent portal, then click the button again.
- **Parent lands on the SIS's `/login` instead of `/parent/enter`** — `/parent/enter` should be living in the `(parent-handoff)` route group so `proxy.ts` bypasses the `parent_session` cookie gate just for the handoff endpoint (KD #65). Verify the route is in the right group and that `proxy.ts`'s `/parent/*` cookie-gate carve-out still covers it.
- **Parent's SIS session got logged out unexpectedly when a colleague used the same browser** — almost certainly a regression to the pre-KD-#65 `setSession` flow (parent writes clobbered staff `sb-*` cookies). Verify the handoff still POSTs to `/api/parent/handoff` rather than calling `setSession` directly.
- **Handoff succeeds but parent sees "no students linked to this email"** — the parent portal's `motherEmail`/`fatherEmail` on the admissions row doesn't match their `auth.users.email`. The SIS does a case-insensitive match (`.ilike`), but a genuine email mismatch (typo, different provider) will show an empty state. Fix at the admissions side.

## Out of scope

- **Parent self-service**: no enrolment, no application editing, no document upload, no profile edit in this repo. Parents do all of that in the parent portal.
- **Email notifications**: when the registrar publishes a window, parents are not emailed. They navigate to the URL on their own. Wiring Resend / SMTP / WhatsApp is a future sprint.
- **Cross-AY history**: replaced Sprint 28 — parents now see published cards across every AY their child was enrolled in (`getAllStudentsByParentEmail`). Publication-window per KD #28 is the actual gate, not current AY.
- **Account linking UI**: parents cannot "add another child" from within the SIS — the link is purely via email in admissions.

---

## Historical: pre-Sprint-28 `setSession` flow (KD #12, deprecated)

> Archive only. The flow described here is **not the current implementation** — it was replaced by KD #65 in Sprint 28. Kept here so future readers can recognize the shape of the legacy mechanism if they encounter it in older branches, prior PRs, or someone else's mental model.

The pre-KD-#65 handoff used the parent's Supabase session tokens directly:

1. Parent portal built the same fragment URL as today.
2. The SIS's `/parent/enter` client page called `supabase.auth.setSession({ access_token, refresh_token })` from the URL fragment. The `@supabase/ssr` browser client wrote the standard `sb-*-auth-token` cookies via its cookie adapter.
3. `proxy.ts` then saw a cookie-bound Supabase session with `role === null` and routed it to `/parent/*`.

### Why it was replaced

In a shared browser where staff were also signed in to the SIS, the parent's `setSession` write clobbered the staff member's `sb-*-auth-token` cookies — staff would discover they'd been silently logged out (or worse, attributed null-role parent identity) on their next request. The HMAC parallel-cookie design (KD #65) isolates the parent session from the staff Supabase session.

The legacy flow also bounced edge cases (anonymous visitors, stale null-role JWTs leftover from `setSession`) into the SIS module picker on `/`. KD #73 closes that gap separately.

KD #12 itself is the canonical history pointer for the deprecated mechanism; KD #65 is the canonical replacement. KD #11 ("parents = null-role Supabase users") is **deprecated for fresh logins** but tolerated as fallback identity.

---

## Reference DDL

See [`10a-parent-portal-ddl.md`](./10a-parent-portal-ddl.md) — the frozen admissions-table column definitions are split out for length.
