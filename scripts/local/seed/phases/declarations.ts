// Phase "declarations" (plan phase 6): Student Absence and Travel Declarations
// and their approval ladders.
//
// Production (prod-profile.md): 8 approval requests on the declaration flow —
// 5 approved, 3 rejected — each with two steps (Form class adviser → Officer
// in charge, one officer per half of the school, migration 128), plus the
// markbook's 2 grade-change requests. Locally: 15 parent filings across every
// status a filing can reach (approved 9, rejected 3, pending 3 — at both
// steps), filed 2026-08-20..2026-09-30 for AY2026 children in Primary and
// Secondary so both officers decide, plus the school's own two certificate
// recordings. No filing is cancelled: no route in this app or the parent
// portal withdraws one (the staff table's "cancelled" label is unreachable).
//
// Realism: an approved trip turns its days into vacation leave, so a travel
// filing is only ever planned for a child with no other vacation leave in the
// year — the children over the vacation quota stay exactly the ones the
// attendance phase put there.
//
// Write paths, as the app has them:
//
//   * FILING — POST /api/parent/v2/declarations, mirrored (it gates on a
//     Bearer token). The parent's own login (an auth user carrying the
//     admissions record's parent address, created here and marked
//     LOCAL_PARENT_MARK so the wipe removes it) signs in; the token goes
//     through `auth.getUser` as the route does; the children are resolved by
//     the app's `loadFilableStudents` (the parent→child link); the body is
//     checked by `fileDeclarationSchema`; a certificate is first uploaded to
//     the `parent-portal` bucket at `declarations/<parent id>/<id>.pdf`
//     through the Storage API, as the evidence route does (a tiny placeholder
//     PDF); then `filingCoversAnySchoolDay`, `findOverlappingFilings`, the
//     insert, `openDeclarationApprovals` and the route's `declaration.file`
//     audit rows. The route compares dates with `sgToday()`; the seeder with
//     the filing's own day, so the 30-day backdate rule is applied to the day
//     the parent actually filed and the result is the same on every rebuild.
//     `created_at` is that filing moment (the route sets it from its clock).
//
//   * DECIDING — POST /api/approvals/[requestId]/decide, mirrored: the body
//     through `DecideApprovalSchema` (a rejection must give a reason), then
//     the app's own `decideApproval` as the step's real approver — the class's
//     form adviser (from teacher_assignments) for step 1, the officer in
//     charge for the child's half for step 2. The last approval runs the
//     app's register write (`writeRegisterForDeclaration`): every school day
//     of the filing becomes EX (`mc` for an absence, `vacation` for travel),
//     superseding the teacher's mark, with its own `attendance.daily.correct`
//     audit rows. The days chosen are the ones the register shows the child
//     away (A, or an EX episode), so most approvals turn an A into an EX.
//
//   * THE REGISTER, AFTER A CRASH — an approved filing whose register write
//     never landed (`register_written_at` null) gets the app's own
//     `writeRegisterForDeclaration` as its officer in charge on the next run.
//
//   * THE SCHOOL'S OWN CERTIFICATE — POST /api/declarations/staff, mirrored,
//     as the class's form adviser: once creating a filing (in already
//     approved, no ladder, no register write — the adviser already marked the
//     day EX) with an uploaded certificate under `declarations/staff/<id>/`,
//     once attaching a certificate link to the pending absence filed by a
//     parent (`declaration.evidence.attach`; the filing stays pending).
//
// Idempotent, filing by filing: a filing already on record (same parent,
// child, kind and dates) is not filed again — one whose ladders did not all
// open is taken back out (with any ladder that did) and filed again, as the
// route does when that step fails — each planned decision is made only while
// its step is still pending, and a missing audit row or register write left
// by a run that died half-way is written on the next.

import { createHash } from 'node:crypto';

import { decideApproval, type DecideActor } from '@/lib/approvals/decide';
import { logAction, logActions } from '@/lib/audit/log-action';
import type { Role } from '@/lib/auth/roles';
import { openDeclarationApprovals } from '@/lib/declarations/approval';
import {
  filingCoversAnySchoolDay,
  findOverlappingFilings,
} from '@/lib/declarations/filing-window';
import {
  loadFilableStudents,
  type LinkedStudent,
} from '@/lib/declarations/parent';
import { writeRegisterForDeclaration } from '@/lib/declarations/register';
import {
  assertCanMarkRegisterForSection,
  attachEvidenceToFiling,
  findFilingCoveringDays,
  isOwnStaffEvidencePath,
  resolveFilingTarget,
  staffEvidencePrefix,
} from '@/lib/declarations/staff-filing';
import { DecideApprovalSchema } from '@/lib/schemas/approval-flows';
import { fileDeclarationSchema } from '@/lib/schemas/declarations';
import { staffMedicalCertificateSchema } from '@/lib/schemas/staff-declaration';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';

import { LOCAL_PARENT_MARK, LOCAL_PASSWORD } from '../lib/constants';
import { anon, must, service, sqlRows } from '../lib/local';
import { rng, uuidFrom } from '../lib/random';
import { STAFF, emailOf, staffId, type StaffKey } from './staff';

const BUCKET = 'parent-portal';
const WINDOW = { from: '2026-08-20', to: '2026-09-30' } as const;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A one-page placeholder certificate. Local stack only. */
const PLACEHOLDER_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
);

// ── Who and when ──────────────────────────────────────────────────────────

