import { describe, it, expect } from 'vitest';
import {
  canonicaliseLevelApplied,
  canonicaliseNationality,
  computeNationalityByLevel,
  computeNationalityMix,
} from '@/lib/admissions/insights-funnel';
import { computeEnrolledNationalityMix } from '@/lib/sis/records-insights';

// The cases below are not invented — they mirror what a read-only probe found
// in production on 2026-08-17 across 1,557 applications
// (scripts/probe-nationality-values.ts): zero blanks, zero case collisions,
// and exactly two values off the canonical country list, of which "Viet Nam"
// co-existed with "Vietnam" in the same academic year.

const rows = (...values: (string | null)[]) =>
  values.map((nationality) => ({ nationality }));

// ──────────────────────────────────────────────────────────────────────────
// canonicaliseNationality
// ──────────────────────────────────────────────────────────────────────────
describe('canonicaliseNationality', () => {
  it('returns null for null, empty and whitespace-only values', () => {
    expect(canonicaliseNationality(null)).toBeNull();
    expect(canonicaliseNationality('')).toBeNull();
    expect(canonicaliseNationality('   ')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(canonicaliseNationality('  Singapore  ')).toBe('Singapore');
  });

  it('collapses internal whitespace', () => {
    expect(canonicaliseNationality('United  Kingdom')).toBe('United Kingdom');
  });

  it('snaps a recognised country to its canonical casing', () => {
    expect(canonicaliseNationality('philippines')).toBe('Philippines');
    expect(canonicaliseNationality('SINGAPORE')).toBe('Singapore');
  });

  it('maps the "Viet Nam" spelling seen in AY2025 onto "Vietnam"', () => {
    expect(canonicaliseNationality('Viet Nam')).toBe('Vietnam');
    expect(canonicaliseNationality('viet nam')).toBe('Vietnam');
  });

  it('preserves an unrecognised value exactly as the parent typed it', () => {
    // A real place countries-list simply names differently. Renaming it would
    // be guessing at the family's meaning; dropping it would lose a student.
    expect(canonicaliseNationality('Sint Maarten (Dutch part)')).toBe(
      'Sint Maarten (Dutch part)'
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeNationalityMix
// ──────────────────────────────────────────────────────────────────────────
describe('computeNationalityMix', () => {
  it('returns an empty array for no rows', () => {
    expect(computeNationalityMix([])).toEqual([]);
  });

  it('counts and sorts most common first', () => {
    const out = computeNationalityMix(
      rows('Singapore', 'Philippines', 'Philippines')
    );
    expect(out).toEqual([
      { nationality: 'Philippines', count: 2 },
      { nationality: 'Singapore', count: 1 },
    ]);
  });

  it('breaks count ties alphabetically so ordering is stable', () => {
    const out = computeNationalityMix(rows('Vietnam', 'India', 'Bangladesh'));
    expect(out.map((r) => r.nationality)).toEqual([
      'Bangladesh',
      'India',
      'Vietnam',
    ]);
  });

  it('merges spelling variants into one bar instead of splitting them', () => {
    // The exact AY2025 defect: 3 × "Viet Nam" + 1 × "Vietnam" must be one bar
    // of 4, not two bars of 3 and 1.
    const out = computeNationalityMix(
      rows('Viet Nam', 'Viet Nam', 'Viet Nam', 'Vietnam')
    );
    expect(out).toEqual([{ nationality: 'Vietnam', count: 4 }]);
  });

  it('omits Unspecified entirely when nothing is blank', () => {
    const out = computeNationalityMix(rows('Singapore'));
    expect(out.some((r) => r.nationality === 'Unspecified')).toBe(false);
  });

  it('appends Unspecified only when blanks exist, and always last', () => {
    const out = computeNationalityMix(
      rows(null, '', '  ', 'Singapore', 'Singapore')
    );
    expect(out).toEqual([
      { nationality: 'Singapore', count: 2 },
      { nationality: 'Unspecified', count: 3 },
    ]);
  });

  it('does not fold when the distinct count equals the limit', () => {
    const out = computeNationalityMix(rows('A', 'B', 'C'), 3);
    expect(out).toHaveLength(3);
    expect(out.some((r) => r.nationality === 'Other')).toBe(false);
  });

  it('folds the long tail into Other and reports how many it hides', () => {
    const out = computeNationalityMix(rows('A', 'B', 'C', 'D'), 2);
    const other = out.find((r) => r.nationality === 'Other');
    expect(other).toEqual({ nationality: 'Other', count: 2, foldedCount: 2 });
  });

  it('never loses a student: the buckets always sum to the input length', () => {
    const input = rows(
      'Philippines',
      'Philippines',
      'Singapore',
      'India',
      'Vietnam',
      'Viet Nam',
      null,
      ''
    );
    const out = computeNationalityMix(input, 2);
    expect(out.reduce((s, r) => s + r.count, 0)).toBe(input.length);
  });

  it('sorts Other and Unspecified last even when they are the largest', () => {
    const out = computeNationalityMix(
      rows(null, null, null, null, 'A', 'B', 'B', 'C', 'C', 'C'),
      1
    );
    expect(out.map((r) => r.nationality)).toEqual([
      'C',
      'Other',
      'Unspecified',
    ]);
  });

  it('treats a zero limit as folding everything', () => {
    const out = computeNationalityMix(rows('A', 'B'), 0);
    expect(out).toEqual([{ nationality: 'Other', count: 2, foldedCount: 2 }]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeEnrolledNationalityMix — the Records cross
// ──────────────────────────────────────────────────────────────────────────
describe('computeEnrolledNationalityMix', () => {
  const lookup = new Map([
    ['E1', 'Philippines'],
    ['E2', 'Singapore'],
  ]);

  it('returns an empty array when nobody is enrolled', () => {
    expect(computeEnrolledNationalityMix([], lookup)).toEqual([]);
  });

  it('resolves each enrolled student through their admissions row', () => {
    const out = computeEnrolledNationalityMix(
      [
        { enroleeNumber: 'E1' },
        { enroleeNumber: 'E2' },
        { enroleeNumber: 'E1' },
      ],
      lookup
    );
    expect(out).toEqual([
      { nationality: 'Philippines', count: 2 },
      { nationality: 'Singapore', count: 1 },
    ]);
  });

  it('buckets an unlinked student rather than dropping them', () => {
    // A null enrolee_number, or one with no admissions row, must still be
    // counted — the chart total has to equal the enrolled headcount.
    const enrolled = [
      { enroleeNumber: 'E1' },
      { enroleeNumber: null },
      { enroleeNumber: 'NOT_IN_ADMISSIONS' },
    ];
    const out = computeEnrolledNationalityMix(enrolled, lookup);
    expect(out).toEqual([
      { nationality: 'Philippines', count: 1 },
      { nationality: 'Unspecified', count: 2 },
    ]);
    expect(out.reduce((s, r) => s + r.count, 0)).toBe(enrolled.length);
  });

  it('trims the enrolee number before looking it up', () => {
    const out = computeEnrolledNationalityMix(
      [{ enroleeNumber: ' E2 ' }],
      lookup
    );
    expect(out).toEqual([{ nationality: 'Singapore', count: 1 }]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// canonicaliseLevelApplied
//
// All six spellings below were observed in production on 2026-08-17.
// ──────────────────────────────────────────────────────────────────────────
describe('canonicaliseLevelApplied', () => {
  it('labels a blank level rather than dropping the applicant', () => {
    // 79 of 822 AY2025 rows are blank — they must stay visible.
    expect(canonicaliseLevelApplied(null)).toBe('Not specified');
    expect(canonicaliseLevelApplied('   ')).toBe('Not specified');
  });

  it('folds the four Little Stars spellings into one level', () => {
    for (const raw of [
      'Youngstarters | Little Stars',
      'YoungStarter Little Star',
      'youngstarters little stars',
      'YOUNGSTARTER  LITTLE  STAR',
    ]) {
      expect(canonicaliseLevelApplied(raw)).toBe(
        'Youngstarters | Little Stars'
      );
    }
  });

  it('keeps the Youngstarters sub-levels distinct from each other', () => {
    expect(canonicaliseLevelApplied('YoungStarter Junior Star')).toBe(
      'Youngstarters | Junior Stars'
    );
    expect(canonicaliseLevelApplied('Youngstarters | Senior Stars')).toBe(
      'Youngstarters | Senior Stars'
    );
    expect(canonicaliseLevelApplied('Youngstarters')).toBe('Youngstarters');
  });

  it('leaves the canonical primary and secondary labels untouched', () => {
    expect(canonicaliseLevelApplied('Primary One')).toBe('Primary One');
    expect(canonicaliseLevelApplied('Secondary Four')).toBe('Secondary Four');
  });

  it('passes an unrecognised level through so a new one is visible', () => {
    expect(canonicaliseLevelApplied('Junior College One')).toBe(
      'Junior College One'
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeNationalityByLevel
// ──────────────────────────────────────────────────────────────────────────
describe('computeNationalityByLevel', () => {
  const at = (level: string, nationality: string | null, n = 1) =>
    Array.from({ length: n }, () => ({ level, nationality }));

  it('returns empty legend and rows for no input', () => {
    expect(computeNationalityByLevel([])).toEqual({ legend: [], rows: [] });
  });

  it('orders levels canonically, not alphabetically', () => {
    // Alphabetically "Primary One" < "Primary Two" < "Secondary One", but the
    // real order is P1, P2, S1 — and P10 must not sort between P1 and P2.
    const out = computeNationalityByLevel([
      ...at('Secondary One', 'Singapore'),
      ...at('Primary Two', 'Singapore'),
      ...at('Primary One', 'Singapore'),
    ]);
    expect(out.rows.map((r) => r.level)).toEqual([
      'Primary One',
      'Primary Two',
      'Secondary One',
    ]);
  });

  it('picks the top nationalities globally so a colour means one thing', () => {
    // Vietnam is the biggest name in Primary Two, but is globally third. With
    // a limit of 2 it must fold into Other there rather than take a legend
    // slot that means something else on the other bar.
    const out = computeNationalityByLevel(
      [
        ...at('Primary One', 'Philippines', 5),
        ...at('Primary One', 'Singapore', 4),
        ...at('Primary Two', 'Vietnam', 3),
      ],
      2
    );
    expect(out.legend).toEqual(['Philippines', 'Singapore', 'Other']);
    const p2 = out.rows.find((r) => r.level === 'Primary Two');
    expect(p2?.segments).toEqual([{ nationality: 'Other', count: 3 }]);
  });

  it("normalises each level's total to its own headcount", () => {
    const out = computeNationalityByLevel([
      ...at('Primary One', 'Philippines', 3),
      ...at('Primary One', 'Singapore', 1),
      ...at('Primary Two', 'Philippines', 1),
    ]);
    expect(out.rows.map((r) => [r.level, r.total])).toEqual([
      ['Primary One', 4],
      ['Primary Two', 1],
    ]);
  });

  it('applies the same spelling aliases as the flat mix', () => {
    const out = computeNationalityByLevel([
      ...at('Primary One', 'Viet Nam', 2),
      ...at('Primary One', 'Vietnam'),
    ]);
    expect(out.legend).toEqual(['Vietnam']);
    expect(out.rows[0].segments).toEqual([
      { nationality: 'Vietnam', count: 3 },
    ]);
  });

  it('keeps students with no nationality as their own segment', () => {
    const out = computeNationalityByLevel([
      ...at('Primary One', 'Singapore'),
      ...at('Primary One', null),
    ]);
    expect(out.legend).toEqual(['Singapore', 'Unspecified']);
    expect(out.rows[0].total).toBe(2);
  });

  it('omits Other and Unspecified from the legend when unused', () => {
    const out = computeNationalityByLevel(at('Primary One', 'Singapore', 2));
    expect(out.legend).toEqual(['Singapore']);
  });

  it('buckets a blank level under Unknown rather than dropping the student', () => {
    const out = computeNationalityByLevel([
      { level: null, nationality: 'Singapore' },
      { level: '   ', nationality: 'Singapore' },
    ]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].level).toBe('Unknown');
    expect(out.rows[0].total).toBe(2);
  });

  it('never loses a student across the whole grid', () => {
    const input = [
      ...at('Primary One', 'Philippines', 3),
      ...at('Primary One', null),
      ...at('Primary Two', 'Vietnam', 2),
      ...at('Secondary One', 'India'),
    ];
    const out = computeNationalityByLevel(input, 1);
    const summed = out.rows.reduce((s, r) => s + r.total, 0);
    expect(summed).toBe(input.length);
  });
});
