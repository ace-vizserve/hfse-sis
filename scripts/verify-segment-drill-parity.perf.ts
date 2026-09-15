/**
 * Every CHART-SEGMENT drill, on live data: click a donut slice or a bar, does
 * the sheet show that slice's rows?
 *
 * The failure mode here is not a small gap, it is a silent fall-through. A
 * chart emits a human label ('Term 1 · Locked'); a target filter that doesn't
 * recognise it hits `return rows` and the sheet shows EVERY row in the year
 * (markbook's `drill-filter.ts` records two of these already fixed), or hits
 * `return []` and shows none. Both look plausible on screen.
 *
 * So every segment is fed to the drill exactly as the chart component emits it,
 * and three things are checked:
 *   FALLTHROUGH — the segment returned the whole unfiltered set
 *   DEAD        — the segment returned nothing at all
 *   PARTITION   — disjoint segments that should cover the set don't sum to it
 *
 * NOT A TEST — hits the live database, reachable only via
 * `scripts/vitest.perf.config.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

const AY = 'AY2026';
const FROM = '2000-01-01';
const TO = '2100-01-01';

type Check = {
  module: string;
  target: string;
  segment: string;
  rows: number;
  all: number;
  verdict: 'ok' | 'FALLTHROUGH' | 'DEAD';
};
const checks: Check[] = [];
const partitions: Array<{
  module: string;
  target: string;
  note: string;
  sum: number;
  expected: number;
  verdict: 'ok' | 'PARTITION';
}> = [];

function check(
  module: string,
  target: string,
  segment: string,
  rows: number,
  all: number
) {
  const verdict: Check['verdict'] =
    rows === all && all > 1 ? 'FALLTHROUGH' : rows === 0 ? 'DEAD' : 'ok';
  checks.push({ module, target, segment, rows, all, verdict });
  return rows;
}

function partition(
  module: string,
  target: string,
  note: string,
  sum: number,
  expected: number
) {
  partitions.push({
    module,
    target,
    note,
    sum,
    expected,
    verdict: sum === expected ? 'ok' : 'PARTITION',
  });
}

const uniq = <T>(xs: T[]) => Array.from(new Set(xs));

describe('chart-segment drills', () => {
  it('markbook', async () => {
    const { buildMarkbookDrillRows } = await import('@/lib/markbook/drill');
    const { GRADE_BANDS } = await import('@/lib/markbook/drill-filter');
    const rowsFor = (target: string, segment: string | null) =>
      buildMarkbookDrillRows({
        ayCode: AY,
        from: FROM,
        to: TO,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target: target as any,
        segment,
        allowedSectionIds: null,
      });

    const allSheets = (await rowsFor('term-sheet-status', null)) as Array<{
      termNumber: number;
      sectionId: string;
      sectionName: string;
      isLocked: boolean;
      isPublished: boolean;
    }>;
    const terms = uniq(allSheets.map((s) => s.termNumber)).sort();

    // SheetProgressChart emits `${termLabel} · Locked` / `· Open`, termLabel
    // being `Term ${term_number}` (lib/markbook/dashboard.ts).
    let sum = 0;
    for (const t of terms) {
      for (const state of ['Locked', 'Open']) {
        const seg = `Term ${t} · ${state}`;
        sum += check(
          'markbook',
          'term-sheet-status',
          seg,
          (await rowsFor('term-sheet-status', seg)).length,
          allSheets.length
        );
      }
    }
    partition(
      'markbook',
      'term-sheet-status',
      'term x locked/open covers every sheet',
      sum,
      allSheets.length
    );

    // PublicationCoverageChart emits `${termLabel} · Published` / `· Unpublished`.
    // The target dedupes to one row per section, so the partition is over
    // distinct (term, section) pairs.
    let pubSum = 0;
    for (const t of terms) {
      for (const state of ['Published', 'Unpublished']) {
        const seg = `Term ${t} · ${state}`;
        pubSum += check(
          'markbook',
          'term-publication-status',
          seg,
          (await rowsFor('term-publication-status', seg)).length,
          allSheets.length
        );
      }
    }
    partition(
      'markbook',
      'term-publication-status',
      'term x published/unpublished covers every (term, section)',
      pubSum,
      uniq(allSheets.map((s) => `${s.termNumber}|${s.sectionId}`)).length
    );

    let covSum = 0;
    for (const seg of ['published', 'not-published']) {
      covSum += check(
        'markbook',
        'publication-coverage',
        seg,
        (await rowsFor('publication-coverage', seg)).length,
        allSheets.length
      );
    }
    partition(
      'markbook',
      'publication-coverage',
      'published + not-published covers every sheet',
      covSum,
      allSheets.length
    );

    // SheetReadinessCard emits the section NAME.
    let readySum = 0;
    for (const name of uniq(allSheets.map((s) => s.sectionName))) {
      readySum += check(
        'markbook',
        'sheet-readiness-section',
        name,
        (await rowsFor('sheet-readiness-section', name)).length,
        allSheets.length
      );
    }
    partition(
      'markbook',
      'sheet-readiness-section',
      'sections cover every OPEN sheet',
      readySum,
      allSheets.filter((s) => !s.isLocked).length
    );

    // GradeDistributionChart emits the bucket KEY; applyTargetFilter also
    // accepts the label, so both forms are exercised.
    const allBuckets = (await rowsFor('grade-bucket-entries', null)) as Array<{
      gradeBucket: string | null;
    }>;
    let bandSum = 0;
    for (const band of GRADE_BANDS) {
      bandSum += check(
        'markbook',
        'grade-bucket-entries',
        band.key,
        (await rowsFor('grade-bucket-entries', band.key)).length,
        allBuckets.length
      );
      check(
        'markbook',
        'grade-bucket-entries(label)',
        band.label,
        (await rowsFor('grade-bucket-entries', band.label)).length,
        allBuckets.length
      );
    }
    partition(
      'markbook',
      'grade-bucket-entries',
      'bands cover every examinable graded entry',
      bandSum,
      allBuckets.filter((r) => r.gradeBucket != null).length
    );

    // TeacherEntryVelocityCard emits the teacher EMAIL (enteredBy).
    const allEntries = (await rowsFor(
      'teacher-entry-velocity',
      null
    )) as Array<{
      enteredBy: string | null;
    }>;
    let teacherSum = 0;
    for (const email of uniq(
      allEntries.map((r) => r.enteredBy).filter((e): e is string => !!e)
    )) {
      teacherSum += check(
        'markbook',
        'teacher-entry-velocity',
        email,
        (await rowsFor('teacher-entry-velocity', email)).length,
        allEntries.length
      );
    }
    partition(
      'markbook',
      'teacher-entry-velocity',
      'teachers cover every attributed entry',
      teacherSum,
      allEntries.filter((r) => r.enteredBy != null).length
    );

    expect(checks.length).toBeGreaterThan(0);
  });

  it('p-files', async () => {
    const { buildPFilesDrillRows, applyTargetFilter } =
      await import('@/lib/p-files/drill');
    const data = await buildPFilesDrillRows({ ayCode: AY, from: FROM, to: TO });
    const all = data.rows;
    const rowsFor = (target: string, segment: string | null) =>
      applyTargetFilter(
        data,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target as any,
        segment,
        { from: FROM, to: TO }
      ).length;

    // SlotStatusDrillCard emits the display status.
    let statusSum = 0;
    for (const s of uniq(all.map((r) => r.status))) {
      statusSum += check(
        'p-files',
        'slot-by-status',
        s,
        rowsFor('slot-by-status', s),
        all.length
      );
    }
    // 'Expired' deliberately also returns 'Missing' (KD #82), so the buckets
    // overlap by exactly the Missing count.
    partition(
      'p-files',
      'slot-by-status',
      'statuses cover every slot (+Missing double-counted by the Expired slice)',
      statusSum,
      all.length + all.filter((r) => r.status === 'Missing').length
    );

    let levelSum = 0;
    for (const lvl of uniq(all.map((r) => r.level ?? 'Unknown'))) {
      levelSum += check(
        'p-files',
        'level-applicants',
        lvl,
        rowsFor('level-applicants', lvl),
        all.length
      );
    }
    partition(
      'p-files',
      'level-applicants',
      'levels cover every slot',
      levelSum,
      all.length
    );

    let slotSum = 0;
    for (const k of uniq(all.map((r) => r.slotKey))) {
      slotSum += check(
        'p-files',
        'missing-by-slot',
        k,
        rowsFor('missing-by-slot', k),
        all.length
      );
    }
    partition(
      'p-files',
      'missing-by-slot',
      'slots cover every MISSING slot',
      slotSum,
      all.filter((r) => r.status === 'Missing').length
    );

    expect(checks.length).toBeGreaterThan(0);
  });

  it('records', async () => {
    const { buildRecordsDrillRows, applyTargetFilter } =
      await import('@/lib/sis/drill');
    const { DOCUMENT_SLOTS: PFILES_SLOTS } =
      await import('@/lib/p-files/document-config');
    const all = await buildRecordsDrillRows(
      { ayCode: AY, from: FROM, to: TO },
      { withDocs: true, withDocSlotBuckets: true }
    );
    const rowsFor = (target: string, segment: string | null) =>
      applyTargetFilter(
        all,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target as any,
        segment,
        { from: FROM, to: TO }
      ).length;

    let lvlSum = 0;
    for (const lvl of uniq(all.map((r) => r.level ?? 'Unknown'))) {
      lvlSum += check(
        'records',
        'students-by-level',
        lvl,
        rowsFor('students-by-level', lvl),
        all.length
      );
    }
    partition(
      'records',
      'students-by-level',
      'levels cover every listed student',
      lvlSum,
      rowsFor('students-by-level', null)
    );

    // DocumentBacklogChart emits `${slotLabel}|${bucket}` for four buckets.
    for (const slot of PFILES_SLOTS) {
      for (const bucket of ['valid', 'pending', 'rejected', 'missing']) {
        const seg = `${slot.label}|${bucket}`;
        check(
          'records',
          'backlog-by-document',
          seg,
          rowsFor('backlog-by-document', seg),
          all.length
        );
      }
    }

    expect(checks.length).toBeGreaterThan(0);
  });

  it('admissions', async () => {
    const { buildDrillRows, applyTargetFilter } =
      await import('@/lib/admissions/drill');
    const all = await buildDrillRows(
      { ayCode: AY, from: FROM, to: TO },
      { withDocs: true, target: 'doc-completion' }
    );
    const rowsFor = (target: string, segment: string | null) =>
      applyTargetFilter(
        all,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target as any,
        segment
      ).length;

    let stageSum = 0;
    for (const st of uniq(all.map((r) => r.status))) {
      stageSum += check(
        'admissions',
        'pipeline-stage',
        st,
        rowsFor('pipeline-stage', st),
        all.length
      );
    }
    partition(
      'admissions',
      'pipeline-stage',
      'statuses cover every application',
      stageSum,
      all.length
    );

    // Cumulative funnel — not a partition, but each stage must narrow.
    for (const st of [
      'Submitted',
      'Ongoing Verification',
      'Processing',
      'Enrolled',
    ]) {
      check(
        'admissions',
        'funnel-stage',
        st,
        rowsFor('funnel-stage', st),
        all.length
      );
    }

    for (const lvl of uniq(all.map((r) => r.level ?? 'Unknown'))) {
      check(
        'admissions',
        'applications-by-level',
        lvl,
        rowsFor('applications-by-level', lvl),
        all.length
      );
    }

    for (const seg of ['missing', 'complete']) {
      check(
        'admissions',
        'doc-completion',
        seg,
        rowsFor('doc-completion', seg),
        all.length
      );
    }
    partition(
      'admissions',
      'doc-completion',
      'missing + complete covers every non-terminal application',
      rowsFor('doc-completion', 'missing') +
        rowsFor('doc-completion', 'complete'),
      rowsFor('doc-completion', null) +
        rowsFor('doc-completion', 'complete') -
        0
    );

    // AssessmentOutcomesChart emits the outcome, and `subject:outcome`.
    const outcomes = uniq(
      all.map((r) => r.assessmentOutcome).filter((v): v is string => !!v)
    );
    for (const o of outcomes) {
      check(
        'admissions',
        'assessment',
        o,
        rowsFor('assessment', o),
        all.length
      );
      check(
        'admissions',
        'assessment(math)',
        `math:${o}`,
        rowsFor('assessment', `math:${o}`),
        all.length
      );
      check(
        'admissions',
        'assessment(eng)',
        `eng:${o}`,
        rowsFor('assessment', `eng:${o}`),
        all.length
      );
    }

    // ReferralSourceChart emits the source, 'Not specified', or the
    // '__other__:a|b|c' encoding of the named top-N.
    const sources = uniq(
      all.map((r) => r.referralSource).filter((v): v is string => !!v)
    );
    for (const s of sources) {
      check('admissions', 'referral', s, rowsFor('referral', s), all.length);
    }
    check(
      'admissions',
      'referral',
      'Not specified',
      rowsFor('referral', 'Not specified'),
      all.length
    );
    check(
      'admissions',
      'referral',
      `__other__:${sources.slice(0, 3).join('|')}`,
      rowsFor('referral', `__other__:${sources.slice(0, 3).join('|')}`),
      all.length
    );

    expect(checks.length).toBeGreaterThan(0);
  });

  it('attendance', async () => {
    const { buildAttendanceDrillRows } = await import('@/lib/attendance/drill');
    const { DAY_TYPE_LABELS } = await import('@/lib/schemas/attendance');
    const rowsFor = (target: string, segment: string | null) =>
      buildAttendanceDrillRows({
        ayCode: AY,
        from: FROM,
        to: TO,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target: target as any,
        segment,
      });

    const allEntries = (await rowsFor('ex-reason', null)) as Array<{
      exReason: string | null;
      attendanceDate: string;
    }>;
    // The donut's own label vocabulary (lib/attendance/dashboard.ts LABEL map).
    let exSum = 0;
    for (const seg of [
      'MC / Excuse leave',
      'Compassionate',
      'Vacation leave',
      'Other',
    ]) {
      exSum += check(
        'attendance',
        'ex-reason',
        seg,
        (await rowsFor('ex-reason', seg)).length,
        allEntries.length
      );
    }
    partition(
      'attendance',
      'ex-reason',
      'reason slices cover every excused mark',
      exSum,
      allEntries.length
    );

    const allDays = (await rowsFor('day-type', null)) as Array<{
      dayType: string;
    }>;
    let dtSum = 0;
    for (const label of Object.values(DAY_TYPE_LABELS) as string[]) {
      dtSum += check(
        'attendance',
        'day-type',
        label,
        (await rowsFor('day-type', label)).length,
        allDays.length
      );
    }
    partition(
      'attendance',
      'day-type',
      'day-type slices cover every calendar day',
      dtSum,
      allDays.length
    );

    // A per-day drill on three real dates.
    const dates = uniq(allEntries.map((e) => e.attendanceDate)).slice(0, 3);
    for (const d of dates) {
      check(
        'attendance',
        'daily-attendance-day',
        d,
        (await rowsFor('daily-attendance-day', d)).length,
        allEntries.length
      );
    }

    expect(checks.length).toBeGreaterThan(0);
  });

  it('evaluation', async () => {
    const { buildEvaluationDrillRows } = await import('@/lib/evaluation/drill');
    const rowsFor = (target: string, segment: string | null) =>
      buildEvaluationDrillRows({
        ayCode: AY,
        from: FROM,
        to: TO,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target: target as any,
        segment,
        allowedSectionIds: null,
      });

    const all = (await rowsFor('submission-velocity-day', null)) as Array<{
      submittedAt: string | null;
      sectionName: string;
    }>;
    const days = uniq(
      all
        .map((r) => r.submittedAt?.slice(0, 10))
        .filter((d): d is string => !!d)
    ).slice(0, 3);
    for (const d of days) {
      check(
        'evaluation',
        'submission-velocity-day',
        d,
        (await rowsFor('submission-velocity-day', d)).length,
        all.length
      );
    }
    check(
      'evaluation',
      'writeups-by-section',
      all[0]?.sectionName ?? 'n/a',
      (await rowsFor('writeups-by-section', all[0]?.sectionName ?? null))
        .length,
      all.length
    );

    expect(checks.length).toBeGreaterThan(0);
  });

  it('reports', () => {
    const bad = checks.filter((c) => c.verdict !== 'ok');
    const badPart = partitions.filter((p) => p.verdict !== 'ok');
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        `segments checked: ${checks.length}   partitions checked: ${partitions.length}`,
        '',
        `--- SUSPECT SEGMENTS (${bad.length}) ---`,
        ...bad.map(
          (c) =>
            `${c.verdict.padEnd(12)} ${c.module.padEnd(11)} ${c.target.padEnd(28)} seg="${c.segment}" rows=${c.rows} allRows=${c.all}`
        ),
        '',
        `--- BROKEN PARTITIONS (${badPart.length}) ---`,
        ...badPart.map(
          (p) =>
            `PARTITION    ${p.module.padEnd(11)} ${p.target.padEnd(28)} sum=${p.sum} expected=${p.expected}  (${p.note})`
        ),
        '',
        `--- OK partitions ---`,
        ...partitions
          .filter((p) => p.verdict === 'ok')
          .map(
            (p) =>
              `ok           ${p.module.padEnd(11)} ${p.target.padEnd(28)} ${p.sum}`
          ),
        '',
      ].join('\n')
    );
  });
});
