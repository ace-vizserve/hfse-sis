/**
 * The shaper behind the Classroom "View student details" drawer.
 *
 * TWO THINGS ARE UNDER TEST, and the first is the reason this file exists.
 *
 * 1. `isRecorded` — the junk filter. `additionalLearningNeeds` is a free-text
 *    box on the enrolment form, and a parent with nothing to declare types
 *    something anyway. Production (498 AY2026 applications, read 2026-08-09)
 *    has 65 rows populated, of which most read `NA`, `N/A`, `none` or `N.A.`.
 *    Those must reach the teacher as "Nothing recorded" and must NOT light the
 *    tab's content marker — a dot promising something, on a tab that then says
 *    "NA", is worse than no dot at all.
 *
 * 2. `buildStudentDetails` — which fields cross into a teacher's hands. The
 *    application row it reads from also carries NRIC, passport number, home
 *    address and the family's fee arrangement. The negative assertions below
 *    are the real guard: a future field added to the source row must not
 *    appear in the drawer just because someone widened a spread.
 */

import { describe, it, expect } from 'vitest';

import {
  buildStudentDetails,
  isRecorded,
  type StudentDetailsSource,
} from '@/lib/classroom/student-details';

/** A source row with everything empty — the shape, not the data. */
function emptySource(): StudentDetailsSource {
  return {
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
}

describe('isRecorded', () => {
  // Every spelling below was read out of production, not invented.
  it.each([
    'NA',
    'N/A',
    'N.A.',
    'na',
    'n/a',
    'none',
    'None',
    'NONE',
    'nil',
    '-',
    '--',
    '.',
    '',
    '   ',
  ])('treats %j as nothing recorded', (value) => {
    expect(isRecorded(value)).toBe(false);
  });

  it('treats null and undefined as nothing recorded', () => {
    expect(isRecorded(null)).toBe(false);
    expect(isRecorded(undefined)).toBe(false);
  });

  // Also from production. If any of these ever reads as junk, a real
  // declaration silently stops reaching the teacher.
  it.each([
    'SPED',
    'HAPI Learning Journey',
    'may need supplemental classes for Math',
    'JP has mild autism and would benefit from sitting in front',
    'Suffers from occasional Focal Epilepsy',
    'As per arrangements in AY2025',
  ])('treats %j as real content', (value) => {
    expect(isRecorded(value)).toBe(true);
  });

  it('does not mistake a word that merely contains a junk spelling', () => {
    // "Nanette" starts with "na"; "nonverbal" starts with "non". Matching on a
    // prefix rather than the whole trimmed value would drop both.
    expect(isRecorded('Nanette assists in class')).toBe(true);
    expect(isRecorded('nonverbal in large groups')).toBe(true);
  });
});

describe('buildStudentDetails — medical', () => {
  it('reports nothing medical on an empty row', () => {
    const d = buildStudentDetails(emptySource());
    expect(d.hasMedical).toBe(false);
    expect(d.medical.conditions).toEqual([]);
    expect(d.medical.notes).toEqual([]);
  });

  it('names each ticked condition', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      allergies: true,
      asthma: true,
      epilepsy: true,
    });
    expect(d.hasMedical).toBe(true);
    expect(d.medical.conditions).toEqual(['Allergies', 'Asthma', 'Epilepsy']);
  });

  it('carries the free-text details as notes beside the conditions', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      allergies: true,
      allergyDetails: 'Severe peanut allergy — carries an EpiPen',
      dietaryRestrictions: 'No nuts, no shellfish',
    });
    expect(d.medical.notes).toEqual([
      {
        label: 'Allergies',
        value: 'Severe peanut allergy — carries an EpiPen',
      },
      { label: 'Diet', value: 'No nuts, no shellfish' },
    ]);
  });

  it('counts a free-text note alone as medical, with no condition ticked', () => {
    // The production case that matters: a parent described a condition in a
    // details box while every checkbox stayed unticked. If `hasMedical` keyed
    // off the booleans alone, that child's safety strip would never render.
    const d = buildStudentDetails({
      ...emptySource(),
      otherMedicalConditions: 'Occasional focal epilepsy, assessment on file',
    });
    expect(d.hasMedical).toBe(true);
    expect(d.medical.conditions).toEqual([]);
  });

  it('ignores a details box holding junk', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      dietaryRestrictions: 'N/A',
      otherMedicalConditions: 'none',
    });
    expect(d.hasMedical).toBe(false);
    expect(d.medical.notes).toEqual([]);
  });

  it('reports paracetamol consent only when it is answered', () => {
    expect(buildStudentDetails(emptySource()).medical.paracetamol).toBeNull();
    expect(
      buildStudentDetails({ ...emptySource(), paracetamolConsent: true })
        .medical.paracetamol
    ).toBe(true);
    expect(
      buildStudentDetails({ ...emptySource(), paracetamolConsent: false })
        .medical.paracetamol
    ).toBe(false);
  });

  it('does not count consent alone as a reason to raise the safety strip', () => {
    // 25 students carry a consent answer and nothing else. A red strip reading
    // "paracetamol: yes" on all of them would train teachers to ignore it.
    const d = buildStudentDetails({
      ...emptySource(),
      paracetamolConsent: true,
    });
    expect(d.hasMedical).toBe(false);
  });
});