/** An AY2026 child a declaration can be filed for. */
export type Child = {
  enrolmentId: string;
  studentId: string;
  studentNumber: string;
  sectionId: string;
  sectionName: string;
  level: string;
  half: 'primary' | 'secondary';
  adviserId: string;
  adviserEmail: string;
  parentEmail: string;
  /** The child's latest mark per day inside WINDOW, in date order. */
  days: Array<{ date: string; status: string; reason: string }>;
  /** Every AY2026 day whose latest mark is vacation leave (EX / vacation). */
  vacation: string[];
};

type Outcome =
  | 'approved'
  | 'rejected-fca'
  | 'rejected-oic'
  | 'pending-fca'
  | 'pending-oic';

type Spec = {
  key: string;
  type: 'absence' | 'travel';
  children: Child[];
  start: string;
  end: string;
  filedOn: string;
  filedAt: string;
  withMedical: boolean | null;
  evidence: 'file' | 'link' | 'both' | null;
  destinationCity: string | null;
  parentNote: string | null;
  outcome: Outcome;
};

/** The OICs, by half of the school (staff.ts wires them on the flow's step). */
const OIC: Record<'primary' | 'secondary', StaffKey> = {
  primary: 'oicPrimary',
  secondary: 'oicSecondary',
};

/**
 * AY2026 children who can be filed for: on one class list only (not the
 * transfer), not withdrawn, in Primary or Secondary (the officer in charge is
 * chosen by half; a preschool child matches neither tagged officer), in a
 * class with a form adviser, with a parent address on the admissions record.
 *
 * ⚠ The register is read WITHOUT the marks an approved declaration wrote
 * (recorded by an officer in charge, a school_admin), so a re-run chooses the
 * same children and days as the first run did.
 */
export function loadChildren(): Child[] {
  const rows = sqlRows(`
    select ss.id, st.id, st.student_number, s.id, s.name, l.code, l.level_type,
           u.id, u.email,
           lower(trim(coalesce(nullif(trim(app."motherEmail"), ''), app."fatherEmail")))
      from section_students ss
      join students st on st.id = ss.student_id
      join sections s on s.id = ss.section_id
      join levels l on l.id = s.level_id
      join academic_years a on a.id = s.academic_year_id and a.ay_code = 'AY2026'
      join teacher_assignments ta on ta.section_id = s.id and ta.role = 'form_adviser'
      join auth.users u on u.id = ta.teacher_user_id
      join ay2026_enrolment_applications app on app."studentNumber" = st.student_number
      -- What the parent→child link (getAllStudentsByParentEmail) requires:
      -- a class on the admissions record, not cancelled or withdrawn.
      join ay2026_enrolment_status es on es."enroleeNumber" = app."enroleeNumber"
       and es."classSection" is not null
       and es."applicationStatus" not in ('Cancelled', 'Withdrawn')
     where ss.enrollment_status <> 'withdrawn'
       and l.level_type in ('primary', 'secondary')
       and coalesce(nullif(trim(app."motherEmail"), ''), nullif(trim(app."fatherEmail"), '')) is not null
       and (select count(*) from section_students x join sections y on y.id = x.section_id
             where x.student_id = st.id and y.academic_year_id = a.id) = 1
     order by st.student_number`);
  const marks = new Map<string, Child['days']>();
  for (const [ss, date, status, reason] of sqlRows(`
    select distinct on (d.section_student_id, d.date) d.section_student_id, d.date::text,
           coalesce(d.status, ''), coalesce(d.ex_reason, '')
      from attendance_daily d
     where d.date between '${WINDOW.from}' and '${WINDOW.to}'
       and not coalesce(d.recorded_by in (select id from auth.users
                                         where raw_app_meta_data->'role' ? 'school_admin'), false)
     order by d.section_student_id, d.date, d.recorded_at desc, d.id desc`)) {
    marks.set(ss, [...(marks.get(ss) ?? []), { date, status, reason }]);
  }
  // The year's vacation leave, read the same way (without the approvals'
  // own marks): a trip may only be filed for a child with none outside it.
  const vacation = new Map<string, string[]>();
  for (const [ss, date] of sqlRows(`
    select x.section_student_id, x.date::text from (
      select distinct on (d.section_student_id, d.date) d.section_student_id, d.date, d.status, d.ex_reason
        from attendance_daily d
        join terms t on t.id = d.term_id
        join academic_years a on a.id = t.academic_year_id and a.ay_code = 'AY2026'
       where not coalesce(d.recorded_by in (select id from auth.users
                                            where raw_app_meta_data->'role' ? 'school_admin'), false)
       order by d.section_student_id, d.date, d.recorded_at desc, d.id desc) x
     where x.status = 'EX' and x.ex_reason = 'vacation'
     order by 1, 2`)) {
    vacation.set(ss, [...(vacation.get(ss) ?? []), date]);
  }
  return rows.map(
    ([
      enrolmentId,
      studentId,
      studentNumber,
      sectionId,
      sectionName,
      level,
      half,
      adviserId,
      adviserEmail,
      parentEmail,
    ]) => ({
      enrolmentId,
      studentId,
      studentNumber,
      sectionId,
      sectionName,
      level,
      half: half as Child['half'],
      adviserId,
      adviserEmail,
      parentEmail,
      days: (marks.get(enrolmentId) ?? []).sort((a, b) =>
        a.date.localeCompare(b.date)
      ),
      vacation: vacation.get(enrolmentId) ?? [],
    })
  );
}

