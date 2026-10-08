// Row builders for the three admissions tables (`ay{YYYY}_enrolment_
// applications` / `_status` / `_documents`). The parent portal owns these
// tables, so the seeder writes them directly, as the portal would. Values are
// drawn from production's distributions per AY (./vocab.ts); free text is
// generated from templates; every contact is invented.
//
// A child's family (parents, address, siblings, passport) is drawn from a
// stream keyed on the CHILD, so a returning child brings the same family to
// every year's application. Per-year answers (class type, schedule, consents,
// the medical block) are drawn per application, so spelling drifts year to
// year as it does in production.

import { pickFrom, type Distribution } from '../lib/distribution';
import {
  ADULT_FEMALE_NAMES,
  ADULT_MALE_NAMES,
  FAMILY_NAMES,
} from '../lib/names';
import { rng, type Rng } from '../lib/random';
import { STAFF, emailOf } from '../phases/staff';
import {
  addDays,
  dateBetween,
  stampOn,
  type AppSpec,
  type Child,
} from './plan';
import {
  CLASS_TYPE,
  COMPANIES,
  CONTRACT_SIGNATORY,
  DISCOUNT1,
  DISCOUNT2,
  DISCOUNT3,
  FATHER_PASS,
  FEEDBACK_COMMENTS,
  GUARDIAN_NATIONALITY,
  HOW_DID_YOU_KNOW,
  LEARNING_NEEDS,
  LEVEL_LABEL,
  LIVING_WITH,
  MARITAL,
  MOTHER_PASS,
  PARENT_NATIONALITY,
  PARENT_RELIGION,
  PAYMENT_OPTION,
  POSITIONS,
  PREFERRED_SCHEDULE,
  PRIMARY_LANGUAGE,
  RELIGION,
  RELIGION_OTHER,
  STP_TYPE,
  STUDENT_PASS,
  YES_NO_BUS,
  YES_NO_CARE,
  YES_NO_UNIFORM,
  YS_LEVEL_APPLIED,
  AY2027_PROGRAMME_LABELS,
  type Ay,
} from './vocab';

type Row = Record<string, unknown>;

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const TODAY = '2026-10-07';

/** Admissions staff who stamp the `*Updatedby` columns. */
const ADMISSIONS_STAFF = STAFF.filter((s) =>
  ['admissions', 'documents', 'superadmin'].includes(s.key)
).map(emailOf);

// ── Small generators ──────────────────────────────────────────────────────

const mobile = (r: Rng) =>
  Number(`${r.pick(['8', '9'])}${pad(r.int(0, 9999999), 7)}`);
const letter = (r: Rng) => String.fromCharCode(65 + r.int(0, 25));
const nric = (r: Rng, prefix: string) =>
  `${prefix}${pad(r.int(0, 9999999), 7)}${letter(r)}`;
const passport = (r: Rng) => `P${pad(r.int(0, 9999999), 7)}${letter(r)}`;
const email = (r: Rng, first: string, last: string) =>
  `${first.split(' ')[0].toLowerCase()}.${last.toLowerCase().replace(/\s+/g, '')}${r.int(1, 99)}@example.com`;

const STREETS = [
  'Jurong West St 41',
  'Woodlands Drive 16',
  'Tampines Ave 5',
  'Bedok North Rd',
  'Yishun Ring Rd',
  'Punggol Field',
  'Sengkang East Way',
  'Choa Chu Kang Ave 3',
  'Bukit Batok West Ave 6',
  'Clementi Ave 4',
  'Ang Mo Kio Ave 10',
  'Hougang Ave 8',
  'Pasir Ris Drive 6',
  'Serangoon North Ave 1',
];

/** A fake storage URL: points at the local stack, never at a real file. */
function docUrl(ay: Ay, enrolee: string, slot: string, r: Rng): string {
  const ext = slot === 'idPicture' || slot === 'icaPhoto' ? 'jpg' : 'pdf';
  return `http://127.0.0.1:54321/storage/v1/object/public/parent-portal/${ay.toLowerCase()}/documents/${1700000000000 + r.int(0, 99999999999)}_${enrolee}_${slot}.${ext}`;
}

// ── The family (stable per child) ─────────────────────────────────────────

type Parent = {
  first: string;
  middle: string | null;
  last: string;
  preferred: string;
  birthDay: string;
  passport: string;
  passportExpiry: string;
  nric: string;
  passExpiry: string;
  company: string;
  position: string;
  nationality: string;
  religion: string;
  mobile: number;
  email: string;
};

type Sibling = {
  fullName: string;
  birthDay: string;
  religion: string;
  educationOccupation: string;
  schoolCompany: string;
};

export type Family = {
  father: Parent | null;
  mother: Parent;
  guardian: Parent | null;
  address: string;
  postalCode: number;
  homePhone: number;
  childNric: string;
  childPassport: string;
  childPassportExpiry: string;
  childPassExpiry: string;
  language: string;
  siblings: Sibling[];
  passCode: string;
  learningNeeds: string | null;
};

const families = new Map<string, Family>();

function parent(
  r: Rng,
  sex: 'M' | 'F',
  last: string,
  childYear: number
): Parent {
  const first = r.pick(sex === 'M' ? ADULT_MALE_NAMES : ADULT_FEMALE_NAMES);
  const by = childYear - r.int(26, 42);
  return {
    first,
    middle: r.chance(0.9) ? r.pick(FAMILY_NAMES) : null,
    last,
    preferred: first,
    birthDay: `${by}-${pad(r.int(1, 12), 2)}-${pad(r.int(1, 28), 2)}`,
    passport: passport(r),
    passportExpiry: dateBetween(r, '2027-01-01', '2035-12-31'),
    nric: nric(r, r.pick(['S', 'F', 'G', 'G'])),
    passExpiry: dateBetween(r, '2025-06-01', '2030-12-31'),
    company: r.pick(COMPANIES),
    position: r.pick(POSITIONS),
    nationality: pickFrom(r, PARENT_NATIONALITY),
    religion: pickFrom(r, PARENT_RELIGION),
    mobile: mobile(r),
    email: email(r, first, last),
  };
}

