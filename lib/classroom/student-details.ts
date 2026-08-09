// What a teacher may see about one student on their own class roster, shaped
// out of that student's admissions row.
//
// WHY THIS IS A NARROW HAND-WRITTEN TYPE. The source row (`StudentDetail` in
// lib/sis/queries.ts) also carries NRIC, passport number and expiry, the
// immigration pass, the home address, the family's payment scheme and any
// discount code. None of that is a teacher's business, and the cheapest way to
// guarantee it never leaks is to refuse to accept it: `StudentDetailsSource`
// names the twenty-five fields that may cross and nothing else, so widening the
// drawer is a deliberate edit here rather than a spread that quietly grew.
// `__tests__/classroom/student-details.test.ts` asserts the serialised output
// carries none of those words.
//
// Pure — no database, no session. The route does the authorising; this only
// decides shape.

/** The only fields the drawer is allowed to read. */
export type StudentDetailsSource = {
  allergies: boolean | null;
  allergyDetails: string | null;
  foodAllergies: boolean | null;
  foodAllergyDetails: string | null;
  asthma: boolean | null;
  heartConditions: boolean | null;
  epilepsy: boolean | null;
  eczema: boolean | null;
  diabetes: boolean | null;
  otherMedicalConditions: string | null;
  dietaryRestrictions: string | null;
  paracetamolConsent: boolean | null;
  additionalLearningNeeds: string | null;
  otherLearningNeeds: string | null;
  motherFullName: string | null;
  // The four mobile columns are NUMERIC in production, all of them, on every
  // row that has one. Typed as they actually arrive rather than as they ought
  // to be — see `isRecorded`. Anything reading them must go through
  // `recorded()`, which coerces; never call a string method on them directly.
  motherMobile: string | number | null;
  motherEmail: string | null;
  fatherFullName: string | null;
  fatherMobile: string | number | null;
  guardianFullName: string | null;
  guardianMobile: string | number | null;
  guardianEmail: string | null;
  contactPerson: string | null;
  contactPersonNumber: string | number | null;
  livingWithWhom: string | null;
};

export type LabelledNote = { label: string; value: string };

export type ContactPerson = {
  label: string;
  name: string | null;
  mobile: string | null;
  email: string | null;
};

export type StudentDetails = {
  medical: {
    /** Ticked conditions, by their display name. */
    conditions: string[];
    /** Free-text detail boxes that hold something real. */
    notes: LabelledNote[];
    /** `null` when the question was never answered. */
    paracetamol: boolean | null;
  };
  learning: LabelledNote[];
  contacts: {
    people: ContactPerson[];
    emergency: { name: string; mobile: string | null } | null;
    livingWith: string | null;
  };
  /** Drives the safety strip and the Medical tab's marker dot. */
  hasMedical: boolean;
  /** Drives the Learning tab's marker dot. */
  hasLearning: boolean;
};

// Free-text values that mean "nothing to declare". Every spelling here was read
// out of production, where 65 of 498 applications carry something in the
// learning-needs box and most of it is one of these.
//
// Compared on the value with its punctuation and spacing removed, so `N/A`,
// `N.A.` and `NA` collapse to one entry — and, crucially, on the WHOLE value
// rather than a prefix: `Nanette assists in class` and `nonverbal in large
// groups` both begin with a junk spelling and are both real.
const NOTHING_TO_DECLARE = new Set([
  '',
  'na',
  'none',
  'nil',
  'no',
  'nothing',
  'notapplicable',
]);

/**
 * Does this value carry anything a teacher should read?
 *
 * TAKES `unknown`, AND THAT IS NOT DEFENSIVENESS. Every mobile column on the
 * admissions table is NUMERIC — `motherMobile` is a number on 498 of 498
 * AY2026 rows, and `fatherMobile`, `guardianMobile` and `contactPersonNumber`
 * likewise. Typing these `string | null` and calling `.toLowerCase()` threw
 * `value.toLowerCase is not a function` for every student in the school. The
 * type was a guess about the database and the database disagreed, so the
 * signature now describes what actually arrives.
 */
export function isRecorded(value: unknown): boolean {
  if (value == null) return false;
  const normalised = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return !NOTHING_TO_DECLARE.has(normalised);
}