/** Runs of consecutive register days with the same kind of mark. */
function runs(
  c: Child,
  match: (d: Child['days'][number]) => boolean
): Array<{ start: string; end: string; days: number }> {
  const out: Array<{ start: string; end: string; days: number }> = [];
  let cur: { start: string; end: string; days: number } | null = null;
  for (const d of c.days) {
    if (match(d)) {
      if (cur) {
        cur.end = d.date;
        cur.days++;
      } else cur = { start: d.date, end: d.date, days: 1 };
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** An Excused day with no reason or a medical one — a medical episode. */
const illDay = (d: Child['days'][number]) =>
  d.status === 'EX' && (d.reason === '' || d.reason === 'mc');

const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * The filings, decided in full before anything is written. Children and days
 * are drawn from the register in a stable order (see `loadChildren`), so the
 * plan is the same on every rebuild and on a re-run.
 */
export function planDeclarations(children: Child[]): Spec[] {
  const r = rng('declarations:plan');
  const pool = r.shuffle(children);
  const used = new Set<string>();
  const specs: Spec[] = [];
  const at = (key: string) => {
    const t = rng(`declarations:time:${key}`);
    return `${String(t.int(6, 21)).padStart(2, '0')}:${String(t.int(0, 59)).padStart(2, '0')}`;
  };
  const absenceFiledOn = (key: string, start: string) => {
    const lag = rng(`declarations:lag:${key}`).int(0, 2);
    const d = shift(start, lag);
    return d > WINDOW.to ? WINDOW.to : d;
  };

  // A child, and a run of their register days, for one slot.
  const take = (
    key: string,
    half: Child['half'] | null,
    want: (d: Child['days'][number]) => boolean,
    ok: (run: { start: string; end: string; days: number }) => boolean,
    childOk: (c: Child, run: { start: string; end: string }) => boolean = () =>
      true
  ) => {
    for (const c of pool) {
      if (used.has(c.studentId) || (half && c.half !== half)) continue;
      const run = runs(c, want).find((x) => ok(x) && childOk(c, x));
      if (!run) continue;
      used.add(c.studentId);
      return { child: c, run };
    }
    throw new Error(`declarations: no child fits slot ${key}`);
  };
  const absent = (d: Child['days'][number]) => d.status === 'A';
  // An Excused run the teacher gave no other reason for: a medical episode
  // (for an absence) or a family trip (for travel).
  const ill = illDay;
  const away = (d: Child['days'][number]) =>
    d.status === 'EX' && (d.reason === '' || d.reason === 'vacation');
  const short = (run: { days: number }) => run.days <= 2;
  // An approved trip makes its days vacation leave. A child who already has
  // vacation leave elsewhere in the year would gain a second trip and could
  // go over the one-trip-a-term quota — only the attendance phase's chosen
  // children are over it, so a trip is filed only for a child with none.
  const noOtherLeave = (c: Child, run: { start: string; end: string }) =>
    c.vacation.every((d) => d >= run.start && d <= run.end);

  const absence = (
    key: string,
    half: Child['half'],
    outcome: Outcome,
    o: {
      withMedical: boolean;
      evidence?: Spec['evidence'];
      note?: string | null;
      onEx?: boolean;
      from?: string;
    }
  ) => {
    const { child, run } = take(
      key,
      half,
      o.onEx ? ill : absent,
      (x) => (o.onEx ? x.days <= 3 : short(x)) && x.start >= (o.from ?? '')
    );
    specs.push({
      key,
      type: 'absence',
      children: [child],
      start: run.start,
      end: run.end,
      filedOn: absenceFiledOn(key, run.start),
      filedAt: at(key),
      withMedical: o.withMedical,
      evidence: o.withMedical ? (o.evidence ?? 'file') : null,
      destinationCity: null,
      parentNote: o.note ?? null,
      outcome,
    });
  };

  // Absence with a certificate, approved — the commonest filing (production:
  // most of its 5 approvals). Both halves, so both officers decide.
  absence('mc-1', 'primary', 'approved', {
    withMedical: true,
    note: 'Fever since last night; we saw the doctor this morning.',
  });
  absence('mc-2', 'secondary', 'approved', { withMedical: true });
  absence('mc-3', 'primary', 'approved', {
    withMedical: true,
    evidence: 'link',
  });
  absence('mc-4', 'secondary', 'approved', {
    withMedical: true,
    note: 'Stomach flu. Certificate attached.',
  });
  absence('mc-5', 'primary', 'approved', {
    withMedical: true,
    evidence: 'both',
  });
  // Already marked Excused by the teacher; the approval only adds the reason.
  absence('mc-6', 'secondary', 'approved', {
    withMedical: true,
    onEx: true,
  });
  // A plain absence, no certificate, approved anyway.
  absence('plain-1', 'primary', 'approved', {
    withMedical: false,
    note: 'Family emergency in the morning — he stayed home with his grandmother.',
  });
  // Turned down: no certificate (adviser), and a certificate for the wrong
  // week (officer in charge).
  absence('reject-1', 'secondary', 'rejected-fca', { withMedical: false });
  absence('reject-2', 'primary', 'rejected-fca', {
    withMedical: false,
    note: 'Not feeling well.',
  });
  absence('reject-3', 'secondary', 'rejected-oic', {
    withMedical: true,
    evidence: 'file',
  });
  // Still with the adviser: filed in the last days of the window. The school
  // later attaches the certificate the parent did not (see the staff part).
  absence('pending-1', 'primary', 'pending-fca', {
    withMedical: false,
    from: '2026-09-21',
    note: 'Cough and cold. Will send the MC once we have it.',
  });
  // A certificate the adviser has accepted, waiting on the officer in charge.
  // (No filing is cancelled: neither this app nor the parent portal has a
  // path that withdraws one.)
  absence('pending-2', 'secondary', 'pending-oic', {
    withMedical: true,
    from: '2026-09-14',
    note: 'Viral fever; the doctor advised rest at home. MC attached.',
  });

  // Travel to the Philippines. Two siblings on one filing over the term
  // break (one form, two declarations, one filing group), and one child whose
  // register already shows the family trip — still waiting on the officer.
  const byParent = new Map<string, Child[]>();
  for (const c of pool)
    if (!used.has(c.studentId))
      byParent.set(c.parentEmail, [...(byParent.get(c.parentEmail) ?? []), c]);
  // Thursday of T3's last week to the Tuesday after the break.
  const siblingTrip = { start: '2026-09-03', end: '2026-09-15' };
  const siblings = [...byParent.values()]
    .map((cs) => cs.filter((c) => noOtherLeave(c, siblingTrip)))
    .filter((cs) => cs.length >= 2)
    .sort((a, b) => a[0].studentNumber.localeCompare(b[0].studentNumber))[0];
  if (siblings) {
    const kids = siblings.slice(0, 2);
    for (const k of kids) used.add(k.studentId);
    specs.push({
      key: 'travel-siblings',
      type: 'travel',
      children: kids,
      start: siblingTrip.start,
      end: siblingTrip.end,
      filedOn: '2026-08-24',
      filedAt: at('travel-siblings'),
      withMedical: null,
      evidence: null,
      destinationCity: 'Manila',
      parentNote:
        "Going home for their grandmother's 80th birthday. Back in class on Wednesday 16 September.",
      outcome: 'approved',
    });
  } else {
    // No sibling pair on the lists (the local people data has none whose
    // two children are both enrolled): two single-child trips instead, one
    // per half, from trips the register already shows.
    for (const [key, half, city] of [
      ['travel-2', 'primary', 'Manila'],
      ['travel-3', 'secondary', 'Davao'],
    ] as const) {
      const { child, run } = take(
        key,
        half,
        away,
        (x) => x.days >= 2,
        noOtherLeave
      );
      const filed = shift(run.start, -10);
      specs.push({
        key,
        type: 'travel',
        children: [child],
        start: run.start,
        end: run.end,
        filedOn: filed < WINDOW.from ? WINDOW.from : filed,
        filedAt: at(key),
        withMedical: null,
        evidence: null,
        destinationCity: city,
        parentNote:
          key === 'travel-2'
            ? "Going home for their grandmother's 80th birthday."
            : null,
        outcome: 'approved',
      });
    }
  }
  {
    const { child, run } = take(
      'travel-1',
      'secondary',
      away,
      (x) => x.days >= 2 && x.start >= '2026-08-28',
      noOtherLeave
    );
    const filed = shift(run.start, -8);
    specs.push({
      key: 'travel-1',
      type: 'travel',
      children: [child],
      start: run.start,
      end: run.end,
      filedOn: filed < WINDOW.from ? WINDOW.from : filed,
      filedAt: at('travel-1'),
      withMedical: null,
      evidence: null,
      destinationCity: 'Cebu',
      parentNote:
        'Family trip, approved leave from work. We will catch up on homework.',
      outcome: 'pending-oic',
    });
  }
  return specs;
}

// ── Accounts ──────────────────────────────────────────────────────────────

/**
 * The parent's own login: the admissions record's address, no staff role.
 * Shared with the pfiles and portal-drafts phases (one id per address, so a
 * family that both files a declaration and re-uploads a document is one login).
 */
export async function ensureParent(email: string): Promise<string> {
  const sb = service();
  const id = uuidFrom(`parent:${email}`);
  const { data } = await sb.auth.admin.getUserById(id);
  if (data?.user) return id;
  const { error } = await sb.auth.admin.createUser({
    id,
    email,
    password: LOCAL_PASSWORD,
    email_confirm: true,
    app_metadata: { [LOCAL_PARENT_MARK.key]: LOCAL_PARENT_MARK.value },
    user_metadata: { display_name: email.split('@')[0] },
  });
  if (error) throw new Error(`declarations: parent ${email}: ${error.message}`);
  return id;
}

/** The route's authentication: a password sign-in, then `auth.getUser(token)`. */
async function parentSession(
  email: string
): Promise<{ userId: string; email: string }> {
  const client = anon();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: LOCAL_PASSWORD,
  });
  if (error || !data.session)
    throw new Error(`declarations: sign-in as ${email}: ${error?.message}`);
  const { data: user, error: userErr } = await service().auth.getUser(
    data.session.access_token
  );
  await client.auth.signOut();
  if (userErr || !user.user?.email)
    throw new Error(`declarations: token for ${email} did not verify`);
  return { userId: user.user.id, email: user.user.email.trim().toLowerCase() };
}

function staffActor(key: StaffKey): DecideActor {
  const s = STAFF.find((x) => x.key === key)!;
  return { id: staffId(s), email: emailOf(s), role: s.roles[0] as Role };
}

// ── Evidence ──────────────────────────────────────────────────────────────

/** Uploads the placeholder certificate (the evidence routes' Storage upload). */
async function upload(path: string): Promise<void> {
  const { error } = await service()
    .storage.from(BUCKET)
    .upload(path, PLACEHOLDER_PDF, {
      upsert: false,
      contentType: 'application/pdf',
    });
  // Already there from an earlier run: the same file at the same path.
  if (error && !/exists|duplicate/i.test(error.message))
    throw new Error(`declarations: upload ${path}: ${error.message}`);
}

const certificateLink = (key: string) =>
  `https://mc.gov.sg/certificates/${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;

// ── Filing ────────────────────────────────────────────────────────────────

type FiledRow = {
  id: string;
  student_id: string;
  section_id: string;
  status: string;
};

function existingRows(spec: Spec, parentId: string): FiledRow[] {
  return sqlRows(`select id, student_id, section_id, status from student_declarations
     where filed_by = '${parentId}' and declaration_type = '${spec.type}'
       and start_date = '${spec.start}' and end_date = '${spec.end}'
       and student_id in (${spec.children.map((c) => q(c.studentId)).join(',')})
     order by student_id`).map(([id, student_id, section_id, status]) => ({
    id,
    student_id,
    section_id,
    status,
  }));
}

/**
 * Removes filings whose ladders did not all open: first any approval request
 * already opened for them (its stages go with it, ON DELETE CASCADE), then the
 * rows — so a re-filing never leaves an orphaned ladder behind.
 */
async function takeBackOut(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sb = service();
  const { error: reqErr } = await sb
    .from('approval_requests')
    .delete()
    .eq('subject_type', 'student_declaration')
    .in('subject_id', ids);
  if (reqErr)
    throw new Error(`declarations: remove opened ladders: ${reqErr.message}`);
  const { error } = await sb
    .from('student_declarations')
    .delete()
    .in('id', ids);
  if (error) throw new Error(`declarations: remove filings: ${error.message}`);
}

/** POST /api/parent/v2/declarations, mirrored for one submission. */
async function file(spec: Spec, parentId: string): Promise<FiledRow[]> {
  const sb = service();
  const session = await parentSession(spec.children[0].parentEmail);
  const students = await loadFilableStudents(sb, session.email);
  const byNumber = new Map(students.map((s) => [s.studentNumber, s]));
  const resolved: LinkedStudent[] = spec.children.map((c) => {
    const hit = byNumber.get(c.studentNumber);
    if (!hit)
      throw new Error(
        `declarations: ${c.studentNumber} is not on ${session.email}'s account (the route 403s)`
      );
    return hit;
  });

  // The certificate goes up first, as the portal uploads it before filing.
  const evidencePath =
    spec.evidence === 'file' || spec.evidence === 'both'
      ? `declarations/${session.userId}/${uuidFrom(`declarations:evidence:${spec.key}`)}.pdf`
      : undefined;
  const evidenceUrl =
    spec.evidence === 'link' || spec.evidence === 'both'
      ? certificateLink(spec.key)
      : undefined;
  if (evidencePath) await upload(evidencePath);

  const input = fileDeclarationSchema(spec.filedOn).parse(
    spec.type === 'absence'
      ? {
          declarationType: 'absence',
          studentNumbers: resolved.map((s) => s.studentNumber),
          startDate: spec.start,
          endDate: spec.end,
          withMedical: spec.withMedical,
          ...(evidencePath ? { evidencePath } : {}),
          ...(evidenceUrl ? { evidenceUrl } : {}),
          ...(spec.parentNote ? { parentNote: spec.parentNote } : {}),
        }
      : {
          declarationType: 'travel',
          studentNumbers: resolved.map((s) => s.studentNumber),
          startDate: spec.start,
          endDate: spec.end,
          destinationCountry: 'Philippines',
          ...(spec.destinationCity
            ? { destinationCity: spec.destinationCity }
            : {}),
          ...(spec.parentNote ? { parentNote: spec.parentNote } : {}),
        }
  );
  if (
    input.declarationType === 'absence' &&
    input.evidencePath &&
    !input.evidencePath.startsWith(`declarations/${session.userId}/`)
  )
    throw new Error('declarations: evidence outside the parent folder');

  const opens = await filingCoversAnySchoolDay(sb, {
    startDate: input.startDate,
    endDate: input.endDate,
    children: resolved.map((s) => ({
      academicYearId: s.academicYearId,
      levelType: s.levelType,
    })),
  });
  if (!opens)
    throw new Error(
      `declarations: ${spec.key} covers no school day (the route 400s)`
    );
  const clashes = await findOverlappingFilings(sb, {
    startDate: input.startDate,
    endDate: input.endDate,
    declarationType: input.declarationType,
    children: resolved.map((s) => ({
      studentId: s.studentId,
      studentName: s.displayName,
    })),
  });
  if (clashes.length > 0)
    throw new Error(
      `declarations: ${spec.key} overlaps a live filing (the route 409s): ${JSON.stringify(clashes)}`
    );

  const filingGroupId = uuidFrom(`declarations:group:${spec.key}`);
  // The route's `new Date()`, simulated: the moment the parent filed.
  const now = new Date(
    `${spec.filedOn}T${spec.filedAt}:00+08:00`
  ).toISOString();
  const rows = resolved.map((student) => ({
    filing_group_id: filingGroupId,
    declaration_type: input.declarationType,
    student_id: student.studentId,
    section_student_id: student.sectionStudentId,
    section_id: student.sectionId,
    academic_year_id: student.academicYearId,
    start_date: input.startDate,
    end_date: input.endDate,
    with_medical:
      input.declarationType === 'absence' ? input.withMedical : null,
    evidence_path:
      input.declarationType === 'absence' ? (input.evidencePath ?? null) : null,
    evidence_url:
      input.declarationType === 'absence' ? (input.evidenceUrl ?? null) : null,
    destination_country:
      input.declarationType === 'travel' ? input.destinationCountry : null,
    destination_city:
      input.declarationType === 'travel'
        ? (input.destinationCity ?? null)
        : null,
    parent_note: input.parentNote ?? null,
    status: 'pending' as const,
    filed_by: session.userId,
    filed_by_email: session.email,
    created_at: now,
    updated_at: now,
  }));
  const inserted = (await must(
    `declarations: insert ${spec.key}`,
    sb
      .from('student_declarations')
      .insert(rows)
      .select('id, student_id, section_id, status')
  )) as FiledRow[];

  const byStudentId = new Map(resolved.map((s) => [s.studentId, s]));
  try {
    const ladders = await openDeclarationApprovals(
      sb,
      inserted.map((row) => ({
        id: row.id,
        sectionId: row.section_id,
        levelType: byStudentId.get(row.student_id)?.levelType ?? null,
      })),
      { id: session.userId, email: session.email }
    );
    if (ladders.unconfigured > 0)
      throw new Error('no approval steps configured (run pull-config)');
  } catch (e) {
    // The route takes the rows back out — and, for a two-child filing whose
    // second ladder failed, the first child's ladder with them.
    await takeBackOut(inserted.map((row) => row.id));
    throw e;
  }
  await fileAudit(spec, inserted, resolved, session, filingGroupId);
  return inserted;
}