describe('buildStudentDetails — learning needs', () => {
  it('keeps a real declaration', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      additionalLearningNeeds:
        'Mild autism — benefits from sitting at the front',
    });
    expect(d.hasLearning).toBe(true);
    expect(d.learning).toEqual([
      {
        label: 'Additional learning needs',
        value: 'Mild autism — benefits from sitting at the front',
      },
    ]);
  });

  it('drops a junk declaration entirely', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      additionalLearningNeeds: 'NA',
      otherLearningNeeds: '-',
    });
    expect(d.hasLearning).toBe(false);
    expect(d.learning).toEqual([]);
  });
});

describe('a phone number arrives as a NUMBER, not a string', () => {
  // THE BUG THIS EXISTS FOR. Every mobile column on the admissions table is
  // numeric — `motherMobile` is a number on 498 of 498 AY2026 rows, and
  // `fatherMobile`, `guardianMobile` and `contactPersonNumber` likewise. The
  // first version of this module typed them `string | null` and called
  // `.toLowerCase()` on them, so the drawer threw `value.toLowerCase is not a
  // function` for EVERY student in the school, not just the one it was first
  // opened on. The type was a guess about the database; the database disagreed.
  //
  // Same shape as the known `residenceHistory` hazard: these columns have two
  // writers (the parent portal and the SIS edit route) and no shared schema,
  // so a type probe must scan every row, never the first non-null one.
  it('does not throw on a numeric mobile', () => {
    expect(() =>
      buildStudentDetails({
        ...emptySource(),
        motherFullName: 'Leslie Base',
        motherMobile: 87796901,
      })
    ).not.toThrow();
  });

  it('renders a numeric mobile as its digits', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      motherFullName: 'Leslie Base',
      motherMobile: 87796901,
      contactPerson: 'Leslie Base',
      contactPersonNumber: 87796901,
    });
    expect(d.contacts.people[0]?.mobile).toBe('87796901');
    expect(d.contacts.emergency?.mobile).toBe('87796901');
  });

  it('still treats a genuinely absent number as absent', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      motherFullName: 'Leslie Base',
      motherMobile: null,
    });
    expect(d.contacts.people[0]?.mobile).toBeNull();
  });

  it('does not read a numeric value as nothing-to-declare', () => {
    // `0` normalises to "0", which is not in the junk set — a number must never
    // be silently dropped the way "NA" is.
    expect(isRecorded(87796901)).toBe(true);
    expect(isRecorded(0)).toBe(true);
  });
});

describe('buildStudentDetails — contacts', () => {
  it('pairs each parent with their own number', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      motherFullName: 'Maricel Bautista',
      motherMobile: '+65 8123 4567',
      motherEmail: 'maricel@example.com',
      fatherFullName: 'Ramon Bautista',
      fatherMobile: '+65 9876 5432',
      contactPerson: 'Maricel Bautista',
      contactPersonNumber: '+65 8123 4567',
      livingWithWhom: 'Both parents',
    });
    expect(d.contacts.people).toEqual([
      {
        label: 'Mother',
        name: 'Maricel Bautista',
        mobile: '+65 8123 4567',
        email: 'maricel@example.com',
      },
      {
        label: 'Father',
        name: 'Ramon Bautista',
        mobile: '+65 9876 5432',
        email: null,
      },
    ]);
    expect(d.contacts.emergency).toEqual({
      name: 'Maricel Bautista',
      mobile: '+65 8123 4567',
    });
    expect(d.contacts.livingWith).toBe('Both parents');
  });

  it('omits a parent who is not on the record', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      motherFullName: 'Priya Chandran',
      motherMobile: '+65 8234 1122',
    });
    expect(d.contacts.people.map((p) => p.label)).toEqual(['Mother']);
  });

  it('keeps a guardian when there is one', () => {
    const d = buildStudentDetails({
      ...emptySource(),
      guardianFullName: 'Anna Lim',
      guardianMobile: '+65 8000 1111',
      guardianEmail: 'anna@example.com',
    });
    expect(d.contacts.people).toEqual([
      {
        label: 'Guardian',
        name: 'Anna Lim',
        mobile: '+65 8000 1111',
        email: 'anna@example.com',
      },
    ]);
  });

  it('keeps a named contact who has no number', () => {
    // Half a contact still tells a teacher who to ask for.
    const d = buildStudentDetails({
      ...emptySource(),
      motherFullName: 'Priya Chandran',
    });
    expect(d.contacts.people).toEqual([
      { label: 'Mother', name: 'Priya Chandran', mobile: null, email: null },
    ]);
  });
});

describe('buildStudentDetails — what must never cross', () => {
  it('carries no identity, immigration, address or money field', () => {
    // The guard with teeth. `StudentDetailsSource` is a narrow hand-written
    // type rather than `StudentDetail`, so widening it is a deliberate act —
    // and this serialised check fails if one of these words ever appears in
    // the output, however it got there.
    const d = buildStudentDetails({
      ...emptySource(),
      allergies: true,
      allergyDetails: 'Peanuts',
      motherFullName: 'Maricel Bautista',
    });
    const serialised = JSON.stringify(d).toLowerCase();
    for (const forbidden of [
      'nric',
      'passport',
      'passexpiry',
      'homeaddress',
      'postalcode',
      'payment',
      'discount',
      'fee',
      'withdraw',
      'birthday',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