export function familyOf(child: Child): Family {
  const hit = families.get(child.key);
  if (hit) return hit;
  const r = rng(`people:family:${child.key}`);
  const childYear = Number(child.birthDay.slice(0, 4));
  const singleMother = r.chance(0.06);
  const father = singleMother ? null : parent(r, 'M', child.last, childYear);
  const mother = parent(
    r,
    'F',
    r.chance(0.7) ? child.last : r.pick(FAMILY_NAMES),
    childYear
  );
  const guardian = r.chance(0.23)
    ? parent(r, r.chance(0.5) ? 'M' : 'F', r.pick(FAMILY_NAMES), childYear)
    : null;
  if (guardian) guardian.nationality = pickFrom(r, GUARDIAN_NATIONALITY);
  const nSib = pickFrom(r, [
    [0, 147],
    [1, 127],
    [2, 32],
    [3, 3],
  ] as Distribution<number>);
  const siblings: Sibling[] = [];
  for (let i = 0; i < nSib; i++) {
    const sy = childYear + r.int(-8, 6);
    const sibFirst = r.pick(
      r.chance(0.5) ? ADULT_MALE_NAMES : ADULT_FEMALE_NAMES
    );
    siblings.push({
      fullName: `${sibFirst} ${child.middle ?? ''} ${child.last}`.replace(
        /\s+/g,
        ' '
      ),
      birthDay: `${sy}-${pad(r.int(1, 12), 2)}-${pad(r.int(1, 28), 2)}`,
      religion: pickFrom(r, PARENT_RELIGION),
      educationOccupation:
        sy > 2021
          ? r.pick(['N/A', 'Toddler', 'NA'])
          : sy > 2008
            ? r.pick([
                'P3',
                'Primary 5',
                'Grade 4',
                'Sec 2',
                'K2',
                'Nursery',
                'S1',
              ])
            : r.pick(['College', 'Working', 'University', 'Nurse', 'Engineer']),
      schoolCompany:
        sy > 2021
          ? r.pick(['N/A', 'NA', '-'])
          : sy > 2008
            ? r.pick([
                'HFSE',
                'HFSE International School',
                'HFSE IS',
                'Philippine school',
              ])
            : r.pick([...COMPANIES]),
    });
  }
  const sg = child.nationality === 'Singapore';
  const fam: Family = {
    father,
    mother,
    guardian,
    address: `Blk ${r.int(100, 999)} ${r.pick(STREETS)}, #${pad(r.int(2, 18), 2)}-${pad(r.int(1, 450), 3)}`,
    postalCode: r.chance(0.01)
      ? 0
      : Number(`${r.int(51, 82)}${pad(r.int(0, 9999), 4)}`),
    homePhone: r.chance(0.55) ? 0 : Number(`6${pad(r.int(0, 9999999), 7)}`),
    childNric: nric(r, sg ? 'T' : r.pick(['G', 'M'])),
    childPassport: passport(r),
    childPassportExpiry: dateBetween(r, '2024-06-01', '2033-12-31'),
    childPassExpiry: dateBetween(r, '2024-09-30', '2029-06-24'),
    language: pickFrom(r, PRIMARY_LANGUAGE),
    siblings,
    passCode: Array.from({ length: 8 }, () =>
      r.pick([...'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'])
    ).join(''),
    learningNeeds: r.chance(0.16) ? r.pick(LEARNING_NEEDS) : null,
  };
  families.set(child.key, fam);
  return fam;
}

// ── Applications ──────────────────────────────────────────────────────────

function levelApplied(r: Rng, a: AppSpec): string | null {
  if (a.ay === 'AY2025' && r.chance(0.09)) return null;
  if (a.level === 'YS') return pickFrom(r, YS_LEVEL_APPLIED[a.ay]);
  const canonical = LEVEL_LABEL[a.level];
  if (a.ay === 'AY2026' && a.level === 'S2' && r.chance(0.05)) {
    return r.pick([
      'HFSE International Education Programme - Year 9',
      'HFSE International Education Programme – Year 9',
    ]);
  }
  if (a.ay === 'AY2027') {
    const variants = AY2027_PROGRAMME_LABELS[a.level];
    if (variants && r.chance(0.25)) return r.pick(variants);
  }
  return canonical;
}

const fullName = (p: { first: string; middle: string | null; last: string }) =>
  [p.first, p.middle, p.last].filter(Boolean).join(' ');

function parentCols(
  prefix: 'father' | 'mother' | 'guardian',
  p: Parent | null,
  passType: string | null,
  ay: Ay
): Row {
  if (!p) {
    const out: Row = {};
    for (const k of [
      'FullName',
      'LastName',
      'FirstName',
      'MiddleName',
      'PreferredName',
      'BirthDay',
      'Passport',
      'PassportExpiry',
      'Nric',
      'Pass',
      'PassExpiry',
      'CompanyName',
      'Position',
      'Nationality',
      'Religion',
      'Mobile',
      'Email',
    ])
      out[`${prefix}${k}`] =
        k === 'Mobile' && prefix === 'guardian' && ay === 'AY2025' ? 0 : null;
    return out;
  }
  return {
    [`${prefix}FullName`]: fullName(p),
    [`${prefix}LastName`]: p.last,
    [`${prefix}FirstName`]: p.first,
    [`${prefix}MiddleName`]: p.middle,
    [`${prefix}PreferredName`]: p.preferred,
    [`${prefix}BirthDay`]: p.birthDay,
    [`${prefix}Passport`]: p.passport,
    [`${prefix}PassportExpiry`]: p.passportExpiry,
    [`${prefix}Nric`]: p.nric,
    [`${prefix}Pass`]: passType,
    [`${prefix}PassExpiry`]: passType ? p.passExpiry : null,
    [`${prefix}CompanyName`]: p.company,
    [`${prefix}Position`]: p.position,
    [`${prefix}Nationality`]: p.nationality,
    [`${prefix}Religion`]: p.religion,
    [`${prefix}Mobile`]: p.mobile,
    [`${prefix}Email`]: p.email,
  };
}

const tri = (r: Rng, nullP: number, trueP: number) =>
  r.chance(nullP) ? null : r.chance(trueP);