/** The route's `declaration.file` rows (presence only for note + evidence). */
async function fileAudit(
  spec: Spec,
  rows: FiledRow[],
  resolved: LinkedStudent[],
  session: { userId: string; email: string },
  filingGroupId: string
): Promise<void> {
  const byStudentId = new Map(resolved.map((s) => [s.studentId, s]));
  const isAbsence = spec.type === 'absence';
  const hasPath = spec.evidence === 'file' || spec.evidence === 'both';
  const hasUrl = spec.evidence === 'link' || spec.evidence === 'both';
  await logActions(
    service(),
    { id: session.userId, email: session.email, role: null },
    rows.map((row) => {
      const student = byStudentId.get(row.student_id);
      return {
        action: 'declaration.file' as const,
        entityType: 'student_declaration' as const,
        entityId: row.id,
        context: {
          filed_by: 'parent',
          status: 'pending',
          filing_group_id: filingGroupId,
          children_in_filing: rows.length,
          declaration_type: spec.type,
          student_id: row.student_id,
          student_number: student?.studentNumber ?? null,
          student_name: student?.displayName ?? null,
          section_student_id: student?.sectionStudentId ?? null,
          section_id: row.section_id,
          section_name: student?.sectionName ?? null,
          start_date: spec.start,
          end_date: spec.end,
          with_medical: isAbsence ? spec.withMedical : null,
          evidence_kind: !isAbsence
            ? null
            : hasPath && hasUrl
              ? 'both'
              : hasPath
                ? 'file'
                : hasUrl
                  ? 'link'
                  : null,
          parent_note_present: spec.parentNote != null,
          approval_steps_configured: true,
        },
      };
    })
  );
}

