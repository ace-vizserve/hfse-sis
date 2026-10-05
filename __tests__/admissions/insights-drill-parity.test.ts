// __tests__/admissions/insights-drill-parity.test.ts
//
// KD #82/#124/#229: every figure on /admissions/insights equals the row count
// of the drill it opens. The fixture carries every case that has broken this
// before: blank and unknown statuses, a status with stray spaces, an
// application with no applicant number, a status row with no application, a
// duplicated status row, an enrolment stamped hours before its application,
// a level label containing '|', and enough reasons / sources / nationalities
// to force each top-N chart to fold an "Other" bucket. Two academic years, so
// the comparison year is checked on its own rows.

import { describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: () => ({
    from: (table: string) => ({
      select: () => ({
        range: () =>
          Promise.resolve({ data: fx.tables[table] ?? [], error: null }),
      }),
    }),
  }),
}));

// The enrolment form options' level mapping: "Year 9" counts as Secondary
// Three. Every chart and its drill must resolve through it the same way.
vi.mock('@/lib/admissions/level-resolver', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/admissions/level-resolver')>();
  const { makeLevelLabelResolver } = await import('@/lib/sis/levels');
  const resolver = makeLevelLabelResolver(
    [
      {
        id: 'lv-s3',
        code: 'S3',
        label: 'Secondary Three',
        levelType: 'secondary',
        sortOrder: 30,
        nextLevelId: null,
        isCore: true,
      },
    ],
    [{ raw_label: 'Year 9', level_id: 'lv-s3' }]
  );
  return {
    ...actual,
    loadAdmissionsLevelResolver: () => Promise.resolve(resolver),
  };
});

import {
  getAverageTimeToEnrollment,
  getConversionByAssessment,
  getConversionFunnel,
} from '@/lib/admissions/dashboard';
import { applyTargetFilter, buildDrillRows } from '@/lib/admissions/drill';
import {
  getAdmissionsTerminalReasons,
  selectTopReasonBars,
} from '@/lib/admissions/insights';
import { getIntakeTrendByAy } from '@/lib/admissions/insights-compare';
import {
  getApplicantNationalityByLevel,
  getCategoryMix,
  getNationalityMix,
  getReferralConversion,
  getWithdrawnByLevel,
} from '@/lib/admissions/insights-funnel';
import {
  encodePairSegment,
  OTHER_REASONS_BAR_KEY,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

// ── Fixture ───────────────────────────────────────────────────────────────

const STATUSES = [
  'Submitted',
  'Ongoing Verification',
  'Processing',
  'Enrolled',
  'Enrolled (Conditional)',
  'Cancelled',
  'Withdrawn',
  '',
  'Deferred',
  'Enrolled ',
];
const LEVELS = [
  'P1',
  'P2',
  'S1',
  'Youngstarters | Little Stars',
  'YoungStarter Little Star',
  '',
  null,
  // A parent-facing name mapped to Secondary Three, and the SIS label itself
  // — one bucket between them, never a "Year 9" bucket of its own.
  'Year 9',
  'Secondary Three',
];
const SOURCES = [
  'Facebook',
  'Google',
  'Friend',
  'Walk-in',
  'Instagram',
  'Newspaper',
  'Event',
  'Agent',
  'Radio',
  'Billboard',
  '',
  null,
];
const CATEGORIES = ['New', 'Current', 'VizSchool New', 'Nonsense', null];
const NATIONALITIES = [
  'Singapore',
  'Singapore',
  'Philippines',
  'Philippines',
  'Viet Nam',
  'Vietnam',
  'India',
  'China',
  'Japan',
  'Malaysia',
  'Indonesia',
  'Thailand',
  'Australia',
  'Canada',
  null,
  '  ',
];
const REASONS = [
  'chose_another_school',
  'visa_denied',
  'lost_interest',
  'financial',
  'family_relocation',
  'Moved to Johor',
  'Health',
  '   ',
  null,
];
const GRADES = ['<p>93.55% (29/31)</p>', '40%', null, 'B', 'F'];
const CREATED = [
  '2026-01-10T02:00:00.000Z',
  '2026-02-03T09:00:00.000Z',
  '2026-03-31T20:00:00.000Z',
  '2025-12-15T03:00:00.000Z',
  '2026-07-01T01:00:00.000Z',
  '2026-11-30T05:00:00.000Z',
];

function buildYear(prefix: string, n: number, seed: number) {
  const apps: Array<Record<string, unknown>> = [];
  const statuses: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const k = i + seed;
    const enroleeNumber = `E${seed}-${i}`;
    const createdAt = i % 17 === 0 ? null : CREATED[k % CREATED.length];
    const enrolledAt =
      createdAt && i % 4 !== 0
        ? new Date(
            Date.parse(createdAt) +
              (i % 4 === 1 ? -6 * 3_600_000 : (k % 40) * 86_400_000)
          ).toISOString()
        : null;
    apps.push({
      enroleeNumber,
      studentNumber: null,
      enroleeFullName: `Child ${seed}-${i}`,
      firstName: 'Child',
      lastName: `${seed}-${i}`,
      levelApplied: LEVELS[k % LEVELS.length],
      created_at: createdAt,
      howDidYouKnowAboutHFSEIS: SOURCES[k % SOURCES.length],
      category: CATEGORIES[k % CATEGORIES.length],
      nationality: NATIONALITIES[k % NATIONALITIES.length],
    });
    statuses.push({
      enroleeNumber,
      applicationStatus: STATUSES[k % STATUSES.length],
      applicationUpdatedDate: null,
      enrolledAt,
      classLevel: i % 5 === 0 ? 'P3' : null,
      levelApplied: null,
      assessmentGradeMath: GRADES[k % GRADES.length],
      assessmentGradeEnglish: GRADES[(k + 2) % GRADES.length],
      applicationTerminalReason:
        i % 2 === 0 ? REASONS[k % REASONS.length] : null,
    });
  }
  // An application with no applicant number — no drill can list it.
  apps.push({
    enroleeNumber: null,
    enroleeFullName: 'No number',
    levelApplied: 'P1',
    created_at: '2026-01-20T00:00:00.000Z',
    howDidYouKnowAboutHFSEIS: 'Facebook',
    category: 'New',
    nationality: 'Singapore',
  });
  // A status row with no application behind it.
  statuses.push({
    enroleeNumber: `ORPHAN-${seed}`,
    applicationStatus: 'Withdrawn',
    applicationTerminalReason: 'financial',
  });
  // A second status row for one applicant — the last one wins.
  statuses.push({
    enroleeNumber: `E${seed}-5`,
    applicationStatus: 'Cancelled',
    applicationTerminalReason: 'visa_denied',
  });
  fx.tables[`${prefix}_enrolment_applications`] = apps;
  fx.tables[`${prefix}_enrolment_status`] = statuses;
}

