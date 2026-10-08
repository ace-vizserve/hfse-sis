// Phase "portal-drafts" (plan phase 7): the parent portal's saved
// applications (`application_drafts`) and its completion links
// (`enrolment_recovery_tokens`).
//
// Production (prod-profile.md): 21 drafts — `hfse-is` 12 (AY2027 mostly
// parked on the upload-requirements step: 8 upload-requirements, 2
// student-info, 1 family-info; one AY2026 upload-requirements) and
// `hfse-is-reenrol` 9 (AY2027, no tab); 9 recovery tokens, every one for a
// record missing its applications row, mostly New AY2027 (2 used, 6
// notified). Locally: 10 drafts (hfse-is 6: 3 + 1 AY2026 upload-requirements,
// 1 student-info, 1 family-info; hfse-is-reenrol 4) and 5 tokens (AY2027 New
// x4 — one used — and AY2026 Current x1 used; 3 notified).
//
// Write path: the PORTAL owns both tables (../app-online-admission:
// `saveDraftRemote` / `saveReenrolDraftRemote` in src/actions/drafts.ts, the
// `recovery-link` edge function), and nothing in this app writes or reads
// them — so the rows are inserted directly, in the shape those writers
// produce: a draft belongs to a parent's own login (`user_id`, the FK to
// auth.users; created with `ensureParent`, marked so the wipe removes it), its
// `form_state` is the wizard's nested state (`studentInfo` / `familyInfo` /
// `enrollmentInfo` / `uploadRequirements`, filled up to the step reached;
// keys from the portal's zod schemas), `expires_at` is 30 days after the
// last save (DRAFT_EXPIRY_DAYS); a re-enrolment draft is keyed by the child's
// AY2026 enrolee number and carries no tab. A token names the enrolee, the
// missing tables, the admin who generated it and a 7-day expiry
// (TOKEN_TTL_DAYS). New-applicant families are invented (no admissions record
// yet — that is why a draft exists). A recovery link exists because a
// submission landed half-way, so each unused token's child is a PARTIAL
// AY2027 record, written here: a status row and a documents row, and NO
// applications row — exactly what the portal's `recovery-link` function's
// `missingTables` reads as `{applications}`, as every production token is.
// Used tokens point at a record the parent has since completed.
//
// Timestamps: tokens are anchored on TODAY. Drafts are anchored on the REAL
// run date (lib/constants.ts lists it) — a draft lives 30 days after its last
// save, and one dated from TODAY would have expired a few days after
// 2026-10-07. The verify fingerprint compares their spacing, not the dates.
// Idempotent: upserts on fixed ids; a partial record is written only when its
// enrolee has no status row yet.

import { TODAY, runDateSg } from '../lib/constants';
import { must, service, sqlRows } from '../lib/local';
import {
  ADULT_FEMALE_NAMES,
  CHILD_FIRST_NAMES,
  FAMILY_NAMES,
} from '../lib/names';
import { rng, uuidFrom } from '../lib/random';
import { ensureParent } from './declarations';
import { STAFF, emailOf } from './staff';

const DAY = 86_400_000;
const before = (anchor: string, daysBefore: number, hourUtc: number) =>
  new Date(
    Date.parse(`${anchor}T00:00:00Z`) - daysBefore * DAY + hourUtc * 3_600_000
  ).toISOString();
/** A token moment, anchored on TODAY. */
const at = (daysBeforeToday: number, hourUtc: number) =>
  before(TODAY, daysBeforeToday, hourUtc);
/** A draft moment, anchored on the real run date (see the header). */
const draftAt = (daysBeforeRun: number, hourUtc: number) =>
  before(runDateSg(), daysBeforeRun, hourUtc);
const plus = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * DAY).toISOString();

const TAB = (t: string) => `/enrol-student/new/${t}`;
const STEPS = [
  'student-info',
  'family-info',
  'enrollment-info',
  'upload-requirements',
];

type NewDraft = {
  key: string;
  ay: 'ay2026' | 'ay2027';
  tab: string;
  savedDaysAgo: number;
};
const NEW_DRAFTS: NewDraft[] = [
  { key: 'n1', ay: 'ay2027', tab: 'upload-requirements', savedDaysAgo: 3 },
  { key: 'n2', ay: 'ay2027', tab: 'upload-requirements', savedDaysAgo: 9 },
  { key: 'n3', ay: 'ay2027', tab: 'upload-requirements', savedDaysAgo: 17 },
  { key: 'n4', ay: 'ay2026', tab: 'upload-requirements', savedDaysAgo: 24 },
  { key: 'n5', ay: 'ay2027', tab: 'student-info', savedDaysAgo: 5 },
  { key: 'n6', ay: 'ay2027', tab: 'family-info', savedDaysAgo: 12 },
];
const REENROL_DRAFTS = 4;