// ── Deciding ──────────────────────────────────────────────────────────────

const REJECT_NOTE: Record<'fca' | 'oic', string> = {
  fca: '<p>Please send the medical certificate for this day — without it the absence cannot be excused.</p>',
  oic: '<p>The certificate attached is dated for a different week. Please upload the one that covers these dates.</p>',
};

/** POST /api/approvals/[requestId]/decide, mirrored for one step. */
async function decide(
  requestId: string,
  actor: DecideActor,
  body: { action: 'approve' | 'reject'; note?: string }
): Promise<string> {
  const parsed = DecideApprovalSchema.parse(body);
  const res = await decideApproval({
    service: service(),
    actor,
    requestId,
    action: parsed.action,
    note: parsed.note && parsed.note.length > 0 ? parsed.note : null,
    via: 'in_app',
  });
  if (!res.ok)
    throw new Error(
      `declarations: decide ${requestId} as ${actor.email}: ${res.status} ${JSON.stringify(res.body)}`
    );
  return String(res.body.outcome);
}

/** The planned steps for one declaration, in order. */
function stepsFor(
  spec: Spec,
  child: Child
): Array<{
  stage: number;
  actor: DecideActor;
  action: 'approve' | 'reject';
  note?: string;
}> {
  const fca: DecideActor = {
    id: child.adviserId,
    email: child.adviserEmail,
    role: 'teacher',
  };
  const oic = staffActor(OIC[child.half]);
  switch (spec.outcome) {
    case 'approved':
      return [
        { stage: 1, actor: fca, action: 'approve' },
        { stage: 2, actor: oic, action: 'approve' },
      ];
    case 'rejected-fca':
      return [
        { stage: 1, actor: fca, action: 'reject', note: REJECT_NOTE.fca },
      ];
    case 'rejected-oic':
      return [
        { stage: 1, actor: fca, action: 'approve' },
        { stage: 2, actor: oic, action: 'reject', note: REJECT_NOTE.oic },
      ];
    case 'pending-fca':
      return [];
    case 'pending-oic':
      return [{ stage: 1, actor: fca, action: 'approve' }];
  }
}

