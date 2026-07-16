/**
 * computeCatalogForLevelType() — the pure decision logic behind
 * lib/sis/subjects/queries.ts::listCatalogForLevelType (Task 1 of the
 * "Unified Subject Setup page" plan; extracted per review finding — this
 * branchy logic had zero test coverage). Covers the three rules the
 * function encodes: the offering-state collapse to on/off/mixed, the
 * Mother Tongue exclusion, and the cross-level-type inclusion/exclusion
 * rule. Mirrors __tests__/sis/subject-config-gaps.test.ts's fixture style
 * (pure comparison function, source-agnostic {id, code} shapes).
 */

import { describe, expect, it } from 'vitest';

import { computeCatalogForLevelType } from '@/lib/sis/subjects/queries';
import { MOTHER_TONGUE_UMBRELLA_CODE } from '@/lib/schemas/subject';

// Two primary levels actually offered this AY; a third, secondary-only
// level ('lvl-s1') is deliberately NOT in this set so subjects offered only
// there exercise the cross-level-type exclusion rule.
const PRIMARY_LEVEL_IDS = ['lvl-p1', 'lvl-p2'];

const SUBJECTS = [
  {
    id: 'sub-math',
    code: 'MATH',
    name: 'Mathematics',
    is_examinable: true,
    grading_method: 'standard_sheet' as const,
  },
  {
    id: 'sub-sci',
    code: 'SCI',
    name: 'Science',
    is_examinable: true,
    grading_method: 'standard_sheet' as const,
  },
  {
    id: 'sub-artd',
    code: 'ARTD',
    name: 'Art & Design',
    is_examinable: false,
    grading_method: 'no_sheet' as const,
  },
  {
    id: 'sub-hist',
    code: 'HIST',
    name: 'History',
    is_examinable: true,
    grading_method: 'standard_sheet' as const,
  },
  {
    id: 'sub-mt',
    code: MOTHER_TONGUE_UMBRELLA_CODE,
    name: 'Mother Tongue',
    is_examinable: false,
    grading_method: 'no_sheet' as const,
  },
  {
    id: 'sub-fil',
    code: 'FIL',
    name: 'Filipino',
    is_examinable: true,
    grading_method: 'standard_sheet' as const,
  },
  {
    id: 'sub-mandarin',
    code: 'MANDARIN',
    name: 'Mandarin',
    is_examinable: true,
    grading_method: 'standard_sheet' as const,
  },
];

// MATH: on at both primary levels → 'on'.
// SCI: on at only one of the two primary levels → 'mixed'.
// ARTD: no offerings anywhere → included as 'off' (a genuinely new,
//   unattached subject — must still surface somewhere to be attached).
// HIST: offered only at the secondary-only level → not this catalog's
//   subject, excluded entirely.
// MT: offered at a primary level too, but must never surface as its own
//   row regardless.
// FIL / MANDARIN: Mother Tongue's real graded subjects — ordinary rows,
//   each self-reporting into MT via subject_report_map below.
const OFFERINGS = [
  { subject_id: 'sub-math', level_id: 'lvl-p1' },
  { subject_id: 'sub-math', level_id: 'lvl-p2' },
  { subject_id: 'sub-sci', level_id: 'lvl-p1' },
  { subject_id: 'sub-hist', level_id: 'lvl-s1' },
  { subject_id: 'sub-mt', level_id: 'lvl-p1' },
  { subject_id: 'sub-fil', level_id: 'lvl-p1' },
  { subject_id: 'sub-fil', level_id: 'lvl-p2' },
  { subject_id: 'sub-mandarin', level_id: 'lvl-p1' },
];

const REPORT_MAP = [
  { subject_id: 'sub-fil', report_subject_id: 'sub-mt' },
  { subject_id: 'sub-mandarin', report_subject_id: 'sub-mt' },
];

const CONFIGS: never[] = [];