/** An invented family: the child, the mother (who holds the login). */
function family(key: string) {
  const r = rng(`portal-drafts:family:${key}`);
  const last = r.pick(FAMILY_NAMES);
  const child = r.pick(CHILD_FIRST_NAMES);
  const mother = r.pick(ADULT_FEMALE_NAMES);
  const email = `${mother}.${last}${r.int(10, 99)}@example.com`
    .toLowerCase()
    .replace(/[^a-z0-9.@]/g, '');
  const birth = `${r.int(2013, 2020)}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`;
  return { r, last, child, mother, email, birth };
}

function newFormState(
  f: ReturnType<typeof family>,
  stepIndex: number
): Record<string, unknown> {
  const state: Record<string, unknown> = {
    studentInfo: {
      studentDetails: {
        isValid: stepIndex > 0,
        firstName: f.child,
        middleName: '',
        lastName: f.last,
        preferredName: f.child,
        birthDay: f.birth,
        gender: f.r.pick(['Male', 'Female']),
        primaryLanguage: 'English',
        religion: f.r.pick(['Christianity', 'Buddhism', 'Islam', 'None']),
        nric: '',
      },
      addressContact:
        stepIndex > 0
          ? {
              isValid: true,
              homeAddress: `${f.r.int(1, 480)} Clementi Ave 4`,
              postalCode: String(f.r.int(100000, 829999)),
              nationality: f.r.pick([
                'Filipino',
                'Indian',
                'Singaporean',
                'Indonesian',
              ]),
              homePhone: `+65 ${f.r.int(8000, 9999)} ${f.r.int(1000, 9999)}`,
              livingWithWhom: 'Both parents',
              parentMaritalStatus: 'Married',
            }
          : {},
    },
  };
  if (stepIndex >= 1)
    state.familyInfo = {
      motherInfo: {
        isValid: stepIndex > 1,
        motherFirstName: f.mother,
        motherLastName: f.last,
        motherEmail: f.email,
        motherMobile: `+65 ${f.r.int(8000, 9999)} ${f.r.int(1000, 9999)}`,
        motherNationality: 'Filipino',
      },
      fatherInfo: stepIndex > 1 ? { isValid: true } : {},
      guardianInfo: {},
      siblingsInfo: {},
    };
  if (stepIndex >= 2)
    state.enrollmentInfo = {
      isValid: true,
      levelApplied: f.r.pick([
        'Primary 1',
        'Primary 3',
        'Secondary 1',
        'Youngstarters',
      ]),
      classType: 'Global',
      preferredSchedule: 'Morning',
      availSchoolBus: 'No',
      availStudentCare: 'No',
      paymentOption: 'Annual',
      discount: '',
      contractSignatory: 'Mother',
      preferredPaymentScheme: 'Full payment',
      preferredPaymentMethod: 'Bank transfer',
    };
  if (stepIndex >= 3)
    state.uploadRequirements = {
      studentUploadRequirements: {
        idPicture: null,
        birthCert: null,
        passport: null,
      },
      parentGuardianUploadRequirements: { motherPassport: null },
    };
  return state;
}