/** The trimmed value as text, or null when there is nothing worth showing. */
function recorded(value: unknown): string | null {
  return isRecorded(value) ? String(value).trim() : null;
}

const CONDITIONS: Array<[keyof StudentDetailsSource, string]> = [
  ['allergies', 'Allergies'],
  ['foodAllergies', 'Food allergies'],
  ['asthma', 'Asthma'],
  ['heartConditions', 'Heart condition'],
  ['epilepsy', 'Epilepsy'],
  ['eczema', 'Eczema'],
  ['diabetes', 'Diabetes'],
];

const MEDICAL_NOTES: Array<[keyof StudentDetailsSource, string]> = [
  ['allergyDetails', 'Allergies'],
  ['foodAllergyDetails', 'Food allergies'],
  ['otherMedicalConditions', 'Other conditions'],
  ['dietaryRestrictions', 'Diet'],
];

function person(
  label: string,
  name: string | null,
  mobile: string | number | null,
  email: string | null
): ContactPerson | null {
  const n = recorded(name);
  const m = recorded(mobile);
  const e = recorded(email);
  // A number with nobody attached is still worth showing — a teacher can ask
  // for "your mother" — so either half is enough to keep the row.
  if (!n && !m) return null;
  return { label, name: n, mobile: m, email: e };
}

/** Every field absent — the shape a student with no application row gets. */
const NO_SOURCE: StudentDetailsSource = {
  allergies: null,
  allergyDetails: null,
  foodAllergies: null,
  foodAllergyDetails: null,
  asthma: null,
  heartConditions: null,
  epilepsy: null,
  eczema: null,
  diabetes: null,
  otherMedicalConditions: null,
  dietaryRestrictions: null,
  paracetamolConsent: null,
  additionalLearningNeeds: null,
  otherLearningNeeds: null,
  motherFullName: null,
  motherMobile: null,
  motherEmail: null,
  fatherFullName: null,
  fatherMobile: null,
  guardianFullName: null,
  guardianMobile: null,
  guardianEmail: null,
  contactPerson: null,
  contactPersonNumber: null,
  livingWithWhom: null,
};

/**
 * `null` is accepted and means "no application row" — a student backfilled onto
 * an earlier year's roster has none. They get an empty record, so the drawer
 * still opens and says "Nothing recorded" rather than refusing to open.
 */
export function buildStudentDetails(
  input: StudentDetailsSource | null
): StudentDetails {
  const source = input ?? NO_SOURCE;
  const conditions = CONDITIONS.filter(([key]) => source[key] === true).map(
    ([, label]) => label
  );

  const notes: LabelledNote[] = [];
  for (const [key, label] of MEDICAL_NOTES) {
    const value = recorded(source[key]);
    if (value) notes.push({ label, value });
  }

  const learning: LabelledNote[] = [];
  for (const [key, label] of [
    ['additionalLearningNeeds', 'Additional learning needs'],
    ['otherLearningNeeds', 'Other learning needs'],
  ] as Array<[keyof StudentDetailsSource, string]>) {
    const value = recorded(source[key]);
    if (value) learning.push({ label, value });
  }

  const people = [
    person(
      'Mother',
      source.motherFullName,
      source.motherMobile,
      source.motherEmail
    ),
    person('Father', source.fatherFullName, source.fatherMobile, null),
    person(
      'Guardian',
      source.guardianFullName,
      source.guardianMobile,
      source.guardianEmail
    ),
  ].filter((p): p is ContactPerson => p !== null);

  const emergencyName = recorded(source.contactPerson);

  return {
    medical: {
      conditions,
      notes,
      // Left out of `hasMedical` on purpose. 25 students carry a consent
      // answer and nothing else; a red safety strip reading "paracetamol: yes"
      // on all of them would teach people to ignore the strip.
      paracetamol: source.paracetamolConsent ?? null,
    },
    learning,
    contacts: {
      people,
      emergency: emergencyName
        ? { name: emergencyName, mobile: recorded(source.contactPersonNumber) }
        : null,
      livingWith: recorded(source.livingWithWhom),
    },
    hasMedical: conditions.length > 0 || notes.length > 0,
    hasLearning: learning.length > 0,
  };
}
