# Parent Portal Integration

Reference for how HFSE Markbook integrates with the existing HFSE parent portal. Read this before touching anything under `app/(parent)/`, `lib/supabase/admissions.ts`, or the `report_card_publications` migration.

## The parent portal is a separate codebase

The HFSE parent portal (where parents enrol, add, review, edit, and update their student applications) is a **separate Next.js project** maintained outside this repo. It shares the same Supabase project with the HFSE Markbook — which is how the markbook reaches parent data without parents needing a second account.

This repo has **no code for** enrolment, application editing, document upload, or any other parent-portal feature. The markbook only serves report cards to parents and relies on the parent portal to do everything else.

## Shared Supabase project

Both systems point at the same Supabase project. The grading schema tables (`academic_years`, `terms`, `levels`, `subjects`, `students`, `section_students`, `grading_sheets`, `grade_entries`, `grade_audit_log`, `report_card_comments`, `attendance_records`, `teacher_assignments`, `audit_log`, `report_card_publications`) live in `public` and are owned by this repo's migrations.

The **admissions tables** that the parent portal owns live in the same Supabase project but are managed by the parent portal's own migrations. The markbook reads from them as a foreign schema would — we never `ALTER`, `INSERT`, `UPDATE`, or `DELETE` any admissions row from this repo.

## Parent identity: no role = parent

Both systems authenticate against the **same `auth.users` table**.

- **Staff** (teacher / registrar / admin / superadmin) have their role set in `app_metadata.role` via `getUserRole()` in `lib/auth/roles.ts`.
- **Parents** have **no** `app_metadata.role`. A signed-in user with a null role is treated as a parent.

This is enforced in two layers:

1. **`proxy.ts`** — the middleware branches on `getUserRole()`. Null-role users are allowed only on `/parent/*`, `/account`, and `/login`; any other path redirects to `/parent`.
2. **`app/(parent)/layout.tsx`** — the parent route group's layout re-checks that `role === null` and redirects staff-role users back to `/`.

Never add `'parent'` to the `Role` type — it would break this heuristic and require schema-level role storage that neither system needs.

## Parent → student linkage: via admissions emails

The link between a parent Supabase account and a student is **implicit** via email match against the admissions tables:

- A parent signs in with, say, `jane.smith@example.com`
- `lib/supabase/admissions.ts::getStudentsByParentEmail()` queries `ay{YY}_enrolment_applications` with `.or('motherEmail.eq.jane.smith@example.com,fatherEmail.eq.jane.smith@example.com')`
- Every matching row is a child linked to this parent for the given academic year
- The child's `studentNumber` from admissions is then resolved to a `students.id` in the grading schema via `students.student_number`

**This means the parent's account email must exactly match an entry in `motherEmail` or `fatherEmail` in admissions.** There is no manual link table. If a parent wants to update their email, they do it in the parent portal (which writes back to `ay{YY}_enrolment_applications`), and the markbook picks up the new email on their next login.

**`fatherEmail` may be null** in admissions — the `.or(...)` query handles this correctly.

## Admissions tables the markbook reads

Three admissions tables live in the shared Supabase project under `public.ay{YY}_enrolment_*`. The parent portal owns the DDL; the markbook only SELECTs from them via the service-role client. **Never INSERT / UPDATE / DELETE these tables from this repo** — the parent portal is the source of truth.

**The `{YY}` prefix is resolved dynamically**, not hardcoded. Every call site that needs to query admissions first reads the current academic year via `lib/academic-year.ts::getCurrentAcademicYear()` (or `requireCurrentAyCode()`), which returns the `ay_code` of the row in `public.academic_years` where `is_current = true`. That `ay_code` is then passed to `fetchAdmissionsRoster()` / `getStudentsByParentEmail()` and normalized to a table name prefix (e.g. `"AY2026"` → `ay2026_enrolment_applications`). When Joann flips the current-AY flag to `AY2027`, the admissions queries switch automatically with no code change, **on the assumption that the parent portal has created `ay2027_enrolment_*` tables with the same column shape as the DDL documented at the bottom of this file**.