async function runLadder(
  spec: Spec,
  row: FiledRow,
  child: Child
): Promise<number> {
  const sb = service();
  const [request] = await must(
    `declarations: request for ${row.id}`,
    sb
      .from('approval_requests')
      .select('id, status')
      .eq('subject_type', 'student_declaration')
      .eq('subject_id', row.id)
  );
  let made = 0;
  for (const step of stepsFor(spec, child)) {
    const [stage] = await must(
      `declarations: stage ${step.stage} of ${request.id}`,
      sb
        .from('approval_request_stages')
        .select('status')
        .eq('request_id', request.id)
        .eq('stage_order', step.stage)
    );
    const [{ status: reqStatus }] = await must(
      'declarations: request status',
      sb.from('approval_requests').select('status').eq('id', request.id)
    );
    if (stage.status !== 'pending' || reqStatus !== 'pending') continue;
    await decide(request.id, step.actor, {
      action: step.action,
      ...(step.note ? { note: step.note } : {}),
    });
    made++;
  }
  // A decision whose follow-up never ran leaves the parent's copy behind.
  const [{ status: finalReq }] = await must(
    'declarations: request status',
    sb.from('approval_requests').select('status').eq('id', request.id)
  );
  const [{ status: declStatus }] = await must(
    'declarations: declaration status',
    sb.from('student_declarations').select('status').eq('id', row.id)
  );
  // approval_requests.status is pending / approved / rejected / cancelled —
  // the same words the declaration uses.
  const want = finalReq;
  if (declStatus !== want)
    throw new Error(
      `declarations: ${row.id} is ${declStatus} but its request is ${finalReq} — run scripts/repair-declaration-approvals.ts`
    );
  // An approval whose register write never landed (a run that died after the
  // last decision, or a write the handler recorded as failed): run the app's
  // own register writer as the officer in charge who gave that approval, as
  // the handler does after the last step.
  if (finalReq === 'approved') {
    const [[written]] = sqlRows(
      `select register_written_at is not null from student_declarations where id = ${q(row.id)}`
    );
    if (written !== 't') {
      const write = await writeRegisterForDeclaration(
        sb,
        row.id,
        staffActor(OIC[child.half])
      );
      if (!write.ok)
        throw new Error(
          `declarations: register write for ${row.id}: ${write.error}`
        );
    }
  }
  return made;
}