export function applicationRow(a: AppSpec): Row {
  const r = rng(`people:app:${a.ay}:${a.child.key}`);
  const c = a.child;
  const fam = familyOf(c);
  const ay = a.ay;
  const religion = pickFrom(r, RELIGION[ay]);
  const passType = pickFrom(r, STUDENT_PASS[ay]);
  const sibs: Row = {};
  for (let i = 1; i <= 5; i++) {
    const s = fam.siblings[i - 1];
    sibs[`siblingFullName${i}`] = s?.fullName ?? null;
    sibs[`siblingBirthDay${i}`] = s?.birthDay ?? null;
    sibs[`siblingReligion${i}`] = s?.religion ?? null;
    sibs[`siblingEducationOccupation${i}`] = s?.educationOccupation ?? null;
    sibs[`siblingSchoolCompany${i}`] = s?.schoolCompany ?? null;
  }
  // The medical / consent block arrived with the AY2026 form: absent from
  // every AY2025 row, ~5% of AY2026, ~90% of AY2027 (production).
  const medFill = ay === 'AY2025' ? 0 : ay === 'AY2026' ? 0.05 : 0.9;
  const hasMed = r.chance(medFill);
  const med = (trueP: number) => (hasMed ? r.chance(trueP) : null);
  const consentFill = ay === 'AY2025' ? 0 : ay === 'AY2026' ? 0.08 : 0.7;
  const hasConsent = r.chance(consentFill);
  const feedback =
    ay === 'AY2025' ? r.chance(0.002) : r.chance(ay === 'AY2026' ? 0.04 : 0.25);
  const stp = ay !== 'AY2025' && r.chance(ay === 'AY2026' ? 0.014 : 0.05);
  const created = a.createdAt;
  const day = created.slice(0, 10);
  const firstName = c.first;
  const lastName = c.last;

  return {
    created_at: created,
    category: a.category,
    enroleeNumber: a.blankKeys ? null : a.enroleeNumber,
    studentNumber: a.blankKeys ? null : c.appStudentNumber,
    enroleeFullName:
      `${lastName}, ${firstName}${c.middle ? ` ${c.middle}` : ''}`.toUpperCase(),
    lastName,
    firstName,
    middleName: c.middle,
    preferredName: r.chance(0.3)
      ? firstName.split(' ')[0]
      : firstName.split(' ')[
          r.chance(0.5) ? 0 : firstName.split(' ').length - 1
        ],
    levelApplied: levelApplied(r, a),
    classType: pickFrom(r, CLASS_TYPE[ay]),
    preferredSchedule: pickFrom(r, PREFERRED_SCHEDULE[ay]),
    birthDay: c.birthDay,
    gender: c.gender,
    passportNumber: r.chance(0.01) ? null : fam.childPassport,
    passportExpiry: r.chance(0.03) ? null : fam.childPassportExpiry,
    nationality: c.nationality,
    religion,
    religionOther: /^Others?$/.test(religion)
      ? pickFrom(r, RELIGION_OTHER)
      : r.chance(0.01)
        ? pickFrom(r, RELIGION_OTHER)
        : null,
    nric: r.chance(0.01) ? null : fam.childNric,
    pass: passType,
    passExpiry: passType ? fam.childPassExpiry : null,
    homeAddress: fam.address,
    postalCode: fam.postalCode,
    homePhone: fam.homePhone,
    contactPerson: fullName(fam.mother),
    contactPersonNumber: fam.mother.mobile,
    primaryLanguage: r.chance(0.8)
      ? fam.language
      : pickFrom(r, PRIMARY_LANGUAGE),
    parentMaritalStatus: pickFrom(r, MARITAL[ay]),
    livingWithWhom: pickFrom(r, LIVING_WITH),
    ...parentCols(
      'father',
      fam.father,
      fam.father ? pickFrom(r, FATHER_PASS[ay]) : null,
      ay
    ),
    fatherMarital: null,
    ...parentCols('mother', fam.mother, pickFrom(r, MOTHER_PASS[ay]), ay),
    motherMarital: null,
    ...parentCols(
      'guardian',
      fam.guardian,
      fam.guardian ? pickFrom(r, FATHER_PASS[ay]) : null,
      ay
    ),
    ...sibs,
    availSchoolBus: pickFrom(r, YES_NO_BUS[ay]),
    availUniform: pickFrom(r, YES_NO_UNIFORM[ay]),
    availStudentCare: pickFrom(r, YES_NO_CARE[ay]),
    additionalLearningNeeds: fam.learningNeeds,
    previousSchool: null,
    documentsStatus: ay === 'AY2027' && r.chance(0.003) ? 'Incomplete' : null,
    registrationInvoice:
      ay === 'AY2027' && r.chance(0.003)
        ? `RI${pad(r.int(0, 99999999), 8)}`
        : null,
    registrationInvoiceDate: null,
    assessmentDate: null,
    assessmentStatus: null,
    startDate: null,
    enrollmentInvoice: null,
    enrollmentInvoiceDate: null,
    acctsRemarks: null,
    enroleePhoto:
      ay === 'AY2025' || r.chance(0.92)
        ? docUrl(ay, a.enroleeNumber, 'enroleePhoto', r)
        : null,
    creatorUid: null,
    howDidYouKnowAboutHFSEIS:
      ay === 'AY2027' && r.chance(0.26)
        ? pickFrom(r, HOW_DID_YOU_KNOW)
        : ay === 'AY2026' && r.chance(0.01)
          ? 'Referral'
          : null,
    otherSource: null,
    // AY2025's import left a third of the column blank and a few DELETED.
    applicationStatus:
      ay === 'AY2025'
        ? pickFrom(r, [
            ['Registered', 566],
            [null, 229],
            ['DELETED', 27],
          ] as Distribution<string | null>)
        : 'Registered',
    fatherReligionOther: null,
    motherReligionOther: null,
    guardianReligionOther: null,
    passCodeStudent: ay === 'AY2025' && r.chance(0.9) ? fam.passCode : null,
    discount1: pickFrom(r, DISCOUNT1[ay]),
    discount2: pickFrom(r, DISCOUNT2[ay]),
    discount3: pickFrom(r, DISCOUNT3[ay]),
    referrerName:
      ay !== 'AY2027' && r.chance(ay === 'AY2025' ? 0.055 : 0.07)
        ? r.chance(0.4)
          ? ''
          : fullName(parent(r, 'F', r.pick(FAMILY_NAMES), 2015))
        : null,
    paymentOption: pickFrom(r, PAYMENT_OPTION[ay]),
    referrerMobile: ay === 'AY2026' && r.chance(0.07) ? '' : null,
    contractSignatory: pickFrom(r, CONTRACT_SIGNATORY[ay]),
    feedbackRating: feedback ? r.pick([3, 3, 4, 4, 5, 5, 2]) : null,
    feedbackComments:
      feedback && r.chance(0.4) ? r.pick(FEEDBACK_COMMENTS) : null,
    feedbackConsent: feedback ? r.chance(0.5) : null,
    feedbackSubmittedAt: feedback
      ? `${day}T${pad(r.int(8, 20), 2)}:${pad(r.int(0, 59), 2)}:00`
      : null,
    stpApplicationStatus: stp ? 'Pending' : null,
    vizSchoolProgram: a.category === 'VizSchool Current' ? 'VizLive' : null,
    preCourseAnswer:
      ay === 'AY2025'
        ? null
        : r.chance(ay === 'AY2026' ? 0.06 : 0.17)
          ? r.pick(['YES', 'No', 'Yes', 'No', 'YES '])
          : null,
    preCourseDate:
      ay !== 'AY2025' && r.chance(ay === 'AY2026' ? 0.06 : 0.03)
        ? `${day}T10:00:00`
        : null,
    preCourseAcknowledgedAt:
      ay === 'AY2027' || (ay === 'AY2026' && r.chance(0.06))
        ? `${day}T${pad(r.int(8, 20), 2)}:${pad(r.int(0, 59), 2)}:00`
        : null,
    stpApplicationType: stp ? pickFrom(r, STP_TYPE) : null,
    allergies: med(0.09),
    allergyDetails:
      hasMed && r.chance(0.3)
        ? r.pick(['', 'Dust mites', 'Seafood (shrimp)', 'Peanuts', 'Pollen'])
        : null,
    asthma: med(0.05),
    foodAllergies: med(0.05),
    foodAllergyDetails:
      hasMed && r.chance(0.1) ? r.pick(['', 'Shellfish', 'Eggs']) : null,
    heartConditions: med(0),
    epilepsy: med(0.01),
    diabetes: med(0.007),
    eczema: med(0.05),
    otherMedicalConditions:
      hasMed && r.chance(0.08)
        ? r.pick(['', 'G6PD deficiency', 'Mild scoliosis, monitored yearly'])
        : ay === 'AY2026' && r.chance(0.002)
          ? ''
          : null,
    paracetamolConsent:
      hasMed || (ay === 'AY2027' && r.chance(0.5)) ? r.chance(0.72) : null,
    otherLearningNeeds:
      ay !== 'AY2025' && r.chance(0.008)
        ? r.pick(['NA', 'Speech therapy weekly'])
        : null,
    studentCareProgram:
      ay !== 'AY2025' && r.chance(ay === 'AY2026' ? 0.018 : 0.08)
        ? r.pick(['Full day', 'Full day', 'Daily', 'FULL'])
        : null,
    socialMediaConsent: hasConsent ? r.chance(0.9) : null,
    guardianWhatsappTeamsConsent:
      hasConsent && fam.guardian ? r.chance(0.4) : null,
    fatherWhatsappTeamsConsent: hasConsent && fam.father ? r.chance(0.8) : null,
    motherWhatsappTeamsConsent: hasConsent ? r.chance(0.9) : null,
    residenceHistory:
      ay === 'AY2025'
        ? r.chance(0.003)
          ? []
          : null
        : r.chance(ay === 'AY2026' ? 0.08 : 0.6)
          ? r.chance(0.85)
            ? []
            : [
                {
                  country:
                    c.nationality === 'Singapore'
                      ? 'Philippines'
                      : c.nationality,
                  from: `${Number(c.birthDay.slice(0, 4))}`,
                  to: `${Number(c.birthDay.slice(0, 4)) + r.int(1, 5)}`,
                },
              ]
          : null,
    dietaryRestrictions:
      hasMed && r.chance(0.1)
        ? r.pick(['', 'No pork', 'Halal', 'Vegetarian'])
        : null,
    preferredPaymentScheme:
      ay === 'AY2027' && r.chance(0.94)
        ? pickFrom(r, [
            ['Monthly Payment', 232],
            ['Annual (Full Payment)', 29],
            ['Quarterly Payment', 28],
          ] as Distribution<string>)
        : ay === 'AY2026' && r.chance(0.008)
          ? 'Monthly Payment'
          : null,
    preferredPaymentMethod:
      ay === 'AY2027' && r.chance(0.94)
        ? pickFrom(r, [
            ['Bank Transfer', 177],
            ['GIRO', 91],
            ['Credit/Debit Card Payment', 21],
          ] as Distribution<string>)
        : ay === 'AY2026' && r.chance(0.008)
          ? 'Bank Transfer'
          : null,
    marketingReferrerName: null,
  };
}