export async function runPortalDrafts(): Promise<void> {
  const sb = service();
  const drafts: Record<string, unknown>[] = [];

  for (const d of NEW_DRAFTS) {
    const f = family(d.key);
    const userId = await ensureParent(f.email);
    const step = STEPS.indexOf(d.tab);
    const saved = draftAt(d.savedDaysAgo, 3);
    const created = plus(saved, -f.r.int(0, 6));
    const draftId = uuidFrom(`portal-drafts:draft:${d.key}`);
    drafts.push({
      draft_id: draftId,
      user_id: userId,
      type: 'hfse-is',
      academic_year: d.ay,
      form_state: { draftId, createdAt: created, ...newFormState(f, step) },
      current_tab: TAB(d.tab),
      active_tab: TAB(d.tab),
      completed_tabs: STEPS.slice(0, step).map(TAB),
      created_at: created,
      last_saved_at: saved,
      expires_at: plus(saved, 30),
    });
  }

  // Re-enrolment drafts: AY2026 Current children with no AY2027 application yet.
  const apps26 = (await must(
    'portal-drafts: AY2026 applications',
    sb
      .from('ay2026_enrolment_applications')
      .select(
        '"enroleeNumber","studentNumber","firstName","lastName","motherEmail","levelApplied",category'
      )
      .eq('category', 'Current')
  )) as Array<Record<string, string | null>>;
  const status26 = new Set(
    (
      (await must(
        'portal-drafts: AY2026 status',
        sb
          .from('ay2026_enrolment_status')
          .select('"enroleeNumber"')
          .eq('applicationStatus', 'Enrolled')
      )) as { enroleeNumber: string }[]
    ).map((r) => r.enroleeNumber)
  );
  const next = new Set(
    (
      (await must(
        'portal-drafts: AY2027 applications',
        sb.from('ay2027_enrolment_applications').select('"studentNumber"')
      )) as { studentNumber: string | null }[]
    ).map((r) => r.studentNumber)
  );
  const eligible = apps26
    .filter(
      (a) =>
        a.enroleeNumber &&
        status26.has(a.enroleeNumber) &&
        !next.has(a.studentNumber) &&
        /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(a.motherEmail?.trim() ?? '')
    )
    .sort((x, y) => x.enroleeNumber!.localeCompare(y.enroleeNumber!));
  const reenrol = rng('portal-drafts:reenrol')
    .shuffle(eligible)
    .slice(0, REENROL_DRAFTS);
  for (const [i, a] of reenrol.entries()) {
    const userId = await ensureParent(a.motherEmail!.trim().toLowerCase());
    const saved = draftAt(2 + i * 6, 4);
    drafts.push({
      draft_id: uuidFrom(`portal-drafts:reenrol:${a.enroleeNumber}`),
      user_id: userId,
      type: 'hfse-is-reenrol',
      enrolee_number: a.enroleeNumber,
      academic_year: 'ay2027',
      form_state: {
        studentInfo: {
          studentDetails: {
            isValid: true,
            firstName: a.firstName,
            lastName: a.lastName,
          },
        },
        enrollmentInfo: {
          levelApplied: a.levelApplied,
          preferredSchedule: 'Morning',
        },
      },
      // The re-enrolment writer carries no tab; created_at drifts to the last save.
      current_tab: null,
      active_tab: null,
      completed_tabs: [],
      created_at: saved,
      last_saved_at: saved,
      expires_at: plus(saved, 30),
    });
  }
  await must(
    'portal-drafts: upsert drafts',
    sb
      .from('application_drafts')
      .upsert(drafts, { onConflict: 'draft_id' })
      .select('draft_id')
  );

  // ── Recovery tokens ──
  const admin = emailOf(STAFF.find((s) => s.key === 'admissions')!);
  const usedNew = (await must(
    'portal-drafts: AY2027 New',
    sb
      .from('ay2027_enrolment_applications')
      .select('"enroleeNumber","studentNumber","enroleeFullName","motherEmail"')
      .eq('category', 'New')
      .order('enroleeNumber')
      .limit(1)
  )) as Array<Record<string, string | null>>;
  const usedCur = apps26
    .filter((a) => a.enroleeNumber && status26.has(a.enroleeNumber))
    .sort((x, y) => x.enroleeNumber!.localeCompare(y.enroleeNumber!))[0];
  type Tok = {
    key: string;
    ay: string;
    enrolee: string;
    studentNumber: string | null;
    category: string;
    name: string | null;
    createdDaysAgo: number;
    used: boolean;
    notifyTo: string | null;
  };
  const invented = (k: string, n: number): Tok => {
    const f = family(`token:${k}`);
    return {
      key: k,
      ay: 'ay2027',
      enrolee: `E2700${40 + n}`,
      studentNumber: `H2700${40 + n}`,
      category: 'New',
      name: `${f.child} ${f.last}`,
      createdDaysAgo: [2, 4, 6][n],
      used: false,
      notifyTo: n === 1 ? f.email : null,
    };
  };
  const toks: Tok[] = [invented('a', 0), invented('b', 1), invented('c', 2)];
  let partials = 0;
  for (const t of toks) partials += await ensurePartialRecord(t);
  if (usedNew[0])
    toks.push({
      key: 'used-new',
      ay: 'ay2027',
      enrolee: usedNew[0].enroleeNumber!,
      studentNumber: usedNew[0].studentNumber,
      category: 'New',
      name: usedNew[0].enroleeFullName,
      createdDaysAgo: 40,
      used: true,
      notifyTo: usedNew[0].motherEmail,
    });
  if (usedCur)
    toks.push({
      key: 'used-current',
      ay: 'ay2026',
      enrolee: usedCur.enroleeNumber!,
      studentNumber: usedCur.studentNumber,
      category: 'Current',
      name:
        [usedCur.firstName, usedCur.lastName].filter(Boolean).join(' ') || null,
      createdDaysAgo: 75,
      used: true,
      notifyTo: usedCur.motherEmail,
    });
  const rows = toks.map((t) => {
    const created = at(t.createdDaysAgo, 2);
    return {
      token: uuidFrom(`portal-drafts:token:${t.key}`),
      academic_year: t.ay,
      enrolee_number: t.enrolee,
      student_number: t.studentNumber,
      category: t.category,
      missing_tables: ['applications'],
      created_by: admin,
      created_at: created,
      expires_at: plus(created, 7),
      used_at: t.used ? plus(created, 2) : null,
      sections: ['studentInfo', 'familyInfo', 'enrollmentInfo', 'uploads'],
      notified_email: t.notifyTo,
      notified_at: t.notifyTo ? plus(created, 0.01) : null,
      student_name: t.name,
    };
  });
  await must(
    'portal-drafts: upsert tokens',
    sb
      .from('enrolment_recovery_tokens')
      .upsert(rows, { onConflict: 'token' })
      .select('token')
  );
  console.log(
    `  application_drafts ${drafts.length} (hfse-is ${NEW_DRAFTS.length}, hfse-is-reenrol ${reenrol.length}); enrolment_recovery_tokens ${rows.length}; partial AY2027 records (status + documents, no application) written now: ${partials}`
  );
}