// ── The school's own certificate ─────────────────────────────────────────

/** POST /api/declarations/staff, mirrored. Returns what it did. */
async function staffCertificate(
  actorKey: { id: string; email: string; role: Role },
  sectionStudentId: string,
  startDate: string,
  endDate: string,
  recordedOn: string,
  evidence: { path?: string; url?: string }
): Promise<'created' | 'attached' | 'already' | 'audit repaired'> {
  const sb = service();
  const input = staffMedicalCertificateSchema(recordedOn).parse({
    sectionStudentId,
    startDate,
    endDate,
    ...(evidence.path ? { evidencePath: evidence.path } : {}),
    ...(evidence.url ? { evidenceUrl: evidence.url } : {}),
  });
  if (
    input.evidencePath &&
    !isOwnStaffEvidencePath(actorKey.id, input.evidencePath)
  )
    throw new Error('declarations: staff evidence outside the caller folder');
  const target = await resolveFilingTarget(sb, input.sectionStudentId);
  if (!target) throw new Error('declarations: staff filing target not found');
  const access = await assertCanMarkRegisterForSection(
    sb,
    { userId: actorKey.id, role: actorKey.role },
    target.sectionId
  );
  if (!access.ok)
    throw new Error(`declarations: staff filing refused: ${access.reason}`);
  const opens = await filingCoversAnySchoolDay(sb, {
    startDate: input.startDate,
    endDate: input.endDate,
    children: [
      {
        academicYearId: target.academicYearId,
        levelType: levelTypeForAudienceLookup(target.levelCode),
      },
    ],
  });
  if (!opens)
    throw new Error('declarations: staff filing covers no school day');

  const evidenceKind =
    input.evidencePath && input.evidenceUrl
      ? 'both'
      : input.evidencePath
        ? 'file'
        : 'link';
  const who = {
    student_id: target.studentId,
    student_number: target.studentNumber,
    section_student_id: target.sectionStudentId,
    section_id: target.sectionId,
    student_name: target.studentName,
    section_name: target.className ?? target.sectionName,
  };
  const actor = { id: actorKey.id, email: actorKey.email, role: actorKey.role };

  const existing = await findFilingCoveringDays(sb, {
    studentId: target.studentId,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  if (existing) {
    // The certificate joins the filing already there; one already carrying
    // proof is the route's 409 (a re-run lands here).
    if (existing.declarationType === 'travel')
      throw new Error(
        'declarations: a travel filing covers that day (the route 409s)'
      );
    if (existing.hasEvidence) {
      // Done by an earlier run. If that run died between the write and the
      // route's audit row, the change has no trace: write the row now. The
      // school's own filing (filed by this adviser) carries
      // `declaration.file.staff`; a parent's filing the certificate joined
      // carries `declaration.evidence.attach`.
      const [[filedBy, status, start, end]] = sqlRows(
        `select filed_by, status, start_date::text, end_date::text from student_declarations where id = ${q(existing.id)}`
      );
      const ownFiling = filedBy === actorKey.id;
      const action = ownFiling
        ? 'declaration.file.staff'
        : 'declaration.evidence.attach';
      const logged = Number(
        sqlRows(`select count(*) from audit_log where action = '${action}'
                  and entity_id = ${q(existing.id)}`)[0][0]
      );
      if (logged > 0) return 'already';
      await logAction({
        service: sb,
        actor,
        action,
        entityType: 'student_declaration',
        entityId: existing.id,
        context: ownFiling
          ? {
              recorded_by_school: true,
              status: 'approved',
              declaration_type: 'absence',
              with_medical: true,
              evidence_kind: evidenceKind,
              ...who,
              start_date: input.startDate,
              end_date: input.endDate,
            }
          : {
              recorded_by_school: true,
              attached_to_existing: true,
              status,
              declaration_type: 'absence',
              with_medical: true,
              evidence_kind: evidenceKind,
              ...who,
              start_date: start,
              end_date: end,
            },
      });
      return 'audit repaired';
    }
    const attached = await attachEvidenceToFiling(sb, {
      filingId: existing.id,
      evidencePath: input.evidencePath ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      replace: false,
    });
    if (!attached.attached)
      throw new Error(
        `declarations: certificate not attached to ${existing.id} (it gained evidence meanwhile)`
      );
    await logAction({
      service: sb,
      actor,
      action: 'declaration.evidence.attach',
      entityType: 'student_declaration',
      entityId: existing.id,
      context: {
        recorded_by_school: true,
        attached_to_existing: true,
        status: attached.status,
        declaration_type: 'absence',
        with_medical: true,
        evidence_kind: evidenceKind,
        ...who,
        start_date: attached.startDate,
        end_date: attached.endDate,
      },
    });
    return 'attached';
  }

  const now = new Date(`${recordedOn}T15:20:00+08:00`).toISOString();
  const [saved] = await must(
    'declarations: staff filing insert',
    sb
      .from('student_declarations')
      .insert({
        filing_group_id: uuidFrom(
          `declarations:staff:${sectionStudentId}:${startDate}`
        ),
        declaration_type: 'absence',
        student_id: target.studentId,
        section_student_id: target.sectionStudentId,
        section_id: target.sectionId,
        academic_year_id: target.academicYearId,
        start_date: input.startDate,
        end_date: input.endDate,
        with_medical: true,
        evidence_path: input.evidencePath ?? null,
        evidence_url: input.evidenceUrl ?? null,
        destination_country: null,
        destination_city: null,
        parent_note: null,
        status: 'approved',
        filed_by: actorKey.id,
        filed_by_email: actorKey.email.trim().toLowerCase(),
        register_written_at: null,
        register_days_written: null,
        register_write_error: null,
        created_at: now,
        updated_at: now,
      })
      .select('id')
  );
  await logAction({
    service: sb,
    actor,
    action: 'declaration.file.staff',
    entityType: 'student_declaration',
    entityId: saved.id as string,
    context: {
      recorded_by_school: true,
      status: 'approved',
      declaration_type: 'absence',
      with_medical: true,
      evidence_kind: evidenceKind,
      ...who,
      start_date: input.startDate,
      end_date: input.endDate,
    },
  });
  return 'created';
}

// ── Run ───────────────────────────────────────────────────────────────────

export async function runDeclarations(): Promise<void> {
  const children = loadChildren();
  const specs = planDeclarations(children);
  const sb = service();
  let filed = 0;
  let refiled = 0;
  let audited = 0;
  let steps = 0;
  for (const spec of specs.sort(
    (a, b) =>
      `${a.filedOn} ${a.filedAt}`.localeCompare(`${b.filedOn} ${b.filedAt}`) ||
      a.key.localeCompare(b.key)
  )) {
    const parentId = await ensureParent(spec.children[0].parentEmail);
    let rows = existingRows(spec, parentId);
    if (rows.length > 0) {
      const opened = sqlRows(`select count(*) from approval_requests
         where subject_type = 'student_declaration' and subject_id in (${rows.map((x) => q(x.id)).join(',')})`)[0][0];
      if (Number(opened) < rows.length) {
        // Filed, but a ladder never opened: what the route does when that
        // step fails — take the rows (and any ladder that did open) back
        // out — then file again.
        await takeBackOut(rows.map((x) => x.id));
        rows = [];
        refiled++;
      } else if (
        Number(
          sqlRows(`select count(*) from audit_log where action = 'declaration.file'
             and entity_id in (${rows.map((x) => q(x.id)).join(',')})`)[0][0]
        ) < rows.length
      ) {
        // On the ladder, but the route's audit rows never landed.
        const session = await parentSession(spec.children[0].parentEmail);
        const resolved = (await loadFilableStudents(sb, session.email)).filter(
          (s) => spec.children.some((c) => c.studentId === s.studentId)
        );
        await fileAudit(
          spec,
          rows,
          resolved,
          session,
          uuidFrom(`declarations:group:${spec.key}`)
        );
        audited++;
      }
    }
    if (rows.length === 0) {
      rows = await file(spec, parentId);
      filed += rows.length;
    }
    for (const row of rows) {
      const child = spec.children.find((c) => c.studentId === row.student_id)!;
      steps += await runLadder(spec, row, child);
    }
  }

  // The school's own certificates, as the class's form adviser.
  const pending = specs.find((s) => s.outcome === 'pending-fca')!;
  const used = new Set(
    specs.flatMap((s) => s.children.map((c) => c.studentId))
  );
  const recordFor = rng('declarations:staff').shuffle(
    children.filter(
      (c) => !used.has(c.studentId) && runs(c, illDay).some((x) => x.days === 1)
    )
  )[0];
  const staffResults: string[] = [];
  if (recordFor) {
    const run = runs(recordFor, illDay).find((x) => x.days === 1)!;
    const adviser = {
      id: recordFor.adviserId,
      email: recordFor.adviserEmail,
      role: 'teacher' as Role,
    };
    const path = `${staffEvidencePrefix(adviser.id)}${uuidFrom(`declarations:staff-evidence:${recordFor.studentNumber}`)}.pdf`;
    await upload(path);
    staffResults.push(
      `${recordFor.studentNumber} ${run.start}: ${await staffCertificate(adviser, recordFor.enrolmentId, run.start, run.end, shift(run.start, 2), { path })}`
    );
  }
  {
    const c = pending.children[0];
    staffResults.push(
      `${c.studentNumber} ${pending.start} (attach to the pending filing): ${await staffCertificate(
        { id: c.adviserId, email: c.adviserEmail, role: 'teacher' },
        c.enrolmentId,
        pending.start,
        pending.end,
        shift(pending.filedOn, 1),
        { url: certificateLink(`staff:${c.studentNumber}`) }
      )}`
    );
  }

  console.log(
    `  parent filings: ${specs.length} submissions / ${specs.reduce((n, s) => n + s.children.length, 0)} declarations planned; ${filed} declarations filed now${refiled ? ` (${refiled} re-filed after a ladder that never opened)` : ''}${audited ? `, ${audited} missing declaration.file audits written` : ''}; ${steps} approval steps decided now`
  );
  console.log(`  school-recorded certificates: ${staffResults.join('; ')}`);
}