// ── Status ────────────────────────────────────────────────────────────────

const REMARK_BITS = {
  contract: [
    (d: string, s: string) => `Contract signed by ${s.toLowerCase()} on ${d}.`,
    (d: string) =>
      `SC sent via email ${d}; signed copy received through the portal.`,
    (d: string, s: string, o: string) =>
      `Signed (${s}). Payment ${o ?? 'option'} confirmed with accounts on ${d}.`,
    (d: string) =>
      `Follow-up call ${d}, parent will sign after reviewing the fee schedule.`,
    (d: string, s: string) =>
      `${s} signed on ${d}. Sibling discount verified against last year's record.`,
  ],
  document: [
    'Pending: father pass renewal.',
    'Birth certificate uploaded is blurry, requested re-upload.',
    'Mother passport expired, waiting for the renewed copy.',
    'Form 12 to follow.',
    'All documents complete as of review.',
    'ICA photo not yet submitted; reminded via WhatsApp.',
    'Medical form unsigned, sent back to parent.',
  ],
  application: [
    'Parent requested a call back regarding schedule.',
    'Transferring from a school in Manila.',
    'Sibling already enrolled.',
    'Waiting for the pass approval before proceeding.',
    'Family relocating back to the Philippines.',
  ],
  fee: [
    'Paid in full via bank transfer.',
    'Partial payment received, balance due next month.',
    'GIRO set up; first deduction pending.',
    'Invoice re-issued with the corrected discount.',
  ],
  assessment: [
    'Good reading fluency; needs support in problem solving.',
    'Fully guided during the exams.',
    'Assessment rescheduled once at parent request.',
    'Strong in arithmetic, weak in comprehension.',
  ],
};

function grade(r: Rng, ay: Ay): string {
  const total = r.pick([40, 40, 40, 31, 33, 42, 43]);
  const got = r.int(Math.floor(total * 0.15), total);
  const pct = Math.round((got / total) * 10000) / 100;
  if (ay === 'AY2025') return r.chance(0.2) ? '0' : `${pct}%`;
  return r.chance(0.6)
    ? `<p>${pct}% (${got}/${total})</p>`
    : `<p>${got}/${total} - ${pct}%</p>`;
}

/**
 * The status row as it stands once the year's story is written, EXCEPT that
 * a child who joins a class is written as Enrolled with that class: the
 * sync runs on it, and the later withdrawals / Youngstarters flips edit the
 * row the way Records or Directus would.
 */