/**
 * The half-landed submission an unused recovery link exists for: the portal
 * wrote the status row and the documents row (the ID picture and birth
 * certificate went up), and the applications row never landed. Written once,
 * a day before the admissions officer generated the link. Returns 1 when it
 * wrote the record, 0 when it was already there.
 */
async function ensurePartialRecord(t: {
  key: string;
  enrolee: string;
  studentNumber: string | null;
  name: string | null;
  createdDaysAgo: number;
}): Promise<number> {
  const sb = service();
  const [[hasDocs, hasStatus]] = sqlRows(
    `select (select count(*) from ay2027_enrolment_documents where "enroleeNumber" = '${t.enrolee}'),
            (select count(*) from ay2027_enrolment_status where "enroleeNumber" = '${t.enrolee}')`
  );
  if (Number(hasDocs) > 0 && Number(hasStatus) > 0) return 0;
  const r = rng(`portal-drafts:partial:${t.key}`);
  const submitted = at(t.createdDaysAgo + 1, r.int(1, 12));
  const ms = Date.parse(submitted);
  const url = (slot: string, ext: string) =>
    `http://127.0.0.1:54321/storage/v1/object/public/parent-portal/ay2027/documents/${ms}_${t.enrolee}_${slot}.${ext}`;
  const level = r.pick(['Primary One', 'Primary Three', 'Secondary One']);
  // Documents first, then status; each only if not already there (a run that
  // died between the two).
  if (Number(hasDocs) === 0)
    await must(
      `portal-drafts: partial documents ${t.enrolee}`,
      sb
        .from('ay2027_enrolment_documents')
        .insert({
          created_at: submitted,
          studentNumber: t.studentNumber,
          enroleeNumber: t.enrolee,
          idPicture: url('idPicture', 'jpg'),
          idPictureStatus: 'Uploaded',
          idPictureUploadedDate: submitted.slice(0, 10),
          birthCert: url('birthCert', 'pdf'),
          birthCertStatus: 'Uploaded',
        })
        .select('id')
    );
  if (Number(hasStatus) === 0)
    await must(
      `portal-drafts: partial status ${t.enrolee}`,
      sb
        .from('ay2027_enrolment_status')
        .insert({
          created_at: submitted,
          enroleeNumber: t.enrolee,
          enroleeName: t.name,
          enroleeType: 'New',
          applicationStatus: 'Submitted',
          levelApplied: level,
        })
        .select('id')
    );
  return 1;
}