describe('computeCatalogForLevelType', () => {
  it('(a) marks a subject offered at every requested-type level as "on"', () => {
    const rows = computeCatalogForLevelType(
      SUBJECTS,
      CONFIGS,
      OFFERINGS,
      REPORT_MAP,
      PRIMARY_LEVEL_IDS
    );
    expect(rows.find((r) => r.code === 'MATH')?.offeringState).toBe('on');
  });

  it('(b) marks a subject offered at some but not all requested-type levels as "mixed"', () => {
    const rows = computeCatalogForLevelType(
      SUBJECTS,
      CONFIGS,
      OFFERINGS,
      REPORT_MAP,
      PRIMARY_LEVEL_IDS
    );
    expect(rows.find((r) => r.code === 'SCI')?.offeringState).toBe('mixed');
  });

  it('(c) marks a subject offered at zero levels of the requested type as "off" but still includes it', () => {
    const rows = computeCatalogForLevelType(
      SUBJECTS,
      CONFIGS,
      OFFERINGS,
      REPORT_MAP,
      PRIMARY_LEVEL_IDS
    );
    const artd = rows.find((r) => r.code === 'ARTD');
    expect(artd).toBeDefined();
    expect(artd?.offeringState).toBe('off');
    expect(artd?.offeredLevelIds).toEqual([]);
  });

  it('(d) excludes a subject offered only at the OTHER level type entirely', () => {
    const rows = computeCatalogForLevelType(
      SUBJECTS,
      CONFIGS,
      OFFERINGS,
      REPORT_MAP,
      PRIMARY_LEVEL_IDS
    );
    expect(rows.find((r) => r.code === 'HIST')).toBeUndefined();
  });

  it('(e) never surfaces Mother Tongue itself as a row, even when it has offerings', () => {
    const rows = computeCatalogForLevelType(
      SUBJECTS,
      CONFIGS,
      OFFERINGS,
      REPORT_MAP,
      PRIMARY_LEVEL_IDS
    );
    expect(
      rows.find((r) => r.code === MOTHER_TONGUE_UMBRELLA_CODE)
    ).toBeUndefined();
  });

  it('(f) surfaces Filipino/Mandarin as ordinary rows, self-reporting into Mother Tongue', () => {
    const rows = computeCatalogForLevelType(
      SUBJECTS,
      CONFIGS,
      OFFERINGS,
      REPORT_MAP,
      PRIMARY_LEVEL_IDS
    );
    const fil = rows.find((r) => r.code === 'FIL');
    const mandarin = rows.find((r) => r.code === 'MANDARIN');

    expect(fil).toBeDefined();
    expect(fil?.offeringState).toBe('on');
    expect(fil?.reportSubjectCode).toBe(MOTHER_TONGUE_UMBRELLA_CODE);

    expect(mandarin).toBeDefined();
    expect(mandarin?.offeringState).toBe('mixed');
    expect(mandarin?.reportSubjectCode).toBe(MOTHER_TONGUE_UMBRELLA_CODE);
  });

  it('sorts rows alphabetically by name', () => {
    const rows = computeCatalogForLevelType(
      SUBJECTS,
      CONFIGS,
      OFFERINGS,
      REPORT_MAP,
      PRIMARY_LEVEL_IDS
    );
    const names = rows.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  // Task 2 — needsAttention derivation (migration 085's weights_confirmed
  // column). The load-bearing case Task 1's report flagged: a subject with
  // a subject_configs row (hasConfig=true) whose weights are still an
  // unconfirmed assumption (migration 082's GP/COMP/ARTD/PESTD stand-in
  // rows, which are all grading_method='standard_sheet' per that
  // migration) must still read needsAttention=true — a naive `!hasConfig`
  // check would miss it. These two cases use SCI (not the fixture's ARTD,
  // whose test-only grading_method is 'no_sheet' — see the dedicated
  // no_sheet-exclusion block below) so they exercise a standard_sheet
  // subject, matching the real GP/COMP/ARTD/PESTD rows this comment refers
  // to.
  describe('needsAttention (weights_confirmed)', () => {
    it('flags a subject with NO config row at all', () => {
      const rows = computeCatalogForLevelType(
        SUBJECTS,
        CONFIGS, // empty — no configs anywhere
        OFFERINGS,
        REPORT_MAP,
        PRIMARY_LEVEL_IDS
      );
      const sci = rows.find((r) => r.code === 'SCI');
      expect(sci?.hasConfig).toBe(false);
      expect(sci?.needsAttention).toBe(true);
    });

    it('flags a subject whose config row exists but is unconfirmed (the GP/COMP/ARTD/PESTD case)', () => {
      const rows = computeCatalogForLevelType(
        SUBJECTS,
        [
          {
            id: 'cfg-sci',
            academic_year_id: 'ay-1',
            subject_id: 'sub-sci',
            ww_weight: 0.3,
            pt_weight: 0.5,
            qa_weight: 0.2,
            ww_max_slots: 5,
            pt_max_slots: 5,
            qa_max: 30,
            weights_confirmed: false,
          },
        ],
        OFFERINGS,
        REPORT_MAP,
        PRIMARY_LEVEL_IDS
      );
      const sci = rows.find((r) => r.code === 'SCI');
      expect(sci?.hasConfig).toBe(true);
      expect(sci?.needsAttention).toBe(true);
    });

    it('does NOT flag a subject whose config row is confirmed', () => {
      const rows = computeCatalogForLevelType(
        SUBJECTS,
        [
          {
            id: 'cfg-math',
            academic_year_id: 'ay-1',
            subject_id: 'sub-math',
            ww_weight: 0.4,
            pt_weight: 0.4,
            qa_weight: 0.2,
            ww_max_slots: 5,
            pt_max_slots: 5,
            qa_max: 30,
            weights_confirmed: true,
          },
        ],
        OFFERINGS,
        REPORT_MAP,
        PRIMARY_LEVEL_IDS
      );
      const math = rows.find((r) => r.code === 'MATH');
      expect(math?.hasConfig).toBe(true);
      expect(math?.needsAttention).toBe(false);
    });
  });

  // Fix pass (review finding) — needsAttention must NOT fire for a
  // grading_method='no_sheet' subject, regardless of its config state.
  // Per the JSDoc above needsAttention in lib/sis/subjects/queries.ts, a
  // no_sheet subject renders a deliberate "No sheet" chip in the Weights
  // column instead of a gap — so it must never be flagged as needing
  // attention, even with no config row or an unconfirmed one (both of
  // which are otherwise needsAttention triggers per the block above). The
  // fixture's ARTD ('sub-artd') is grading_method='no_sheet' and has zero
  // offerings anywhere (see the offeringState='off' case (c) above), which
  // makes it the natural fixture subject for this — before the fix, these
  // two cases would have read needsAttention=true (the latent bug: an
  // admin who flips a subject to no_sheet via SubjectConfigForm could never
  // clear this flag through the UI, since the weights-save control hides
  // once grading_method='no_sheet').
  describe('needsAttention excludes grading_method=no_sheet subjects', () => {
    it('does NOT flag a no_sheet subject with no config row at all', () => {
      const rows = computeCatalogForLevelType(
        SUBJECTS,
        CONFIGS, // empty — no configs anywhere
        OFFERINGS,
        REPORT_MAP,
        PRIMARY_LEVEL_IDS
      );
      const artd = rows.find((r) => r.code === 'ARTD');
      expect(artd?.grading_method).toBe('no_sheet');
      expect(artd?.hasConfig).toBe(false);
      expect(artd?.needsAttention).toBe(false);
    });

    it('does NOT flag a no_sheet subject whose config row is unconfirmed', () => {
      const rows = computeCatalogForLevelType(
        SUBJECTS,
        [
          {
            id: 'cfg-artd',
            academic_year_id: 'ay-1',
            subject_id: 'sub-artd',
            ww_weight: 0.3,
            pt_weight: 0.5,
            qa_weight: 0.2,
            ww_max_slots: 5,
            pt_max_slots: 5,
            qa_max: 30,
            weights_confirmed: false,
          },
        ],
        OFFERINGS,
        REPORT_MAP,
        PRIMARY_LEVEL_IDS
      );
      const artd = rows.find((r) => r.code === 'ARTD');
      expect(artd?.grading_method).toBe('no_sheet');
      expect(artd?.hasConfig).toBe(true);
      expect(artd?.needsAttention).toBe(false);
    });
  });
});