buildYear('ay2026', 60, 0);
buildYear('ay2025', 25, 7);

const YEARS = ['AY2026', 'AY2025'] as const;

// ── Demand & conversion ───────────────────────────────────────────────────

describe('Applications received, conversion rate and average days', () => {
  it.each(YEARS)(
    '%s: Applications received equals the Submitted list',
    async (ay) => {
      const funnel = await getConversionFunnel(ay);
      const rows = await buildDrillRows({ ayCode: ay });
      const submitted = funnel.find((s) => s.stage === 'Submitted')!.count;
      expect(submitted).toBeGreaterThan(0);
      expect(applyTargetFilter(rows, 'funnel-stage', 'Submitted')).toHaveLength(
        submitted
      );
    }
  );

  it('the enrolled share of that list is the conversion numerator', async () => {
    const funnel = await getConversionFunnel('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    const enrolled = funnel.find((s) => s.stage === 'Enrolled')!.count;
    const list = applyTargetFilter(rows, 'funnel-stage', 'Submitted');
    expect(
      list.filter(
        (r) => r.status === 'Enrolled' || r.status === 'Enrolled (Conditional)'
      )
    ).toHaveLength(enrolled);
  });

  it('Avg. days to enrol: the sample is the list, the average its mean', async () => {
    const t = await getAverageTimeToEnrollment('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    const list = applyTargetFilter(rows, 'avg-time');
    expect(t.sampleSize).toBeGreaterThan(0);
    expect(list).toHaveLength(t.sampleSize);
    const mean = Math.round(
      list.reduce((s, r) => s + (r.daysToEnroll ?? 0), 0) / list.length
    );
    expect(t.avgDays).toBe(mean);
  });
});

describe('Applications per month', () => {
  it('each point, in both years, equals that year’s intake-month list', async () => {
    const points = await getIntakeTrendByAy([
      { ayCode: 'AY2026', isCurrent: false },
      { ayCode: 'AY2025', isCurrent: false },
    ]);
    for (const ay of YEARS) {
      const rows = await buildDrillRows({ ayCode: ay });
      const mine = points.filter((p) => p.ayCode === ay);
      expect(mine.length).toBe(11);
      for (const p of mine) {
        expect(
          applyTargetFilter(rows, 'intake-month', p.periodLabel)
        ).toHaveLength(p.value ?? 0);
      }
    }
  });
});

// ── Who & why we lose ─────────────────────────────────────────────────────

describe('Withdrawn by level', () => {
  it('each slice and the total equal the withdrawn-by-level list', async () => {
    const byLevel = await getWithdrawnByLevel('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(byLevel.length).toBeGreaterThan(1);
    for (const r of byLevel) {
      expect(
        applyTargetFilter(rows, 'withdrawn-by-level', r.level)
      ).toHaveLength(r.count);
    }
    expect(applyTargetFilter(rows, 'withdrawn-by-level')).toHaveLength(
      byLevel.reduce((s, r) => s + r.count, 0)
    );
  });
});

describe('Level names resolve through the enrolment form mapping', () => {
  it('a "Year 9" applicant counts under Secondary Three, on the chart and in its list', async () => {
    const [withdrawn, nat, terminal, rows] = await Promise.all([
      getWithdrawnByLevel('AY2026'),
      getApplicantNationalityByLevel('AY2026'),
      getAdmissionsTerminalReasons('AY2026'),
      buildDrillRows({ ayCode: 'AY2026' }),
    ]);
    const levels = [
      ...withdrawn.map((r) => r.level),
      ...nat.rows.map((r) => r.level),
      ...terminal.byLevel.map((r) => r.level),
      ...rows.map((r) => r.level),
      ...rows.map((r) => r.levelAsApplied),
    ];
    expect(levels).not.toContain('Year 9');
    expect(levels).toContain('Secondary Three');
    // Both spellings land in one Secondary Three bucket, and its list is the
    // same size.
    const s3 = withdrawn.find((r) => r.level === 'Secondary Three');
    if (s3) {
      expect(
        applyTargetFilter(rows, 'withdrawn-by-level', 'Secondary Three')
      ).toHaveLength(s3.count);
    }
  });
});

describe('Entrance assessment', () => {
  it('each bar opens exactly the applicants it is a rate of', async () => {
    const conv = await getConversionByAssessment('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    const OUTCOME = {
      Pass: 'pass',
      Fail: 'fail',
      'Not assessed': 'notAssessed',
    };
    expect(conv.length).toBe(6);
    for (const c of conv) {
      const seg = `${c.subject === 'Math' ? 'math' : 'eng'}:${OUTCOME[c.outcome]}`;
      expect(applyTargetFilter(rows, 'assessment-all', seg)).toHaveLength(
        c.applied
      );
    }
  });
});

describe('Cancellation reasons', () => {
  it('each slice — the overflow included — equals its list', async () => {
    const t = await getAdmissionsTerminalReasons('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    const bars = selectTopReasonBars(t.overall);
    expect(bars.some((b) => b.key === OTHER_REASONS_BAR_KEY)).toBe(true);
    for (const b of bars) {
      const seg = encodePairSegment(
        '',
        b.key === OTHER_REASONS_BAR_KEY ? OVERFLOW_SEGMENT : b.key
      );
      expect(applyTargetFilter(rows, 'terminal-reason', seg)).toHaveLength(
        b.count
      );
    }
    expect(applyTargetFilter(rows, 'terminal-reason')).toHaveLength(t.total);
  });

  it('each "top reason per level" row equals its level’s list', async () => {
    const t = await getAdmissionsTerminalReasons('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(t.byLevel.some((l) => l.level.includes('|'))).toBe(true);
    for (const lvl of t.byLevel) {
      expect(
        applyTargetFilter(
          rows,
          'terminal-reason',
          encodePairSegment(lvl.level, '')
        )
      ).toHaveLength(lvl.count);
    }
  });
});

// ── Channels & segments ───────────────────────────────────────────────────

describe('By source', () => {
  it('each slice — the folded Other included — equals its list', async () => {
    const refs = await getReferralConversion('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(refs.some((r) => r.folded === true)).toBe(true);
    for (const r of refs) {
      expect(
        applyTargetFilter(
          rows,
          'referral-all',
          r.folded ? OVERFLOW_SEGMENT : r.source
        )
      ).toHaveLength(r.applied);
    }
  });
});

describe('By category', () => {
  it.each(YEARS)('%s: each bar equals its category list', async (ay) => {
    const mix = await getCategoryMix(ay);
    const rows = await buildDrillRows({ ayCode: ay });
    expect(mix.some((c) => c.category === 'Unspecified')).toBe(true);
    for (const c of mix) {
      expect(applyTargetFilter(rows, 'category', c.category)).toHaveLength(
        c.count
      );
    }
  });
});

describe('Nationality', () => {
  it('each pie slice — Other and Unspecified included — equals its list', async () => {
    const mix = await getNationalityMix('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(mix.some((r) => r.nationality === 'Other')).toBe(true);
    expect(mix.some((r) => r.nationality === 'Unspecified')).toBe(true);
    for (const r of mix) {
      expect(
        applyTargetFilter(
          rows,
          'nationality',
          encodePairSegment('', r.nationality)
        )
      ).toHaveLength(r.count);
    }
  });

  it('each level × nationality segment equals its list', async () => {
    const byLevel = await getApplicantNationalityByLevel('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(byLevel.legend).toContain('Other');
    for (const lvl of byLevel.rows) {
      for (const seg of lvl.segments) {
        expect(
          applyTargetFilter(
            rows,
            'nationality',
            encodePairSegment(lvl.level, seg.nationality)
          )
        ).toHaveLength(seg.count);
      }
    }
  });
});