export function statusRow(a: AppSpec): Row {
  const r = rng(`people:status:${a.ay}:${a.child.key}`);
  const ay = a.ay;
  const day = a.createdAt.slice(0, 10);
  const staff = () => r.pick(ADMISSIONS_STAFF);
  const after = (lo: number, hi: number) => {
    const d = addDays(day, r.int(lo, hi));
    return d > TODAY ? TODAY : d;
  };
  const enrolled =
    a.outcome === 'enrolled' || a.outcome === 'enrolled_unplaced';
  const isNew = a.category !== 'Current';
  const applicationStatus: string | null =
    a.outcome === 'status_only' && ay === 'AY2027'
      ? null
      : enrolled
        ? 'Enrolled'
        : a.outcome === 'submitted' || a.outcome === 'status_only'
          ? 'Submitted'
          : a.outcome === 'cancelled'
            ? 'Cancelled'
            : 'Withdrawn';
  const terminal =
    applicationStatus === 'Cancelled' || applicationStatus === 'Withdrawn';
  const placedIn = a.section ?? a.presetSection;

  // ── Stage statuses, per AY, from production's combinations ───────────
  let registrationStatus: string | null = null;
  let documentStatus: string | null = null;
  let assessmentStatus: string | null = null;
  let contractStatus: string | null = null;
  let feeStatus: string | null = null;
  let suppliesStatus: string | null = null;

  if (ay === 'AY2025') {
    // The pre-SIS vocabulary: "New SC signed" etc.
    if (enrolled) {
      contractStatus = pickFrom(r, [
        ['New SC signed', 80],
        [null, 13],
        ['Finished', 3],
        ['Incomplete', 2],
        ['New SC Signed', 0.5],
      ] as Distribution<string | null>);
      feeStatus = pickFrom(r, [
        ['Finished', 52],
        ['Paid', 44],
        ['Invoiced', 2],
        ['Pending', 1],
      ] as Distribution<string>);
      documentStatus = pickFrom(r, [
        ['Finished', 62],
        [null, 20],
        ['Incomplete', 10],
        ['Verified', 8],
      ] as Distribution<string | null>);
      suppliesStatus = r.chance(0.3) ? 'Claimed' : null;
    } else if (applicationStatus === 'Submitted') {
      contractStatus = pickFrom(r, [
        [null, 55],
        ['New SC sent', 40],
        ['Incomplete', 5],
      ] as Distribution<string | null>);
      feeStatus = r.chance(0.2) ? r.pick(['Invoiced', 'Pending']) : null;
      documentStatus = pickFrom(r, [
        [null, 50],
        ['Incomplete', 40],
        ['Finished', 10],
      ] as Distribution<string | null>);
    } else {
      contractStatus = r.chance(0.5) ? 'New SC sent' : null;
      feeStatus = r.chance(0.4) ? 'Cancelled' : null;
      documentStatus = r.chance(0.3) ? 'Cancelled' : null;
    }
    if (isNew) {
      registrationStatus = terminal
        ? r.chance(0.6)
          ? 'Cancelled'
          : null
        : pickFrom(r, [
            ['Finished', 75],
            [null, 18],
            ['Unpaid', 5],
            ['Pending', 2],
          ] as Distribution<string | null>);
      assessmentStatus = terminal
        ? r.chance(0.4)
          ? 'Cancelled'
          : null
        : r.chance(0.8)
          ? 'Finished'
          : r.chance(0.1)
            ? 'Pending'
            : null;
    }
  } else if (ay === 'AY2026') {
    if (enrolled) {
      contractStatus = 'Signed';
      feeStatus = r.chance(0.97) ? 'Paid' : 'Invoiced';
      documentStatus = pickFrom(r, [
        [null, 45],
        ['Finished', 33],
        ['Incomplete', 22],
      ] as Distribution<string | null>);
    } else if (applicationStatus === 'Submitted') {
      contractStatus = pickFrom(r, [
        ['Signed', 60],
        ['Sent', 25],
        [null, 15],
      ] as Distribution<string | null>);
      feeStatus = r.chance(0.2) ? 'Pending' : null;
      documentStatus = r.chance(0.5) ? 'Incomplete' : null;
    } else if (applicationStatus === 'Cancelled') {
      contractStatus = r.pick(['Sent', 'Signed', 'Generated']);
      feeStatus = r.chance(0.4)
        ? 'Invoiced'
        : r.chance(0.1)
          ? 'Cancelled'
          : null;
    } else {
      // Production: 15 of 33 Withdrawn rows read Signed + Paid.
      contractStatus = 'Signed';
      feeStatus = r.chance(0.6) ? 'Paid' : null;
    }
    if (isNew) {
      registrationStatus =
        applicationStatus === 'Cancelled'
          ? r.chance(0.6)
            ? 'Cancelled'
            : null
          : r.chance(0.7)
            ? 'Finished'
            : r.chance(0.3)
              ? 'Unpaid'
              : null;
      assessmentStatus = !terminal && r.chance(0.7) ? 'Finished' : null;
    }
  } else {
    if (a.outcome === 'status_only') {
      // The stray AY2027 row with no application and no status.
    } else if (enrolled) {
      contractStatus = 'Signed';
      feeStatus = 'Paid';
      documentStatus = r.chance(0.3) ? 'Incomplete' : null;
    } else {
      const combo = pickFrom(r, [
        [['Signed', 'Paid', null], 185],
        [['Signed', 'Invoiced', null], 15],
        [['Sent', null, null], 12],
        [['Signed', 'Paid', 'Incomplete'], 8],
        [['Signed', 'Paid', 'Finished'], 8],
        [[null, null, 'Incomplete'], 14],
        [['Signed', null, null], 4],
        [[null, null, null], 3],
        [['Generated', 'Invoiced', null], 2],
        [['Generated', null, null], 1],
        [['Signed', 'Cancelled', 'Finished'], 1],
        [[null, 'Pending', null], 1],
      ] as Distribution<[string | null, string | null, string | null]>);
      [contractStatus, feeStatus, documentStatus] = combo;
    }
    if (isNew && a.outcome !== 'status_only') {
      registrationStatus = r.chance(0.8) ? 'Finished' : 'Unpaid';
      assessmentStatus =
        registrationStatus === 'Finished'
          ? r.chance(0.9)
            ? 'Finished'
            : 'Pending'
          : null;
      documentStatus =
        documentStatus ?? (r.chance(0.7) ? 'Incomplete' : 'Finished');
    }
  }

  const signatory = r.pick(['Mother', 'Father']);
  const contractDate = after(1, 40);
  const feeDate = after(5, 60);
  const remark = (p: number, pool: readonly string[]) =>
    r.chance(p) ? r.pick(pool) : null;
  const contractRemarks =
    contractStatus && r.chance(ay === 'AY2025' ? 0.75 : 0.93)
      ? r.pick(REMARK_BITS.contract)(
          contractDate,
          signatory,
          r.pick(['option 1', 'option 2', 'option 3'])
        )
      : null;
  const fullName =
    `${a.child.last}, ${a.child.first}${a.child.middle ? ` ${a.child.middle}` : ''}`.toUpperCase();
  const classSet = !!placedIn && !(a.outcome === 'enrolled_unplaced');
  const enrolledAt =
    enrolled && ay !== 'AY2025' && (ay === 'AY2027' || r.chance(0.08))
      ? `${ay === 'AY2026' ? dateBetween(r, '2026-07-21', '2026-08-13') : dateBetween(r, '2026-09-24', '2026-09-28')}T${pad(r.int(1, 9), 2)}:${pad(r.int(0, 59), 2)}:${pad(r.int(0, 59), 2)}.${pad(r.int(0, 999999), 6)}+00:00`
      : null;

  if (a.outcome === 'status_only' && ay === 'AY2027') {
    // Production's one AY2027 status row with nothing in it.
    return {
      created_at: a.createdAt,
      enroleeNumber: null,
      enroleeName: null,
      applicationStatus: null,
      enrolmentDate: null,
      levelApplied: null,
      enroleeType: 'Current',
    };
  }

  return {
    created_at: a.createdAt,
    enroleeNumber: a.enroleeNumber,
    enrolmentDate: day,
    enroleeName: ay === 'AY2025' && r.chance(0.12) ? null : fullName,
    applicationStatus,
    applicationRemarks: remark(
      ay === 'AY2026' ? 0.1 : 0.04,
      REMARK_BITS.application
    ),
    applicationUpdatedDate:
      terminal || r.chance(ay === 'AY2027' ? 0.97 : 0.1) ? after(2, 90) : null,
    applicationUpdatedBy: terminal ? staff() : null,
    registrationStatus,
    registrationInvoice:
      registrationStatus === 'Finished' || registrationStatus === 'Unpaid'
        ? `RI${pad(r.int(0, 99999999), 8)}`
        : null,
    registrationPaymentDate:
      registrationStatus === 'Finished' ? after(1, 20) : null,
    registrationRemarks:
      registrationStatus && r.chance(0.05)
        ? 'Registration fee waived for sibling.'
        : null,
    registrationUpdateDate: registrationStatus ? after(1, 20) : null,
    registrationUpdatedby: registrationStatus ? staff() : null,
    documentStatus,
    documentRemarks: remark(documentStatus ? 0.55 : 0.15, REMARK_BITS.document),
    documentUpdatedDate: documentStatus ? after(3, 60) : null,
    documentUpdatedby: documentStatus ? staff() : null,
    assessmentStatus,
    assessmentSchedule: assessmentStatus ? after(5, 30) : null,
    assessmentGradeMath: assessmentStatus === 'Finished' ? grade(r, ay) : null,
    assessmentGradeEnglish:
      assessmentStatus === 'Finished' ? grade(r, ay) : null,
    assessmentRemarks:
      assessmentStatus === 'Finished'
        ? remark(0.5, REMARK_BITS.assessment)
        : null,
    assessmentMedical:
      assessmentStatus === 'Finished' && r.chance(0.2)
        ? r.pick([
            'No known conditions',
            'Wears glasses',
            'Asthma, carries inhaler',
          ])
        : null,
    assessmentUpdatedDate: assessmentStatus ? after(5, 35) : null,
    assessmentUpdatedby: assessmentStatus ? staff() : null,
    contractStatus,
    contractRemarks,
    contractUpdatedDate: contractStatus ? contractDate : null,
    contractUpdatedby: contractStatus ? staff() : null,
    feeStatus,
    feeInvoice:
      feeStatus && feeStatus !== 'Cancelled'
        ? `INV${pad(r.int(0, 9999999), 7)}`
        : null,
    feePaymentDate:
      feeStatus === 'Paid' || feeStatus === 'Finished' ? feeDate : null,
    feeStartDate:
      feeStatus && ay !== 'AY2025'
        ? ay === 'AY2026'
          ? r.pick(['2026-01-01', '2026-01-08', '2026-02-01'])
          : r.pick(['2027-01-01', '2027-01-07'])
        : null,
    feeRemarks: feeStatus ? remark(0.05, REMARK_BITS.fee) : null,
    feeUpdatedDate: feeStatus ? feeDate : null,
    feeUpdatedby: feeStatus ? staff() : null,
    classStatus: classSet
      ? ay === 'AY2025' || ay === 'AY2027' || r.chance(0.3)
        ? 'Finished'
        : null
      : null,
    classAY:
      classSet && (ay === 'AY2027' || r.chance(ay === 'AY2026' ? 0.2 : 0.01))
        ? ay
        : null,
    classLevel:
      classSet || a.outcome === 'enrolled_unplaced'
        ? LEVEL_LABEL[(placedIn ?? a).level]
        : null,
    // AY2027's S1 class arrives as "Discipline-1", which the sync normalises.
    classSection: classSet
      ? ay === 'AY2027' && placedIn!.name === 'Discipline 1'
        ? 'Discipline-1'
        : placedIn!.name
      : null,
    classRemarks:
      classSet && r.chance(0.01)
        ? 'Placed per parent request for the morning session.'
        : null,
    classUpdatedDate: classSet ? after(20, 120) : null,
    classUpdatedby: classSet ? staff() : null,
    suppliesStatus,
    suppliesClaimedDate: suppliesStatus ? after(30, 120) : null,
    suppliesUpdatedDate: suppliesStatus ? after(30, 120) : null,
    suppliesUpdatedby: suppliesStatus ? staff() : null,
    orientationStatus: null,
    enroleeType: ay === 'AY2025' && r.chance(0.01) ? null : a.category,
    levelApplied:
      ay === 'AY2025' && r.chance(0.25)
        ? null
        : levelApplied(rng(`people:app:${a.ay}:${a.child.key}`), a),
    // Production's only terminal reason (AY2026, 'other' + an 83-character
    // note) came from a Records withdrawal; the cascade writes it there.
    applicationTerminalReason: null,
    applicationTerminalNotes: null,
    enrolledAt,
  };
}

