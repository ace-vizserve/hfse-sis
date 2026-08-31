import { describe, it, expect } from 'vitest';
import {
  resolveReportSubjects,
  type ReportMapEntry,
  type ReportTargetMeta,
} from '@/lib/report-card/resolve-report-subjects';
import type { SubjectRow } from '@/lib/report-card/build-report-card';

const emptyCell = { quarterly: null, letter: null, is_na: false };

function makeRow(overrides: Partial<SubjectRow> = {}): SubjectRow {
  return {
    subject: {
      id: 'sub-1',
      code: 'SUB1',
      name: 'Subject One',
      report_label: null,
      display_name: null,
      is_examinable: true,
    },
    t1: emptyCell,
    t2: emptyCell,
    t3: emptyCell,
    t4: emptyCell,
    annual: null,
    annual_letter: null,
    annual_letter_override: null,
    annual_letter_derived: null,
    t4_entry_id: null,
    t4_sheet_id: null,
    ...overrides,
  };
}

describe('resolveReportSubjects', () => {
  it('1. empty reportMap → output equals input, unchanged, same order', () => {
    const rows: SubjectRow[] = [
      makeRow({
        subject: {
          id: 'a',
          code: 'A',
          name: 'Alpha',
          report_label: null,
          display_name: null,
          is_examinable: true,
        },
      }),
      makeRow({
        subject: {
          id: 'b',
          code: 'B',
          name: 'Bravo',
          report_label: null,
          display_name: null,
          is_examinable: false,
        },
      }),
    ];
    const result = resolveReportSubjects(rows, [], new Map());
    expect(result).toEqual(rows);
  });

  it('2. all-self-maps → unchanged, no parentheticals, including a row with no grade data', () => {
    const rowA = makeRow({
      subject: {
        id: 'a',
        code: 'A',
        name: 'Alpha',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
      t1: { quarterly: 93, letter: null, is_na: false },
    });
    // No grade data at all — must still pass through (single-mapper groups
    // never data-gate).
    const rowB = makeRow({
      subject: {
        id: 'b',
        code: 'B',
        name: 'Bravo',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
    });
    const rows = [rowA, rowB];
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'a' },
      { subject_id: 'b', report_subject_id: 'b' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'a',
        {
          id: 'a',
          code: 'A',
          name: 'Alpha',
          report_label: null,
          display_name: null,
          is_examinable: true,
        },
      ],
      [
        'b',
        {
          id: 'b',
          code: 'B',
          name: 'Bravo',
          report_label: null,
          display_name: null,
          is_examinable: true,
        },
      ],
    ]);
    const result = resolveReportSubjects(rows, reportMap, reportTargets);
    expect(result).toEqual(rows);
  });

  it('2b. self-map carries a non-null report_label through untouched (does not compose into name)', () => {
    const rowA = makeRow({
      subject: {
        id: 'a',
        code: 'MAPEH',
        name: 'MAPEH',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'A', is_na: false },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'a' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'a',
        {
          id: 'a',
          code: 'MAPEH',
          name: 'MAPEH',
          report_label: 'STAR',
          display_name: null,
          is_examinable: false,
        },
      ],
    ]);
    const result = resolveReportSubjects([rowA], reportMap, reportTargets);
    expect(result).toHaveLength(1);
    // name stays the real catalog name — report_label is carried as its own
    // field, never composed into `.name`. Only the render layer
    // (report-card-document.tsx) resolves `report_label ?? name`.
    expect(result[0].subject).toEqual({
      id: 'a',
      code: 'MAPEH',
      name: 'MAPEH',
      report_label: 'STAR',
      display_name: null,
      is_examinable: false,
    });
  });

  it('3. fan-in, source A has data, source B is all-N.A. → one merged row labelled "{Target} (A)"', () => {
    const rowA = makeRow({
      subject: {
        id: 'a',
        code: 'FIL',
        name: 'Filipino',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'A', is_na: false },
    });
    const rowB = makeRow({
      subject: {
        id: 'b',
        code: 'MAN',
        name: 'Mandarin',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'NA', is_na: true },
      t2: { quarterly: null, letter: 'NA', is_na: true },
      t3: { quarterly: null, letter: 'NA', is_na: true },
      t4: { quarterly: null, letter: 'NA', is_na: true },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'mt' },
      { subject_id: 'b', report_subject_id: 'mt' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        {
          id: 'mt',
          code: 'MT',
          name: 'Mother Tongue',
          report_label: null,
          display_name: null,
          is_examinable: false,
        },
      ],
    ]);
    const result = resolveReportSubjects(
      [rowA, rowB],
      reportMap,
      reportTargets
    );
    expect(result).toHaveLength(1);
    expect(result[0].subject).toEqual({
      id: 'mt',
      code: 'MT',
      name: 'Mother Tongue (Filipino)',
      report_label: null,
      display_name: null,
      is_examinable: false,
    });
    expect(result[0].t1).toEqual(rowA.t1);
  });

  it('3b. fan-in composes report_label (target + source) into name, not the raw catalog name', () => {
    const rowA = makeRow({
      subject: {
        id: 'a',
        code: 'FIL',
        name: 'Filipino',
        report_label: 'Filipino Language',
        display_name: null,
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'A', is_na: false },
    });
    const rowB = makeRow({
      subject: {
        id: 'b',
        code: 'MAN',
        name: 'Mandarin',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'mt' },
      { subject_id: 'b', report_subject_id: 'mt' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        {
          id: 'mt',
          code: 'MT',
          name: 'Mother Tongue',
          report_label: 'MT',
          display_name: null,
          is_examinable: false,
        },
      ],
    ]);
    const result = resolveReportSubjects(
      [rowA, rowB],
      reportMap,
      reportTargets
    );
    expect(result).toHaveLength(1);
    // Target's report_label ("MT") and the winning source's report_label
    // ("Filipino Language") both win over their raw names.
    expect(result[0].subject.name).toBe('MT (Filipino Language)');
    // The composed string is already final — report_label is null on the
    // output row so no render-time fallback re-substitutes anything.
    expect(result[0].subject.report_label).toBeNull();
  });

  it('4. fan-in, the other direction (source B has data instead) → "{Target} (B)"', () => {
    const rowA = makeRow({
      subject: {
        id: 'a',
        code: 'FIL',
        name: 'Filipino',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
    });
    const rowB = makeRow({
      subject: {
        id: 'b',
        code: 'MAN',
        name: 'Mandarin',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'B', is_na: false },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'mt' },
      { subject_id: 'b', report_subject_id: 'mt' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        {
          id: 'mt',
          code: 'MT',
          name: 'Mother Tongue',
          report_label: null,
          display_name: null,
          is_examinable: false,
        },
      ],
    ]);
    const result = resolveReportSubjects(
      [rowA, rowB],
      reportMap,
      reportTargets
    );
    expect(result).toHaveLength(1);
    expect(result[0].subject.name).toBe('Mother Tongue (Mandarin)');
    expect(result[0].t1).toEqual(rowB.t1);
  });

  it('5. fan-in, neither source has data → row dropped entirely', () => {
    const rowA = makeRow({
      subject: {
        id: 'a',
        code: 'FIL',
        name: 'Filipino',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
    });
    const rowB = makeRow({
      subject: {
        id: 'b',
        code: 'MAN',
        name: 'Mandarin',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
    });
    const otherRow = makeRow({
      subject: {
        id: 'z',
        code: 'MATH',
        name: 'Mathematics',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
      t1: { quarterly: 90, letter: null, is_na: false },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'mt' },
      { subject_id: 'b', report_subject_id: 'mt' },
      { subject_id: 'z', report_subject_id: 'z' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        {
          id: 'mt',
          code: 'MT',
          name: 'Mother Tongue',
          report_label: null,
          display_name: null,
          is_examinable: false,
        },
      ],
      [
        'z',
        {
          id: 'z',
          code: 'MATH',
          name: 'Mathematics',
          report_label: null,
          display_name: null,
          is_examinable: true,
        },
      ],
    ]);
    const result = resolveReportSubjects(
      [rowA, rowB, otherRow],
      reportMap,
      reportTargets
    );
    // The fan-in row (Mother Tongue) is dropped entirely; the unrelated
    // single-mapper row survives unaffected.
    expect(result).toHaveLength(1);
    expect(result[0].subject.name).toBe('Mathematics');
  });

  it("6. single-mapper target that ISN'T a self-map → target's name, no parenthetical", () => {
    const rowA = makeRow({
      subject: {
        id: 'a',
        code: 'A',
        name: 'Alpha',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
      t1: { quarterly: 85, letter: null, is_na: false },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 't' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        't',
        {
          id: 't',
          code: 'T',
          name: 'Target Subject',
          report_label: null,
          display_name: null,
          is_examinable: true,
        },
      ],
    ]);
    const result = resolveReportSubjects([rowA], reportMap, reportTargets);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toEqual({
      id: 't',
      code: 'T',
      name: 'Target Subject',
      report_label: null,
      display_name: null,
      is_examinable: true,
    });
    // Cell data passes through unchanged (single-mapper groups never
    // data-gate, no matter what — this row happens to have data too, but
    // the point is it's not filtered).
    expect(result[0].t1).toEqual(rowA.t1);
  });

  it('7. invariant-guard case: two sources in the same fan-in group both have real data → deterministic pick, does not throw', () => {
    const rowA = makeRow({
      subject: {
        id: 'a',
        code: 'ZED',
        name: 'Zed Subject',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'A', is_na: false },
    });
    const rowB = makeRow({
      subject: {
        id: 'b',
        code: 'ALP',
        name: 'Alpha Subject',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'B', is_na: false },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'mt' },
      { subject_id: 'b', report_subject_id: 'mt' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        {
          id: 'mt',
          code: 'MT',
          name: 'Mother Tongue',
          report_label: null,
          display_name: null,
          is_examinable: false,
        },
      ],
    ]);
    expect(() =>
      resolveReportSubjects([rowA, rowB], reportMap, reportTargets)
    ).not.toThrow();
    const result = resolveReportSubjects(
      [rowA, rowB],
      reportMap,
      reportTargets
    );
    expect(result).toHaveLength(1);
    // Deterministic pick: 'Alpha Subject' sorts before 'Zed Subject'.
    expect(result[0].subject.name).toBe('Mother Tongue (Alpha Subject)');
    expect(result[0].t1).toEqual(rowB.t1);
  });

  it('8. sort-position check — a merged row sorts into the correct alphabetical position', () => {
    // Fan-in target "Mother Tongue" merges from Filipino/Mandarin. Its
    // merged label "Mother Tongue (Filipino)" should sort alphabetically by
    // "Mother Tongue…", landing between "Homeroom" and "Science".
    const homeroom = makeRow({
      subject: {
        id: 'hr',
        code: 'HR',
        name: 'Homeroom',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
      t1: { quarterly: 88, letter: null, is_na: false },
    });
    const filipino = makeRow({
      subject: {
        id: 'fil',
        code: 'FIL',
        name: 'Filipino',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'A', is_na: false },
    });
    const mandarin = makeRow({
      subject: {
        id: 'man',
        code: 'MAN',
        name: 'Mandarin',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
    });
    const science = makeRow({
      subject: {
        id: 'sci',
        code: 'SCI',
        name: 'Science',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
      t1: { quarterly: 91, letter: null, is_na: false },
    });
    // Deliberately pass rows pre-sorted by their OWN (unmerged) names so the
    // input order ("Filipino, Homeroom, Mandarin, Science") differs from
    // the expected output order once "Filipino"/"Mandarin" fold into
    // "Mother Tongue (Filipino)".
    const rows = [filipino, homeroom, mandarin, science];
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'fil', report_subject_id: 'mt' },
      { subject_id: 'man', report_subject_id: 'mt' },
      { subject_id: 'hr', report_subject_id: 'hr' },
      { subject_id: 'sci', report_subject_id: 'sci' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        {
          id: 'mt',
          code: 'MT',
          name: 'Mother Tongue',
          report_label: null,
          display_name: null,
          is_examinable: false,
        },
      ],
      [
        'hr',
        {
          id: 'hr',
          code: 'HR',
          name: 'Homeroom',
          report_label: null,
          display_name: null,
          is_examinable: true,
        },
      ],
      [
        'sci',
        {
          id: 'sci',
          code: 'SCI',
          name: 'Science',
          report_label: null,
          display_name: null,
          is_examinable: true,
        },
      ],
    ]);
    const result = resolveReportSubjects(rows, reportMap, reportTargets);
    expect(result.map((r) => r.subject.name)).toEqual([
      'Homeroom',
      'Mother Tongue (Filipino)',
      'Science',
    ]);
  });

  it('9. sort-position check — a non-null report_label sorts by its OWN value, not the raw name', () => {
    // "Alpha" is relabeled to print as "Zulu" — the final sort must reflect
    // where it's actually shown, not its catalog name's letter.
    const alpha = makeRow({
      subject: {
        id: 'a',
        code: 'A',
        name: 'Alpha',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
    });
    const bravo = makeRow({
      subject: {
        id: 'b',
        code: 'B',
        name: 'Bravo',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'a' },
      { subject_id: 'b', report_subject_id: 'b' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'a',
        {
          id: 'a',
          code: 'A',
          name: 'Alpha',
          report_label: 'Zulu',
          display_name: null,
          is_examinable: true,
        },
      ],
      [
        'b',
        {
          id: 'b',
          code: 'B',
          name: 'Bravo',
          report_label: null,
          display_name: null,
          is_examinable: true,
        },
      ],
    ]);
    const result = resolveReportSubjects(
      [alpha, bravo],
      reportMap,
      reportTargets
    );
    // Bravo ("Bravo") sorts before Alpha's relabeled "Zulu".
    expect(result.map((r) => r.subject.id)).toEqual(['b', 'a']);
  });
});