The real DDL is at the bottom of this doc under [§ Reference DDL](#reference-ddl). The subsections below list only the columns this repo actually reads, so you can see at a glance which parts of the admissions schema are load-bearing for the markbook.

### `ay{YY}_enrolment_applications` — one row per enrolee

Used by: `lib/supabase/admissions.ts::fetchAdmissionsRoster()`, `getStudentsByParentEmail()`, `lib/sync/students.ts`.

| Column | Type | Nullable | Used for |
|---|---|---|---|
| `enroleeNumber` | `text` | yes | Join key to `ay{YY}_enrolment_status` |
| `studentNumber` | `text` | yes | Stable cross-year student ID (Hard Rule #4). `null` means the registrar hasn't assigned one yet — that row is skipped by the sync. |
| `lastName`, `firstName`, `middleName` | `text` | yes | Name sync into `public.students` |
| `motherEmail` | `text` | yes | Parent auth lookup (**case-insensitive** — the markbook matches with `.ilike`) |
| `fatherEmail` | `text` | yes | Parent auth lookup (same) |

Columns the markbook does **not** currently read (but which exist on the table and may be useful later): `guardianEmail`, `levelApplied`, `applicationStatus`, medical/allergy flags, all `father*` / `mother*` / `guardian*` personal data beyond email, sibling info, `residenceHistory`, `feedbackConsent`, etc.

> **`passCodeStudent` is legacy and should be ignored.** It was the parent-portal's pre-account auth mechanism (parents entered a per-student code to view their application back when there were no `auth.users` rows for them). Supabase Auth accounts superseded it. The markbook should **not** use `passCodeStudent` for anything, and new features shouldn't revive it as a fallback — if email matching ever proves unreliable, fix it at the account/email level, not by resurrecting a deprecated code.

### `ay{YY}_enrolment_status` — workflow state per enrolee

Used by: `fetchAdmissionsRoster()`, `getStudentsByParentEmail()`.

| Column | Type | Nullable | Used for |
|---|---|---|---|
| `enroleeNumber` | `text` | yes | Join to applications |
| `classLevel` | `character varying` | yes | Section level label (e.g. `"Primary 1"`) — normalized by `lib/sync/level-normalizer.ts` |
| `classSection` | `character varying` | yes | Section name (e.g. `"Patience"`). **Primary liveness signal** — `classSection IS NOT NULL` filters to currently-enrolled students. May contain typos; normalized by `lib/sync/section-normalizer.ts`. |
| `classAY` | `character varying` | yes | AY code (e.g. `"AY2026"`) |
| `applicationStatus` | `character varying` | yes | Filter — rows where this is `"Cancelled"` or `"Withdrawn"` are excluded from sync |

Columns the markbook does **not** read but that exist: `registrationStatus`, `documentStatus`, `assessmentStatus`, `assessmentGradeMath`, `assessmentGradeEnglish`, `contractStatus`, `feeStatus`, `suppliesStatus`, `orientationStatus`, all their `Remarks`/`UpdatedDate`/`Updatedby` siblings. These drive the admissions dashboard (Sprint 7 Part A) but are out of scope for the markbook proper.

### `ay{YY}_enrolment_documents` — per-enrolee document upload state

Used by the parent portal for document upload tracking. **This repo does not read from it** today. Listed here because it's part of the same admissions bundle and a future "show uploaded birth certificate on the report card" feature would likely start here.

Notable columns if you end up needing them: `form12`, `medical`, `passport`, `birthCert`, `educCert`, `idPicture`, `icaPhoto`, `financialSupportDocs`, `vaccinationInformation` — each paired with a `*Status` column (e.g. `form12Status`) that the parent portal uses to track "pending / uploaded / approved / rejected".

## RLS consequences

The parent portal operates on admissions tables that live outside this repo's RLS domain. This repo's migrations 004/005 gate the **grading** tables; they do not touch admissions.

- `report_card_publications` has a **parent-read RLS policy** (`rcp_parent_read`) that allows any null-role authenticated user to SELECT all rows. The real gate is at the application layer: `app/(parent)/parent/page.tsx` and `app/(parent)/parent/report-cards/[studentId]/page.tsx` verify parent↔student via `getStudentsByParentEmail()` before fetching anything.
- Every query for grading data inside the parent route group uses the **service-role client** (`createServiceClient()`) because parents' cookie-bound clients cannot read `students`, `section_students`, `grading_sheets`, or `grade_entries` under migration 005.

Never change this to "parents read directly via RLS." The parent↔student relationship lives in admissions, which Postgres RLS policies in this repo cannot see. Keeping the gate in application code is the only workable option.

## What the parent flow actually does, step-by-step

1. Parent signs in at the parent portal (`https://enrol.hfse.edu.sg/`) — that's their existing, primary auth point.
2. From the authenticated parent dashboard (`/admission/dashboard`), the parent clicks "View report card". The parent-portal code reads `supabase.auth.getSession()` and navigates the browser to `https://<markbook>/parent/enter#access_token=…&refresh_token=…&next=/parent/...` (see [§ Parent portal → markbook handoff](#parent-portal--markbook-handoff) below for the integration snippet).
3. The markbook's `/parent/enter` client page reads the URL fragment, calls `supabase.auth.setSession()` with the tokens, and the `@supabase/ssr` browser client writes the session cookies. Parent never sees a login screen on the markbook side.
4. Post-handoff, `router.replace(next)` redirects to `/parent` or directly to `/parent/report-cards/{studentId}`. `proxy.ts` now sees a cookie-bound session with `role === null` and allows parent paths.
5. `/parent` calls `getStudentsByParentEmail(user.email, currentAy.ay_code)` to look up children in `ay{YY}_enrolment_applications` where `motherEmail` or `fatherEmail` matches (case-insensitive).
6. For each admissions row, the server resolves `studentNumber` → grading `students.id` via the service-role client.
7. For each student, the server finds their current-AY `section_students` enrolment and any `report_card_publications` on that section.
8. Per term, the server computes whether each publication is `active` / `scheduled` / `expired` based on `publish_from` / `publish_until` vs `now()`.
9. The page renders one card per child with a "View report card" link per active publication.
10. Clicking the link goes to `/parent/report-cards/{studentId}`, which re-runs the parent→student verification and re-checks the publication window, then renders the shared `<ReportCardDocument>` via `buildReportCard()`.
11. Parent presses `Ctrl+P` to print / save as PDF — the print CSS in `components/report-card/report-card-document.tsx` produces the same paper layout the staff view uses.

The markbook's own `/login` route still exists as a fallback (staff use it for sign-in; a parent could technically use it too if they ever arrive at the markbook without going through the handoff), but the intended parent entry point is always the "View report card" button on the parent portal.

## Parent portal → markbook handoff

The handoff mechanism that lets parents cross from `enrol.hfse.edu.sg` into the markbook without a second sign-in, based on Path B of the design discussion (token-in-URL-fragment).

### Why it exists

Parent accounts live in the shared Supabase project's `auth.users`. The parent portal and the markbook are separate codebases on **different origins**, which means their Supabase Auth session cookies are not shared. Without a handoff mechanism, a parent who signed in at the parent portal would face a second login screen on the markbook — same credentials, different cookie jar, bad UX. The handoff lets us hand over the signed-in session cleanly.

### How it works

1. **Parent portal builds a URL** with the parent's current Supabase session tokens in the **URL fragment** (the part after `#`):
   ```
   https://<markbook-domain>/parent/enter#access_token=<jwt>&refresh_token=<jwt>&next=/parent/report-cards/<studentId>
   ```
2. **Browser navigates** to the markbook. The URL fragment is **not sent to any server** — it stays in the browser, so the tokens never appear in the markbook's access logs, the parent-portal's `Referer` header, or any intermediate proxy.
3. **Markbook's `/parent/enter` client page** (at `app/(parent)/parent/enter/page.tsx`) reads `window.location.hash` on mount, parses `access_token` / `refresh_token` / `next`, and calls `supabase.auth.setSession({ access_token, refresh_token })`. The `@supabase/ssr` browser client writes the `sb-*-auth-token` cookies via its cookie adapter.
4. **`router.replace(next)`** navigates to the target path. The URL fragment drops from history, and `proxy.ts` on the next hop sees a valid session cookie → parent routing kicks in → the report card renders.

### Security

- The fragment is origin-local to the browser — it's not in Referer (browsers strip fragments), not in access logs, not in redirect chains.
- The `next` parameter is validated to start with `/parent` — anything else falls back to `/parent`. No open redirect.
- Tokens are never logged, sent to telemetry, or passed through `fetch`. The only consumer is `setSession`.
- If the access token is expired, `setSession` uses the refresh token to mint a new one. If the refresh token is also expired, the handoff shows an error state with a "Back to parent portal" button pointing at `NEXT_PUBLIC_PARENT_PORTAL_URL`.
- The real authorization gate is still `getStudentsByParentEmail()` in the parent-scoped pages — an attacker with stolen tokens can still only see children linked to that parent's email, which is the same access they'd have via a direct parent-portal login. The handoff does not widen the blast radius.
- No HMAC signing or referrer origin check was added this sprint. The parent↔student gate is sufficient for UAT. Revisit if a real threat materializes; prefer HMAC over referrer if you ever need hardening.

### Environment variables

| Side | Name | Value |
|---|---|---|
| Markbook | `NEXT_PUBLIC_PARENT_PORTAL_URL` | `https://enrol.hfse.edu.sg/admission/dashboard` — error fallback destination on `/parent/enter` |
| Parent portal | `NEXT_PUBLIC_MARKBOOK_HANDOFF_URL` | `https://<markbook-domain>/parent/enter` — target of the "View report card" button |

Both must be set in **Production** environment on Vercel (or equivalent), not just locally.

### Integration snippet for the parent-portal team

Drop this component into the parent-portal repo (e.g. at `components/ViewReportCardButton.tsx`) and render it from the authenticated dashboard at `/admission/dashboard`. It assumes the parent portal already exposes a Supabase browser client via `@/lib/supabase/client` (or equivalent) — adapt the import path if yours differs.

```tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Markbook handoff URL. Set NEXT_PUBLIC_MARKBOOK_HANDOFF_URL on the parent
// portal's production env so it points at the real markbook domain instead
// of a hardcoded default.
const MARKBOOK_HANDOFF_URL =
  process.env.NEXT_PUBLIC_MARKBOOK_HANDOFF_URL ??
  'https://hfse-markbook.vercel.app/parent/enter';

type Props = {
  /**
   * Optional — if the parent portal already knows the specific student
   * the parent wants to view, pass the markbook's `students.id` so the
   * handoff deep-links straight to that report card. Without it, the
   * parent lands on the markbook's "My children" page and picks which
   * report card to open from there.
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

**Usage on the authenticated parent dashboard:**

```tsx
// Anywhere under /admission/dashboard
<ViewReportCardButton studentId={child.markbookStudentId}>
  View {child.firstName}&apos;s report card
</ViewReportCardButton>
```

Or without a specific student (parent picks on the markbook side):

```tsx
<ViewReportCardButton>View report cards</ViewReportCardButton>
```

### Troubleshooting

- **"This handoff link is missing its session tokens"** — the URL fragment is empty or malformed. Check that the parent-portal snippet is constructing the URL correctly with `#` (not `?`) and that both `access_token` and `refresh_token` are present.
- **"Your session has expired"** — the refresh token is no longer valid. The parent needs to sign in fresh on the parent portal, then click the button again.
- **Parent lands on the markbook's `/login` instead of `/parent/enter`** — `PUBLIC_PATHS` in `proxy.ts` didn't get `/parent/enter` added. Verify the middleware allows the route without authentication.
- **Handoff succeeds but parent sees "no students linked to this email"** — the parent portal's `motherEmail`/`fatherEmail` on the admissions row doesn't match their `auth.users.email`. The markbook does a case-insensitive match (`.ilike`), but a genuine email mismatch (typo, different provider) will show an empty state. Fix at the admissions side.

## Out of scope

- **Parent self-service**: no enrolment, no application editing, no document upload, no profile edit in this repo. Parents do all of that in the parent portal.
- **Email notifications**: when the registrar publishes a window, parents are not emailed. They navigate to the URL on their own. Wiring Resend / SMTP / WhatsApp is a future sprint.
- **Cross-AY history**: parents only see current-AY report cards. Historical term cards are not exposed.
- **Account linking UI**: parents cannot "add another child" from within the markbook — the link is purely via email in admissions.

---

## Reference DDL

Frozen copy of the admissions table definitions, as of 2026-04-14, pulled from the parent portal's Supabase project. **Update this block whenever the parent portal bumps its schema** — the "what the markbook reads" tables above only stay accurate if this ground truth does.

Column name identifiers are quoted camelCase. This is what PostgREST returns when you `.select('*')` from these tables in JavaScript; the Supabase JS client handles the quoting automatically in both `.select()` and `.or()` filter strings.

### `ay2026_enrolment_applications`

```sql
create table public.ay2026_enrolment_applications (
  id bigint generated by default as identity not null,
  created_at timestamp with time zone null default (now() AT TIME ZONE 'Asia/Singapore'::text),
  category character varying null,
  "enroleeNumber" text null,
  "studentNumber" text null,
  "enroleeFullName" text null,
  "lastName" text null,
  "firstName" text null,
  "middleName" text null,
  "preferredName" text null,
  "levelApplied" text null,
  "classType" text null,
  "preferredSchedule" text null,
  "birthDay" date null,
  gender text null,
  "passportNumber" text null,
  "passportExpiry" date null,
  nationality text null,
  religion text null,
  "religionOther" text null,
  nric text null,
  pass text null,
  "passExpiry" date null,
  "homeAddress" text null,
  "postalCode" bigint null,
  "homePhone" bigint null,
  "contactPerson" text null,
  "contactPersonNumber" bigint null,
  "primaryLanguage" text null,
  "parentMaritalStatus" text null,
  "livingWithWhom" text null,
  "fatherFullName" text null,
  "fatherLastName" text null,
  "fatherFirstName" text null,
  "fatherMiddleName" text null,
  "fatherPreferredName" text null,
  "fatherBirthDay" date null,
  "fatherPassport" text null,
  "fatherPassportExpiry" date null,
  "fatherNric" text null,
  "fatherPass" text null,
  "fatherPassExpiry" date null,
  "fatherCompanyName" text null,
  "fatherPosition" text null,
  "fatherNationality" text null,
  "fatherReligion" text null,
  "fatherMobile" bigint null,
  "fatherEmail" text null,
  "fatherMarital" text null,
  "motherFullName" text null,
  "motherLastName" text null,
  "motherFirstName" text null,
  "motherMiddleName" text null,
  "motherPreferredName" text null,
  "motherBirthDay" date null,
  "motherPassport" text null,
  "motherPassportExpiry" date null,
  "motherNric" text null,
  "motherPass" text null,
  "motherPassExpiry" date null,
  "motherCompanyName" text null,
  "motherPosition" text null,
  "motherNationality" text null,
  "motherReligion" text null,
  "motherMobile" bigint null,
  "motherEmail" text null,
  "motherMarital" text null,
  "guardianFullName" text null,
  "guardianLastName" text null,
  "guardianFirstName" text null,
  "guardianMiddleName" text null,
  "guardianPreferredName" text null,
  "guardianBirthDay" date null,
  "guardianPassport" text null,
  "guardianPassportExpiry" date null,
  "guardianNric" text null,
  "guardianPass" text null,
  "guardianPassExpiry" date null,
  "guardianCompanyName" text null,
  "guardianPosition" text null,
  "guardianNationality" text null,
  "guardianReligion" text null,
  "guardianMobile" bigint null,
  "guardianEmail" text null,
  "siblingFullName1" text null,
  "siblingBirthDay1" date null,
  "siblingReligion1" text null,
  "siblingEducationOccupation1" text null,
  "siblingSchoolCompany1" text null,
  "siblingFullName2" text null,
  "siblingBirthDay2" date null,
  "siblingReligion2" text null,
  "siblingEducationOccupation2" text null,
  "siblingSchoolCompany2" text null,
  "siblingFullName3" text null,
  "siblingBirthDay3" date null,
  "siblingReligion3" text null,
  "siblingEducationOccupation3" text null,
  "siblingSchoolCompany3" text null,
  "siblingFullName4" text null,
  "siblingBirthDay4" date null,
  "siblingReligion4" text null,
  "siblingEducationOccupation4" text null,
  "siblingSchoolCompany4" text null,
  "siblingFullName5" text null,
  "siblingBirthDay5" date null,
  "siblingReligion5" text null,
  "siblingEducationOccupation5" text null,
  "siblingSchoolCompany5" text null,
  "availSchoolBus" text null,
  "availUniform" text null,
  "availStudentCare" text null,
  "additionalLearningNeeds" text null,
  "previousSchool" text null,
  "documentsStatus" text null,
  "registrationInvoice" text null,
  "registrationInvoiceDate" date null,
  "assessmentDate" date null,
  "assessmentStatus" text null,
  "startDate" text null,
  "enrollmentInvoice" text null,
  "enrollmentInvoiceDate" date null,
  "acctsRemarks" text null,
  "enroleePhoto" text null,
  "creatorUid" text null,
  "howDidYouKnowAboutHFSEIS" text null,
  "otherSource" text null,
  "applicationStatus" text null,
  "fatherReligionOther" text null,
  "motherReligionOther" text null,
  "guardianReligionOther" text null,
  "passCodeStudent" text null,
  discount1 text null,
  discount2 text null,
  discount3 text null,
  "referrerName" text null,
  "paymentOption" text null,
  "referrerMobile" text null,
  "contractSignatory" text null,
  "vizSchoolProgram" text null,
  "feedbackRating" smallint null,
  "feedbackComments" text null,
  "feedbackConsent" boolean null,
  "feedbackSubmittedAt" timestamp without time zone null,
  "preCourseAnswer" text null,
  "preCourseDate" timestamp without time zone null,
  "preCourseAcknowledgedAt" timestamp without time zone null,
  "stpApplicationType" text null,
  allergies boolean null,
  "allergyDetails" text null,
  asthma boolean null,
  "foodAllergies" boolean null,
  "foodAllergyDetails" text null,
  "heartConditions" boolean null,
  epilepsy boolean null,
  diabetes boolean null,
  eczema boolean null,
  "otherMedicalConditions" text null,
  "paracetamolConsent" boolean null,
  "otherLearningNeeds" text null,
  "studentCareProgram" text null,
  "socialMediaConsent" boolean null,
  "guardianWhatsappTeamsConsent" boolean null,
  "fatherWhatsappTeamsConsent" boolean null,
  "motherWhatsappTeamsConsent" boolean null,
  "residenceHistory" jsonb null,
  "dietaryRestrictions" text null,
  constraint ay2026_enrolment_applications_pkey primary key (id)
) TABLESPACE pg_default;
```

### `ay2026_enrolment_documents`

```sql
create table public.ay2026_enrolment_documents (
  id bigint generated by default as identity not null,
  created_at timestamp with time zone null default (now() AT TIME ZONE 'Asia/Singapore'::text),
  "studentNumber" text null,
  "enroleeNumber" text null,
  form12 text null,
  "form12Status" character varying null,
  medical text null,
  "medicalStatus" character varying null,
  passport text null,
  "passportStatus" character varying null,
  "passportExpiry" date null,
  "birthCert" text null,
  "birthCertStatus" character varying null,
  pass text null,
  "passStatus" character varying null,
  "passExpiry" date null,
  "educCert" text null,
  "educCertStatus" character varying null,
  "motherPassport" text null,
  "motherPassportStatus" character varying null,
  "motherPassportExpiry" date null,
  "motherPass" text null,
  "motherPassStatus" character varying null,
  "motherPassExpiry" date null,
  "fatherPassport" text null,
  "fatherPassportStatus" character varying null,
  "fatherPassportExpiry" date null,
  "fatherPass" text null,
  "fatherPassStatus" character varying null,
  "fatherPassExpiry" date null,
  "guardianPassport" text null,
  "guardianPassportStatus" character varying null,
  "guardianPassportExpiry" date null,
  "guardianPass" text null,
  "guardianPassStatus" character varying null,
  "guardianPassExpiry" date null,
  "idPicture" text null,
  "idPictureStatus" character varying null,
  "idPictureUploadedDate" date null,
  "uploadFormDocument" uuid null,
  "icaPhoto" text null,
  "icaPhotoStatus" character varying null,
  "financialSupportDocs" text null,
  "financialSupportDocsStatus" character varying null,
  "vaccinationInformation" text null,
  "vaccinationInformationStatus" character varying null,
  constraint ay2026_enrolment_documents_pkey primary key (id)
) TABLESPACE pg_default;
```

### `ay2026_enrolment_status`

```sql
create table public.ay2026_enrolment_status (
  id bigint generated by default as identity not null,
  created_at timestamp with time zone not null default now(),
  "enroleeNumber" text null,
  "enrolmentDate" date null,
  "enroleeName" text null,
  "applicationStatus" character varying null,
  "applicationRemarks" text null,
  "applicationUpdatedDate" date null,
  "applicationUpdatedBy" text null,
  "registrationStatus" character varying null,
  "registrationInvoice" text null,
  "registrationPaymentDate" date null,
  "registrationRemarks" text null,
  "registrationUpdateDate" date null,
  "registrationUpdatedby" text null,
  "documentStatus" character varying null,
  "documentRemarks" text null,
  "documentUpdatedDate" date null,
  "documentUpdatedby" text null,
  "assessmentStatus" character varying null,
  "assessmentSchedule" date null,
  "assessmentGradeMath" text null,
  "assessmentGradeEnglish" text null,
  "assessmentRemarks" text null,
  "assessmentMedical" text null,
  "assessmentUpdatedDate" date null,
  "assessmentUpdatedby" text null,
  "contractStatus" character varying null,
  "contractRemarks" text null,
  "contractUpdatedDate" date null,
  "contractUpdatedby" text null,
  "feeStatus" character varying null,
  "feeInvoice" text null,
  "feePaymentDate" date null,
  "feeStartDate" date null,
  "feeRemarks" text null,
  "feeUpdatedDate" date null,
  "feeUpdatedby" text null,
  "classStatus" character varying null,
  "classAY" character varying null,
  "classLevel" character varying null,
  "classSection" character varying null,
  "classRemarks" text null,
  "classUpdatedDate" date null,
  "classUpdatedby" text null,
  "suppliesStatus" character varying null,
  "suppliesClaimedDate" date null,
  "suppliesRemarks" text null,
  "suppliesUpdatedDate" date null,
  "suppliesUpdatedby" text null,
  "orientationStatus" character varying null,
  "orientationScheduleDate" date null,
  "orientationRemarks" text null,
  "orientationUpdatedDate" date null,
  "orientationUpdateby" text null,
  "enroleeType" character varying null,
  "levelApplied" text null,
  constraint ay2026_enrolment_status_pkey primary key (id)
) TABLESPACE pg_default;
```