// ── Documents ─────────────────────────────────────────────────────────────

type SlotSpec = {
  slot: string;
  status: Distribution<string | null>;
  expiry?: boolean;
};

/** Per-AY slot status mix (production counts). URL present iff the file arrived. */
const SLOTS: Record<Ay, SlotSpec[]> = {
  AY2025: [
    {
      slot: 'birthCert',
      status: [
        ['Uploaded', 533],
        [null, 138],
        ['To follow', 1],
      ],
    },
    {
      slot: 'educCert',
      status: [
        ['Uploaded', 365],
        [null, 299],
        ['For Submission', 7],
        ['To follow', 1],
      ],
    },
    {
      slot: 'form12',
      status: [
        ['Uploaded', 522],
        [null, 150],
      ],
    },
    {
      slot: 'idPicture',
      status: [
        ['Uploaded', 526],
        [null, 146],
      ],
    },
    {
      slot: 'medical',
      status: [
        ['Uploaded', 384],
        [null, 287],
        ['To follow', 1],
      ],
    },
    {
      slot: 'passport',
      expiry: true,
      status: [
        ['Valid', 331],
        [null, 132],
        ['Expired', 127],
        ['Uploaded', 71],
        ['For submission', 9],
        ['Rejected', 1],
        ['To follow', 1],
      ],
    },
    {
      slot: 'pass',
      expiry: true,
      status: [
        ['Expired', 265],
        ['Valid', 197],
        [null, 132],
        ['Uploaded', 67],
        ['For submission', 11],
      ],
    },
    {
      slot: 'motherPassport',
      expiry: true,
      status: [
        ['Valid', 454],
        [null, 131],
        ['Uploaded', 73],
        ['For submission', 7],
        ['Expired', 5],
        ['To follow', 2],
      ],
    },
    {
      slot: 'motherPass',
      expiry: true,
      status: [
        ['Expired', 283],
        ['Valid', 186],
        [null, 133],
        ['Uploaded', 65],
        ['For submission', 5],
      ],
    },
    {
      slot: 'fatherPassport',
      expiry: true,
      status: [
        ['Valid', 411],
        [null, 166],
        ['Uploaded', 70],
        ['Expired', 15],
        ['For submission', 9],
        ['To follow', 1],
      ],
    },
    {
      slot: 'fatherPass',
      expiry: true,
      status: [
        ['Expired', 243],
        ['Valid', 190],
        [null, 167],
        ['Uploaded', 66],
        ['For submission', 5],
        ['To follow', 1],
      ],
    },
    {
      slot: 'guardianPassport',
      expiry: true,
      status: [
        [null, 480],
        ['Valid', 135],
        ['Uploaded', 50],
        ['For submission', 6],
        ['Expired', 1],
      ],
    },
    {
      slot: 'guardianPass',
      expiry: true,
      status: [
        [null, 484],
        ['Expired', 73],
        ['Valid', 64],
        ['Uploaded', 47],
        ['For submission', 4],
      ],
    },
  ],
  AY2026: [
    {
      slot: 'birthCert',
      status: [
        ['Uploaded', 487],
        ['Rejected', 7],
        ['Valid', 6],
        ['To follow', 2],
      ],
    },
    {
      slot: 'educCert',
      status: [
        ['Uploaded', 313],
        [null, 147],
        ['To follow', 27],
        ['Rejected', 12],
        ['Valid', 3],
      ],
    },
    {
      slot: 'form12',
      status: [
        [null, 499],
        ['Rejected', 2],
        ['Valid', 1],
      ],
    },
    {
      slot: 'idPicture',
      status: [
        ['Uploaded', 469],
        ['To follow', 19],
        ['Rejected', 8],
        ['Valid', 5],
        [null, 1],
      ],
    },
    {
      slot: 'medical',
      status: [
        ['Uploaded', 330],
        [null, 133],
        ['To follow', 20],
        ['Rejected', 17],
        ['Valid', 2],
      ],
    },
    {
      slot: 'passport',
      expiry: true,
      status: [
        ['Valid', 420],
        ['Expired', 66],
        ['Rejected', 7],
        ['To follow', 5],
        ['Uploaded', 3],
        [null, 1],
      ],
    },
    {
      slot: 'pass',
      expiry: true,
      status: [
        ['Valid', 335],
        ['Expired', 151],
        ['Rejected', 7],
        [null, 5],
        ['Uploaded', 3],
        ['To follow', 1],
      ],
    },
    {
      slot: 'motherPassport',
      expiry: true,
      status: [
        ['Valid', 483],
        ['Expired', 7],
        ['Rejected', 6],
        ['Uploaded', 2],
        [null, 2],
        ['To follow', 2],
      ],
    },
    {
      slot: 'motherPass',
      expiry: true,
      status: [
        ['Valid', 333],
        ['Expired', 155],
        ['To follow', 5],
        ['Rejected', 5],
        [null, 2],
        ['Uploaded', 2],
      ],
    },
    {
      slot: 'fatherPassport',
      expiry: true,
      status: [
        ['Valid', 458],
        [null, 19],
        ['Expired', 9],
        ['Rejected', 8],
        ['To follow', 4],
        ['Uploaded', 4],
      ],
    },
    {
      slot: 'fatherPass',
      expiry: true,
      status: [
        ['Valid', 321],
        ['Expired', 141],
        [null, 18],
        ['To follow', 9],
        ['Rejected', 9],
        ['Uploaded', 4],
      ],
    },
    {
      slot: 'guardianPassport',
      expiry: true,
      status: [
        [null, 287],
        ['Valid', 139],
        ['Uploaded', 70],
        ['Expired', 3],
        ['To follow', 3],
      ],
    },
    {
      slot: 'guardianPass',
      expiry: true,
      status: [
        [null, 287],
        ['Valid', 108],
        ['Uploaded', 70],
        ['Expired', 34],
        ['To follow', 2],
        ['Rejected', 1],
      ],
    },
    {
      slot: 'financialSupportDocs',
      status: [
        [null, 497],
        ['Uploaded', 5],
      ],
    },
    {
      slot: 'icaPhoto',
      status: [
        [null, 497],
        ['Uploaded', 5],
      ],
    },
    {
      slot: 'vaccinationInformation',
      status: [
        [null, 497],
        ['Uploaded', 5],
      ],
    },
    {
      slot: 'newStudentChecksheet',
      status: [
        [null, 500],
        ['Valid', 2],
      ],
    },
    {
      slot: 'preCounsellingAck',
      status: [
        [null, 500],
        ['Valid', 2],
      ],
    },
  ],
  AY2027: [
    {
      slot: 'birthCert',
      status: [
        ['Uploaded', 304],
        ['Valid', 4],
        ['Rejected', 1],
      ],
    },
    {
      slot: 'educCert',
      status: [
        ['Uploaded', 168],
        [null, 138],
        ['Valid', 2],
        ['Rejected', 1],
      ],
    },
    {
      slot: 'idPicture',
      status: [
        ['Uploaded', 270],
        ['To follow', 37],
        ['Valid', 2],
      ],
    },
    {
      slot: 'medical',
      status: [
        ['Uploaded', 181],
        [null, 126],
        ['Valid', 2],
      ],
    },
    {
      slot: 'passport',
      expiry: true,
      status: [
        ['Valid', 300],
        ['Expired', 4],
        ['To follow', 3],
        [null, 1],
        ['Rejected', 1],
      ],
    },
    {
      slot: 'pass',
      expiry: true,
      status: [
        ['Valid', 284],
        ['Expired', 11],
        ['To follow', 8],
        [null, 5],
        ['Rejected', 1],
      ],
    },
    {
      slot: 'motherPassport',
      expiry: true,
      status: [
        ['Valid', 307],
        [null, 1],
        ['Rejected', 1],
      ],
    },
    {
      slot: 'motherPass',
      expiry: true,
      status: [
        ['Valid', 290],
        ['Expired', 11],
        ['To follow', 3],
        [null, 3],
        ['Rejected', 2],
      ],
    },
    {
      slot: 'fatherPassport',
      expiry: true,
      status: [
        ['Valid', 291],
        [null, 14],
        ['Expired', 2],
        ['To follow', 1],
        ['Rejected', 1],
      ],
    },
    {
      slot: 'fatherPass',
      expiry: true,
      status: [
        ['Valid', 270],
        [null, 18],
        ['Expired', 15],
        ['To follow', 4],
        ['Rejected', 2],
      ],
    },
    {
      slot: 'guardianPassport',
      expiry: true,
      status: [
        [null, 237],
        ['Valid', 69],
        ['To follow', 2],
        ['Expired', 1],
      ],
    },
    {
      slot: 'guardianPass',
      expiry: true,
      status: [
        [null, 237],
        ['Valid', 66],
        ['To follow', 3],
        ['Expired', 2],
        ['Rejected', 1],
      ],
    },
    {
      slot: 'financialSupportDocs',
      status: [
        [null, 307],
        ['Valid', 1],
        ['Uploaded', 1],
      ],
    },
    {
      slot: 'icaPhoto',
      status: [
        [null, 307],
        ['Uploaded', 1],
        ['Valid', 1],
      ],
    },
    {
      slot: 'vaccinationInformation',
      status: [
        [null, 307],
        ['Valid', 1],
        ['Uploaded', 1],
      ],
    },
  ],
};