/**
 * The per-year name on a report card (migration 137).
 *
 * MAPEH became STAR in AY2026 and AY2025 keeps saying MAPEH, so the same
 * subject sorts and prints differently depending on whose card it is. These
 * pin the two places this file decides display text — the sort, and the
 * fan-in composition — because both were reading the raw catalogue name
 * before, and a card that sorts by one name while printing another is the
 * confusing half of getting this wrong.
 */
describe('resolveReportSubjects — the name the year uses', () => {
  it('sorts by this year’s name, not the catalogue name', () => {
    // Catalogue order would be Alpha then MAPEH. Renamed to STAR for this
    // year, MAPEH sorts second on the printed card either way — so use a name
    // that MOVES it: "Aardvark" must come first despite cataloguing as MAPEH.
    const alpha = makeRow({
      subject: {
        id: 'a',
        code: 'A',
        name: 'Alpha',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
    });
    const mapeh = makeRow({
      subject: {
        id: 'm',
        code: 'MAPEH',
        name: 'MAPEH',
        report_label: null,
        display_name: 'Aardvark',
        is_examinable: true,
      },
    });
    const result = resolveReportSubjects([alpha, mapeh], [], new Map());
    expect(result.map((r) => r.subject.id)).toEqual(['m', 'a']);
  });

  it('yields to the year’s report label — on a card, that is the more specific statement', () => {
    const row = makeRow({
      subject: {
        id: 'm',
        code: 'MAPEH',
        name: 'MAPEH',
        report_label: 'Zulu',
        display_name: 'Aardvark',
        is_examinable: true,
      },
    });
    const other = makeRow({
      subject: {
        id: 'b',
        code: 'B',
        name: 'Bravo',
        report_label: null,
        display_name: null,
        is_examinable: true,
      },
    });
    // Both overrides are per academic year since migration 138, so this is no
    // longer "specific beats global" — it is "the report card's own answer
    // beats the general one, on the report card". Sorting follows what the
    // card prints, so "Zulu" sorts after "Bravo".
    //
    // ⚠ The opposite is true everywhere else: subjectDisplayName cannot see a
    // report label at all, so a markbook screen sorts this row under
    // "Aardvark". That divergence is deliberate and is what
    // __tests__/sis/report-label-scope.test.ts protects.
    const result = resolveReportSubjects([other, row], [], new Map());
    expect(result.map((r) => r.subject.id)).toEqual(['b', 'm']);
  });

  it('composes a fan-in row from both sides’ per-year names', () => {
    const filipino = makeRow({
      subject: {
        id: 'fil',
        code: 'FIL',
        name: 'Filipino',
        report_label: null,
        display_name: 'Filipino (this year)',
        is_examinable: false,
      },
      t1: { quarterly: 92, letter: 'A', is_na: false },
    });
    const mandarin = makeRow({
      subject: {
        id: 'man',
        code: 'MAN',
        name: 'Mandarin',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'fil', report_subject_id: 'mt' },
      { subject_id: 'man', report_subject_id: 'mt' },
    ];
    const targets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        {
          id: 'mt',
          code: 'MT',
          name: 'Mother Tongue',
          report_label: null,
          display_name: 'Languages',
          is_examinable: false,
        },
      ],
    ]);

    const result = resolveReportSubjects(
      [filipino, mandarin],
      reportMap,
      targets
    );
    expect(result).toHaveLength(1);
    expect(result[0].subject.name).toBe('Languages (Filipino (this year))');
    // Both overrides cleared: the composed string IS the final text, so a
    // renderer must not re-substitute over it.
    expect(result[0].subject.display_name).toBeNull();
    expect(result[0].subject.report_label).toBeNull();
  });
});