/** Every slot column on the documents table (the rest stay NULL). */
const ALL_SLOTS = [
  'form12',
  'medical',
  'passport',
  'birthCert',
  'pass',
  'educCert',
  'motherPassport',
  'motherPass',
  'fatherPassport',
  'fatherPass',
  'guardianPassport',
  'guardianPass',
  'idPicture',
  'icaPhoto',
  'financialSupportDocs',
  'vaccinationInformation',
  'lastSchoolRecommendation',
  'assessmentResult',
  'signedContract',
  'newStudentChecksheet',
  'pfilesChecklist',
  'preCounsellingAck',
  'conditionalEnrolment',
  'lateEnrolmentForm',
  'letterOfOffer',
  'mediaConsent',
  'whatsappConsent',
  'orientationChecklist',
];

/** Share of "Valid" pass/passport files whose expiry has nonetheless passed (stale status). */
const STALE_VALID: Record<Ay, number> = {
  AY2025: 0.3,
  AY2026: 0.05,
  AY2027: 0,
};

export function documentsRow(a: AppSpec): Row {
  const r = rng(`people:docs:${a.ay}:${a.child.key}`);
  const fam = familyOf(a.child);
  const row: Row = {
    created_at: a.createdAt,
    studentNumber: a.child.appStudentNumber,
    enroleeNumber: a.enroleeNumber,
  };
  for (const s of ALL_SLOTS) {
    row[s] = null;
    row[`${s}Status`] = null;
  }
  for (const spec of SLOTS[a.ay]) {
    const isFather = spec.slot.startsWith('father');
    const isGuardian = spec.slot.startsWith('guardian');
    // No father / guardian on the application → nothing to upload. A
    // guardian, when there is one, draws from the non-empty part of the mix
    // (production's guardian slots are ~75% empty because most have none).
    let status: string | null;
    if ((isFather && !fam.father) || (isGuardian && !fam.guardian)) {
      status = null;
    } else if (isGuardian) {
      status = pickFrom(
        r,
        spec.status.filter(([v]) => v !== null)
      );
    } else {
      status = pickFrom(r, spec.status);
    }
    const arrived =
      status !== null &&
      !['To follow', 'For submission', 'For Submission'].includes(status);
    row[spec.slot] = arrived
      ? docUrl(a.ay, a.enroleeNumber, spec.slot, r)
      : null;
    row[`${spec.slot}Status`] = status;
    if (spec.expiry && arrived) {
      const stale = status === 'Valid' && r.chance(STALE_VALID[a.ay]);
      row[`${spec.slot}Expiry`] =
        status === 'Expired' || stale
          ? dateBetween(
              r,
              a.ay === 'AY2025' ? '2024-02-14' : '2025-08-01',
              '2026-10-01'
            )
          : status === 'Valid'
            ? dateBetween(
                r,
                '2026-11-01',
                spec.slot.endsWith('Passport') || spec.slot === 'passport'
                  ? '2035-12-31'
                  : '2030-12-31'
              )
            : dateBetween(r, '2025-01-01', '2031-12-31');
    } else if (spec.expiry) {
      row[`${spec.slot}Expiry`] = null;
    }
  }
  return row;
}

// ── Discount codes ────────────────────────────────────────────────────────

export function discountCodeRows(ay: 'AY2026' | 'AY2027'): Row[] {
  const r = rng(`people:discounts:${ay}`);
  const codes: Array<[string, string, string, string, string]> =
    ay === 'AY2026'
      ? [
          [
            'AY26JulCUR',
            'Current',
            '2025-07-01',
            '2025-07-31',
            'Early re-enrolment, July',
          ],
          [
            'AY26AUGCUR',
            'Current',
            '2025-08-01',
            '2025-08-31',
            'Early re-enrolment, August',
          ],
          [
            'AY26SEPCUR',
            'Current',
            '2025-09-01',
            '2025-09-30',
            'Early re-enrolment, September',
          ],
          [
            'AY26OHIS',
            'Current',
            '2025-05-01',
            '2025-06-30',
            'Open house, current families',
          ],
          [
            'AY26JulTRF',
            'Current',
            '2025-07-01',
            '2025-07-31',
            'Transfer within the HFSE group, July',
          ],
          [
            'AY26OHTRF',
            'Current',
            '2025-05-01',
            '2025-06-30',
            'Open house transfer',
          ],
          [
            'AY26JulNEW',
            'New',
            '2025-07-01',
            '2025-07-31',
            'New family early bird, July',
          ],
          [
            'AY26AUGNEW',
            'New',
            '2025-08-01',
            '2025-08-31',
            'New family early bird, August',
          ],
          [
            'AY26SEPNEW',
            'New',
            '2025-09-01',
            '2025-09-30',
            'New family early bird, September',
          ],
          [
            'AY26OCTNEW',
            'New',
            '2025-10-01',
            '2025-10-31',
            'New family early bird, October',
          ],
          [
            'AY26NOVNEW',
            'New',
            '2025-11-01',
            '2025-11-30',
            'New family early bird, November',
          ],
          [
            'AY26DECNEW',
            'New',
            '2025-12-01',
            '2025-12-31',
            'New family early bird, December',
          ],
          ['AY26JANNEW', 'New', '2026-01-01', '2026-01-31', 'January intake'],
          ['AY26FEBNEW', 'New', '2026-02-01', '2026-02-28', 'February intake'],
          [
            'AY26OHNEW',
            'New',
            '2025-04-01',
            '2025-06-30',
            'Open house, new families',
          ],
          [
            'AY26OHYS',
            'New',
            '2025-04-01',
            '2025-06-30',
            'Open house, Youngstarters',
          ],
          [
            'AY26REF01',
            'New',
            '2025-04-01',
            '2026-05-20',
            'Referral by a current family',
          ],
          [
            'AY26SPECIALREFERRAL',
            'New',
            '2025-04-01',
            '2026-05-20',
            'Referral by staff, 10% off tuition for the first term only',
          ],
          ['AY26SIB01', 'Both', '2025-05-16', '2025-12-31', 'Second child'],
          [
            'AY26SIB02',
            'Both',
            '2025-05-16',
            '2025-12-31',
            'Third child onwards',
          ],
        ]
      : [
          [
            'AY27JULCUR',
            'Current',
            '2026-07-01',
            '2026-07-31',
            'Early re-enrolment discount for current students who complete enrolment in July',
          ],
          [
            'AY27AUGCUR',
            'Current',
            '2026-08-01',
            '2026-08-31',
            'Early re-enrolment discount, August window',
          ],
          [
            'AY27SEPCUR',
            'Current',
            '2026-09-01',
            '2026-09-30',
            'Early re-enrolment discount, September window',
          ],
          [
            'AY27OCTCUR',
            'Current',
            '2026-10-01',
            '2026-10-31',
            'Re-enrolment discount for current students, October',
          ],
          [
            'AY27NOVCUR',
            'Current',
            '2026-11-01',
            '2026-11-30',
            'Last re-enrolment window, November, reduced rate applies to tuition only',
          ],
          [
            'AY27JULNEW',
            'New',
            '2026-07-01',
            '2026-07-31',
            'Early bird discount for new families who complete enrolment in July',
          ],
          [
            'AY27AUGNEW',
            'New',
            '2026-08-01',
            '2026-08-31',
            'Early bird discount for new families, August window',
          ],
          [
            'AY27SEPNEW',
            'New',
            '2026-09-01',
            '2026-09-30',
            'Early bird discount for new families, September window',
          ],
          [
            'AY27OCTNEW',
            'New',
            '2026-10-01',
            '2026-10-31',
            'New family discount, October',
          ],
          [
            'AY27NOVNEW',
            'New',
            '2026-11-01',
            '2026-11-30',
            'New family discount, November, tuition only, not combinable with referral',
          ],
        ];
  const createdAll = '2026-06-24T09:12:33.104512+00:00';
  return codes.map(
    ([discountCode, enroleeType, startDate, endDate, details]) => ({
      created_at:
        ay === 'AY2027'
          ? createdAll
          : stampOn(r, addDays(startDate, -r.int(5, 20))),
      discountCode,
      enroleeType,
      startDate,
      endDate,
      details,
    })
  );
}