/**
 * MOTHER TONGUE — the real production shape, and the two headings it produced.
 *
 * Read from production 2026-08-31:
 *   subject_report_map: FIL -> MT, MANDARIN -> MT, and MT -> MT (a self-map).
 *   Three mappers, so the group ALWAYS takes the real-fan-in branch.
 *
 *   AY2025  Mother Tongue is the graded sheet (88 sheets, 53 with marks);
 *           Filipino and Mandarin are attached but carry zero marks.
 *   AY2026  Filipino (31 sheets, 8 with marks) and Mandarin (10 / 5) are graded
 *           separately; Mother Tongue has no sheets at all.
 *
 * The school changed how it grades this mid-way, which is exactly the kind of
 * per-year fact migrations 137 and 138 exist to express. Before them the
 * headings read:
 *
 *   AY2025  "Mother Tongue (Mother Tongue)"          — the source IS the target
 *   AY2026  "Mother Tongue (Mother Tongue (Filipino))" — the label doubled up
 *
 * Both are pinned here because each had a different cause and only one of them
 * was fixed by dropping the global report label.
 */
describe('resolveReportSubjects — the Mother Tongue group', () => {
  const REPORT_MAP: ReportMapEntry[] = [
    { subject_id: 'fil', report_subject_id: 'mt' },
    { subject_id: 'man', report_subject_id: 'mt' },
    // ⚠ Mother Tongue maps to ITSELF. This is the row that makes the group a
    // three-mapper fan-in in every year, including years where nothing fans in.
    { subject_id: 'mt', report_subject_id: 'mt' },
  ];

  const TARGETS = new Map<string, ReportTargetMeta>([
    [
      'mt',
      {
        id: 'mt',
        code: 'MT',
        name: 'Mother Tongue',
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
    ],
  ]);

  function lang(id: string, code: string, name: string, graded: boolean) {
    return makeRow({
      subject: {
        id,
        code,
        name,
        report_label: null,
        display_name: null,
        is_examinable: false,
      },
      ...(graded ? { t1: { quarterly: 92, letter: 'A', is_na: false } } : {}),
    });
  }

  it('AY2025 — graded under Mother Tongue itself, so no parenthetical', () => {
    // The source IS the target. A parenthetical exists to say WHICH track a
    // student took when the heading alone cannot; here it says nothing, and
    // saying it anyway printed "Mother Tongue (Mother Tongue)" on every AY2025
    // card.
    const result = resolveReportSubjects(
      [
        lang('mt', 'MT', 'Mother Tongue', true),
        lang('fil', 'FIL', 'Filipino', false),
        lang('man', 'MANDARIN', 'Mandarin', false),
      ],
      REPORT_MAP,
      TARGETS
    );
    expect(result).toHaveLength(1);
    expect(result[0].subject.name).toBe('Mother Tongue');
  });

  it('AY2026 — graded under Filipino, so exactly one parenthetical', () => {
    // The doubling came from FIL carrying a report_label of "Mother Tongue
    // (Filipino)" — a hand-written copy of the heading this function already
    // composes. Migration 138 dropped that global column without carrying the
    // value over, so the composition is the only source of the parenthetical.
    const result = resolveReportSubjects(
      [
        lang('fil', 'FIL', 'Filipino', true),
        lang('man', 'MANDARIN', 'Mandarin', false),
      ],
      REPORT_MAP,
      TARGETS
    );
    expect(result).toHaveLength(1);
    expect(result[0].subject.name).toBe('Mother Tongue (Filipino)');
  });

  it('a per-year report label still wins on both halves', () => {
    // The label is not gone, it is per year now. A year that genuinely wants
    // different words on the card can still say so, and both halves of the
    // composition honour it.
    const targets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        {
          id: 'mt',
          code: 'MT',
          name: 'Mother Tongue',
          report_label: 'Languages',
          display_name: null,
          is_examinable: false,
        },
      ],
    ]);
    const filipino = makeRow({
      subject: {
        id: 'fil',
        code: 'FIL',
        name: 'Filipino',
        report_label: 'Filipino Language',
        display_name: null,
        is_examinable: false,
      },
      t1: { quarterly: 92, letter: 'A', is_na: false },
    });
    const result = resolveReportSubjects(
      [filipino, lang('man', 'MANDARIN', 'Mandarin', false)],
      REPORT_MAP,
      targets
    );
    expect(result[0].subject.name).toBe('Languages (Filipino Language)');
  });
});
