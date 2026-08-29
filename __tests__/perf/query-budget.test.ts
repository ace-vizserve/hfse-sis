/**
 * Baseline query/write budgets for six real surfaces, measured with the
 * counting harness (`__tests__/_utils/counting-supabase.ts`).
 *
 * WHY THIS EXISTS. The project owner's standing rule for this whole pass is
 * "measure, don't estimate" — a prior audit raised six HIGH findings and half
 * evaporated against production. This file is the pre-fix snapshot every
 * later phase is judged against: a later phase is only allowed to claim a win
 * if `roundTrips` or, more importantly, `waves` on one of these six actually
 * moves. Numbers here are EXPECTED to look bad — that is the point of a
 * baseline, not a defect in this file.
 *
 * DISCIPLINE, matching `__tests__/data/no-unpaginated-high-volume-reads.test.ts`'s
 * allowlist: every seeded number below carries the date it was measured and a
 * one-line note on what it covers. If a fix changes one of these numbers,
 * update the seed AND the date — a stale number here is worse than none,
 * because it would silently stop being the thing a later phase compares
 * against.
 *
 * HOW EACH SURFACE IS WIRED TO THE HARNESS. Three shapes appear:
 *
 *   1. FUNCTIONS THAT TAKE AN INJECTED CLIENT (`buildReportCard`,
 *      `recomputeSheetEntries`, `logActions`) — measured directly via
 *      `measureQueries`, exactly as __tests__/report-card/build-report-card.test.ts
 *      already does for the first of the three.
 *
 *   2. FUNCTIONS/ROUTES THAT CALL `createServiceClient()` THEMSELVES
 *      (`loadAdviserAttendanceDashboard`, `app/api/relief/book/route.ts`) —
 *      `@/lib/supabase/service` is mocked so every internal
 *      `createServiceClient()` call in the whole call graph returns the SAME
 *      counting client, via a module-scoped mutable binding
 *      (`currentCountingClient`) the mock factory reads by closure. This is
 *      the same "swap the client the code under test would have created"
 *      pattern __tests__/sis/assignment-relief-switch.test.ts already uses
 *      for a hand-rolled fake; here the fake is the shared counting client so
 *      roundTrips/waves come out the other end.
 *
 *   3. THE CLASSROOM SECTION PAGE — `app/(classroom)/classroom/[sectionId]/page.tsx`
 *      is a React Server Component (icons, shadcn primitives, `next/navigation`).
 *      No test in this repo imports a `page.tsx` and calls it as a plain
 *      function, and inventing that pattern for one baseline number is a
 *      bigger risk than the number is worth. Instead `runClassroomSectionPageLoader`
 *      below reproduces the page's OWN sequence of calls line-for-line
 *      (cited by line range at its definition) using the REAL exported
 *      loader functions the page calls — so the data-fetching fan-out is
 *      genuine, only the JSX and the access/session gate above it are
 *      stood in for. This is stated as an approximation, not hidden as if it
 *      were the page itself.
 *
 * CACHED / CONFIG DEPENDENCIES ARE MOCKED OUT, not measured, matching the
 * existing precedent in build-report-card.test.ts: `getSchoolConfig`
 * (`lib/sis/school-config.ts`) and the two calendar readers
 * (`lib/attendance/calendar.ts`) are both real production reads in their own
 * right, but they are TTL-cached (`unstable_cache`) and already the subject
 * of their own dated measurements elsewhere — counting them here would double
 * -count a cost this file is not trying to size. `getClassroomHealth`
 * (`lib/classroom/health.ts`) is mocked out for the same reason.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createCountingClient,
  findDuplicateQueries,
  measureQueries,
  summarize,
  withCountingClock,
  type CountingSupabase,
  type Fixtures,
} from '../_utils/counting-supabase';

// ── Shared mocks (module-scoped, read by every describe block below) ───────

// Cached / TTL-wrapped config readers — mocked exactly as
// __tests__/report-card/build-report-card.test.ts already does, so their own
// (separately TTL-bounded) cost is not double-counted here.
vi.mock('@/lib/sis/school-config', () => {
  const cfg = {
    principalName: '',
    ceoName: '',
    peiRegistrationNumber: '',
    defaultPublishWindowDays: 7,
    defaultCompassionateAllowancePerYear: 5,
    defaultVlAllowancePerTerm: 1,
    subjectAwardBronzeMin: 88.5,
    subjectAwardSilverMin: 91.5,
    subjectAwardGoldMin: 95.5,
    subjectAwardMax: 100,
    organizationName: 'HFSE Global Education Group',
    addressLine1: '',
    addressLine2: '',
    phoneNumber: '',
    websiteUrl: '',
    contactEmail: '',
    peiRegistrationStartDate: null,
    peiRegistrationEndDate: null,
    logoUrl: '',
  };
  return {
    DEFAULT_SCHOOL_CONFIG: cfg,
    getSchoolConfig: () => Promise.resolve(cfg),
  };
});

vi.mock('@/lib/attendance/calendar', () => ({
  // Every date in the window reads as encodable, so a section is always "a
  // school day today" — keeps loadAdviserAttendanceDashboard on its main
  // path (describeNonSchoolDay, itself calendar-backed, is deliberately not
  // exercised here for the same double-counting reason as school-config).
  getEncodableDatesForTerm: vi.fn().mockResolvedValue(['2026-08-01']),
  getDedupedSchoolCalendarForTerm: vi.fn().mockResolvedValue([]),
}));

const getStaffDisplayNameByIdMock = vi.fn().mockResolvedValue([]);
const getTeacherListMock = vi.fn(async (_opts?: unknown) => [
  {
    id: 'relief-1',
    email: 'relief@hfse.test',
    name: 'Ms Relief',
    disabled: false,
  },
]);
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: () => getStaffDisplayNameByIdMock(),
  getTeacherList: (opts?: unknown) => getTeacherListMock(opts),
}));

// `createServiceClient()` is called directly inside the call graph of
// loadAdviserAttendanceDashboard and the relief-book route (shape 2 above).
// Every call returns whichever counting client the current test assigned —
// null between tests so a stray call surfaces as a crash, not a silent pass.
let currentCountingClient: CountingSupabase | null = null;
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => currentCountingClient,
}));

// The admissions project is a SECOND Supabase client (KD #17) but the same
// PostgREST surface, so it returns the same counting client — a cross-project
// read still costs a round trip and still occupies a wave, which is the only
// property this file measures. Used by the attendance student-detail surface
// below, which resolves an enroleeNumber out of the AY-prefixed tables.
vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: () => currentCountingClient,
}));

const requireCapabilityMock = vi.fn((_capability?: string) =>
  Promise.resolve({
    user: { id: 'admin-1', email: 'admin@hfse.test' },
    role: 'school_admin',
  })
);
vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: (capability: string) => requireCapabilityMock(capability),
}));

const invalidateDrillTagsMock = vi.fn();
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: (...args: unknown[]) => invalidateDrillTagsMock(...args),
  invalidateAllOperationalDrills: vi.fn(),
}));

// getClassroomHealth is unstable_cache-wrapped (lib/classroom/health.ts) —
// mocked to null for the same reason school-config/calendar are. Fully
// replaced (no `importOriginal`) rather than partially mocked: the module's
// real dependency graph is heavy (computePublishReadiness's whole readiness
// engine) and irrelevant here, since neither export this file touches issues
// a query itself — `selectAtRiskStudents` is a pure in-memory function, so
// the classroom-loader approximation below skips calling it entirely rather
// than pull in real weight for zero effect on roundTrips/waves.
vi.mock('@/lib/classroom/health', () => ({
  getClassroomHealth: vi.fn().mockResolvedValue(null),
  selectAtRiskStudents: vi.fn().mockReturnValue([]),
}));

afterEach(() => {
  vi.clearAllMocks();
  currentCountingClient = null;
  getTeacherListMock.mockImplementation(async () => [
    {
      id: 'relief-1',
      email: 'relief@hfse.test',
      name: 'Ms Relief',
      disabled: false,
    },
  ]);
  requireCapabilityMock.mockImplementation(() =>
    Promise.resolve({
      user: { id: 'admin-1', email: 'admin@hfse.test' },
      role: 'school_admin',
    })
  );
});

/**
 * Shape-2 helper: build a counting client, point the mocked
 * `createServiceClient()` at it for the duration of `run()`, and hand back
 * the same summary `measureQueries` returns for shape-1 callers. Needed
 * because `run()` here does not receive the client as an argument — the code
 * under test calls `createServiceClient()` itself, arbitrarily many times,
 * and must always get the SAME instance so recordings accumulate in one place.
 */
async function measureViaServiceMock<T>(
  run: () => Promise<T>,
  fixtures: Fixtures = {},
  opts: { maxWaves?: number } = {}
) {
  const client = createCountingClient(fixtures);
  currentCountingClient = client;
  const result = await withCountingClock(run, opts);
  const { roundTrips, waves } = summarize(client.recordings);
  return {
    result,
    roundTrips,
    waves,
    recordings: client.recordings,
    duplicates: findDuplicateQueries(client.recordings),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1. buildReportCard — one student
// ─────────────────────────────────────────────────────────────────────────
// Measured 2026-08-29. lib/report-card/build-report-card.ts is already the
// no-unpaginated-high-volume-reads.test.ts allowlist's reference for "one
// student, one term-set" (60-row bound) — this is the SAME surface's
// round-trip/wave shape, not its row volume.

describe('budget: buildReportCard (one student)', () => {
  const STUDENT_ID = 'stu-1';
  const SECTION = {
    id: 'sec-1',
    name: 'P1 Obedience',
    form_class_adviser: null,
    academic_year_id: 'ay-1',
    level: {
      id: 'level-p1',
      code: 'P1',
      label: 'Primary One',
      level_type: 'primary',
    },
  };
  const SUBJECT = {
    id: 'sub-math',
    code: 'MATH',
    name: 'Mathematics',
    report_label: null,
    is_examinable: true,
  };
  const TERMS = [1, 2, 3, 4].map((n) => ({
    id: `t${n}`,
    term_number: n,
    label: `Term ${n}`,
    virtue_theme: null,
    start_date: `2026-0${n}-01`,
    end_date: `2026-0${n}-28`,
  }));
  const SHEETS = TERMS.map((t) => ({
    id: `sheet-${t.id}`,
    term_id: t.id,
    subject_id: SUBJECT.id,
    section_id: SECTION.id,
  }));

  function fixtures(): Fixtures {
    return {
      students: [
        {
          id: STUDENT_ID,
          student_number: 'SN-001',
          last_name: 'Dela Cruz',
          first_name: 'Juan',
          middle_name: null,
        },
      ],
      academic_years: [{ id: 'ay-1', label: 'AY2026' }],
      terms: TERMS,
      section_students: [
        {
          id: 'ss-1',
          enrollment_status: 'active',
          created_at: '2026-01-05T08:00:00Z',
          enrollment_date: null,
          withdrawal_date: null,
          section: SECTION,
        },
      ],
      section_subjects: [{ subject_config: { subject: SUBJECT } }],
      grading_sheets: SHEETS,
      grade_entries: SHEETS.map((s, i) => ({
        id: `ge-${i}`,
        grading_sheet_id: s.id,
        section_student_id: 'ss-1',
        quarterly_grade: [93, 90, 88, 85][i],
        letter_grade: null,
        is_na: false,
        annual_letter_grade: null,
      })),
      // ONE select against this table since the two identically-filtered
      // reads were merged (phase 3, item 1) — whole rows, matching the
      // merged projection `term_id, days_present, days_late, school_days`.
      attendance_records: [
        { term_id: 't1', days_present: 70, days_late: 2, school_days: 75 },
      ],
      evaluation_writeups: [],
      teacher_assignments: [],
    };
  }

  // Re-measured 2026-08-29 after phase 3 item 1: 12/12 → 11/11. The two
  // `attendance_records` reads carried byte-identical filters and differed
  // only in projection, so `school_days` now rides on the first read and the
  // fallback map is derived from those same rows — one round trip fewer, and
  // one wave fewer because the deleted read sat on its own tick.
  it('measured 2026-08-29: roundTrips=11, waves=11', async () => {
    const { buildReportCard } =
      await import('@/lib/report-card/build-report-card');
    const { roundTrips, waves } = await measureQueries(
      (client) =>
        buildReportCard(client as unknown as SupabaseClient, STUDENT_ID),
      fixtures()
    );
    // Every recorded query resolves on its own tick here (waves == round
    // trips) — none of this fixture's queries reference an earlier result,
    // so nothing forced them to overlap into a real Promise.all. That is
    // itself the finding: a fully-serial 11-deep chain for ONE student.
    expect(roundTrips).toBe(11);
    expect(waves).toBe(11);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. loadAdviserAttendanceDashboard — 2 sections
// ─────────────────────────────────────────────────────────────────────────
// Measured 2026-08-29. The per-section fan-out (today's marks, all marks,
// encodable dates, summary, quota risk) is the whole reason this surface is
// on the list — §11-performance-patterns.md documents the N+1 shape this
// loader was written to compose OVER (adviser-dashboard-queries.ts's own
// header), and this is that composition's real shape today.

describe('budget: loadAdviserAttendanceDashboard (2 sections)', () => {
  const USER_ID = 'user-adviser-1';
  const AY_ID = 'ay-1';
  const TERM_ID = 'term-1';

  // One rich row shape satisfying every consumer's field names
  // (section_students is queried with at least four different `.select()`
  // shapes across lib/attendance/queries.ts) — the counting client does not
  // apply filters to fixture data, so one row list serves every shape; see
  // the harness's own header for why that is a safe simplification for a
  // round-trip/wave count rather than a correctness check.
  const RICH_SECTION_STUDENT = {
    id: 'ss-1',
    section_id: 'sec-1',
    student_id: 'stu-1',
    enrollment_status: 'active',
    student: {
      id: 'stu-1',
      urgent_compassionate_allowance: null,
      vacation_leave_allowance_per_term: null,
    },
    sections: { academic_year_id: AY_ID },
  };

  function fixtures(): Fixtures {
    return {
      sections: [
        {
          id: 'sec-1',
          name: 'P1 Obedience',
          level: { code: 'P1', label: 'Primary One' },
        },
        {
          id: 'sec-2',
          name: 'P2 Gratitude',
          level: { code: 'P2', label: 'Primary Two' },
        },
      ],
      teacher_assignments: [
        {
          id: 'a1',
          teacher_user_id: USER_ID,
          section_id: 'sec-1',
          subject_id: null,
          role: 'form_adviser',
          relief_teacher_user_id: null,
          relief_started_on: null,
          relief_ended_on: null,
        },
        {
          id: 'a2',
          teacher_user_id: USER_ID,
          section_id: 'sec-2',
          subject_id: null,
          role: 'form_adviser',
          relief_teacher_user_id: null,
          relief_started_on: null,
          relief_ended_on: null,
        },
      ],
      section_students: [RICH_SECTION_STUDENT],
      attendance_daily: [
        {
          id: 'd1',
          section_student_id: 'ss-1',
          term_id: TERM_ID,
          date: '2026-08-01',
          status: 'present',
          ex_reason: null,
          ex_note: null,
          period_id: 'p1',
          recorded_by: USER_ID,
          recorded_at: '2026-08-01T08:00:00Z',
        },
      ],
      attendance_records: [
        {
          section_student_id: 'ss-1',
          term_id: TERM_ID,
          school_days: 10,
          days_present: 9,
          days_late: 1,
          days_excused: 0,
          days_absent: 0,
          attendance_pct: 90,
        },
      ],
      students: [{ id: 'stu-1', first_name: 'Juan', last_name: 'Dela Cruz' }],
      terms: [
        {
          id: TERM_ID,
          academic_year_id: AY_ID,
          start_date: '2020-01-01',
          end_date: '2030-12-31',
        },
      ],
      school_calendar: [],
    };
  }

  // Re-measured 2026-08-29 after phase 3 item 3: 46/21 → 42/21. `todayMarks`
  // was a second `getDailyForSection` over a window the `allMarks` read
  // already contained, and each of those costs a roster read plus a paginated
  // daily read — so deleting it saves TWO round trips per section, four here.
  // Waves are unchanged, and that is the expected shape: the duplicate sat in
  // the same `Promise.all` as its own superset, so it never added depth. The
  // per-section fan-out this surface exists to size is untouched.
  // Re-measured 2026-08-29 after phase 4 item 2: 42/15 -> 42/11. The vacation
  // quota is the deepest thing this surface asks for, and most of that depth
  // was calendar work that never depended on the class: `loadTermTripContext`
  // now runs alongside the class's daily read instead of after it, and its own
  // two calendar expansions (this term's window, the previous term's last
  // school day) run as a pair instead of end to end.
  //
  // Re-measured 2026-08-29 after phase 4 item 1: 42/21 -> 42/15. The roster counts,
  // the per-section fan-out and the quota scan are three independent groups
  // that ran one after another — and the quota scan ran last only because it
  // was `await`ed inside the returned object literal, which evaluates its
  // properties in source order. Inside the quota scan the compassionate and
  // vacation reads were serial for the same object-literal reason. Nothing
  // was dropped: `roundTrips` is unchanged.
  it('measured 2026-08-29: roundTrips=42, waves=11', async () => {
    const { loadAdviserAttendanceDashboard } =
      await import('@/lib/attendance/adviser-dashboard-queries');
    const { roundTrips, waves } = await measureViaServiceMock(
      () =>
        loadAdviserAttendanceDashboard({
          role: 'teacher',
          userId: USER_ID,
          academicYearId: AY_ID,
          termId: TERM_ID,
        }),
      fixtures(),
      { maxWaves: 100 }
    );
    // 42 round trips / 21 waves for 2 sections — the per-section fan-out this
    // surface exists to size. A fix that batches the per-section reads across
    // sections (rather than per-section Promise.all groups run one after
    // another) is the shape a later phase should be aiming at here.
    expect(roundTrips).toBe(42);
    expect(waves).toBe(11);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. The classroom section page — data-loading approximation
// ─────────────────────────────────────────────────────────────────────────
// Measured 2026-08-29. See the file header for why this is a reproduction of
// app/(classroom)/classroom/[sectionId]/page.tsx's OWN sequence (lines
// ~100-286 as of this measurement) rather than an import of the page itself.
// Access resolution (loadClassroomAccess) and term resolution (getTermsForAy
// + resolveSelectedTermId) are assumed already done, matching how the real
// page has already paid for those before reaching the section it measures
// here.

describe('budget: classroom section page — data loading', () => {
  const SECTION_ID = 'sec-1';
  const TERM_ID = 'term-1';
  const AY_CODE = 'AY2026';

  function fixtures(): Fixtures {
    return {
      section_students: [
        { id: 'ss-1', section_id: SECTION_ID, enrollment_status: 'active' },
        { id: 'ss-2', section_id: SECTION_ID, enrollment_status: 'active' },
      ],
      grading_sheets: [
        { id: 'sheet-1', is_locked: true },
        { id: 'sheet-2', is_locked: false },
      ],
      teacher_assignments: [],
      evaluation_writeups: [],
    };
  }

  /**
   * Mirrors app/(classroom)/classroom/[sectionId]/page.tsx (as measured
   * 2026-08-29): the roster-count + staff Promise.all, the sheets read, the
   * attendance summary, the write-up progress, the (mocked) health strip,
   * then the rollups + roster Promise.all feeding the at-risk panel.
   *
   * The four collaborator functions are RESOLVED BY THE CALLER and passed in
   * (rather than dynamically imported in here) — doing the dynamic imports
   * inside `withCountingClock`'s fake-timer scope, mixed with real Supabase
   * chain calls in the same tick, was observed to hang Vitest's module
   * loader in this environment (reproduced in isolation while writing this
   * test; resolving the imports under REAL timers first, before the
   * measured section runs, avoids it entirely and changes nothing about
   * what is being measured).
   */
  async function runClassroomSectionPageLoader(
    client: CountingSupabase,
    fns: {
      getSectionStaff: typeof import('@/lib/classroom/staff').getSectionStaff;
      getSectionAttendanceSummary: typeof import('@/lib/attendance/queries').getSectionAttendanceSummary;
      getRollupForSection: typeof import('@/lib/attendance/queries').getRollupForSection;
      getWriteupProgressByTerm: typeof import('@/lib/evaluation/queries').getWriteupProgressByTerm;
      getSectionRoster: typeof import('@/lib/evaluation/queries').getSectionRoster;
      getClassroomHealth: typeof import('@/lib/classroom/health').getClassroomHealth;
    }
  ) {
    const {
      getSectionStaff,
      getSectionAttendanceSummary,
      getRollupForSection,
      getWriteupProgressByTerm,
      getSectionRoster,
      getClassroomHealth,
    } = fns;

    const supabase = client as unknown as SupabaseClient;

    // ONE Promise.all, mirroring the page after phase 4. Every entry is a
    // function of the section id, the term id and the capability flags, so
    // nothing here waits on anything else here.
    const [
      { count: activeCount },
      staff,
      { data: sheets },
      attendanceSummary,
      writeupProgress,
      readiness,
      atRisk,
    ] = await Promise.all([
      supabase
        .from('section_students')
        .select('id', { count: 'exact', head: true })
        .eq('section_id', SECTION_ID)
        .neq('enrollment_status', 'withdrawn'),
      getSectionStaff(SECTION_ID),
      supabase
        .from('grading_sheets')
        .select('id, is_locked')
        .eq('section_id', SECTION_ID)
        .eq('term_id', TERM_ID),
      getSectionAttendanceSummary(SECTION_ID, TERM_ID),
      getWriteupProgressByTerm(TERM_ID, [SECTION_ID]).then(
        (bySection) => bySection[SECTION_ID] ?? null
      ),
      getClassroomHealth(SECTION_ID, TERM_ID, AY_CODE),
      // `selectAtRiskStudents` (called next in the real page, KD #160) is a
      // pure in-memory function over `rollups`/`roster` — it issues no query
      // of its own, so it is intentionally not reproduced here; including it
      // would add risk for zero effect on roundTrips/waves.
      Promise.all([
        getRollupForSection(SECTION_ID, TERM_ID),
        getSectionRoster(SECTION_ID, TERM_ID),
      ]),
    ]);
    const [rollups, roster] = atRisk;

    return {
      activeCount,
      staff,
      sheets,
      attendanceSummary,
      writeupProgress,
      readiness,
      rollups,
      roster,
    };
  }

  // Re-measured 2026-08-29 after phase 4: 11/8 -> 11/2. Every read on this
  // page is a function of `sectionId`, `selectedTermId`, `ayCode` and the two
  // capability flags — none of them consumes another's result — but they were
  // issued one `await` after another. One `Promise.all` leaves the depth at
  // whichever single loader is deepest, which is the roster-then-rows pair
  // inside `getRollupForSection` / `getWriteupProgressByTerm`: two.
  // `roundTrips` is unchanged, which is the proof nothing was dropped.
  it('measured 2026-08-29: roundTrips=11, waves=2', async () => {
    // Resolved under REAL timers, before the measured section starts — see
    // the note on runClassroomSectionPageLoader for why.
    const { getSectionStaff } = await import('@/lib/classroom/staff');
    const { getSectionAttendanceSummary, getRollupForSection } =
      await import('@/lib/attendance/queries');
    const { getWriteupProgressByTerm, getSectionRoster } =
      await import('@/lib/evaluation/queries');
    const { getClassroomHealth } = await import('@/lib/classroom/health');

    const { roundTrips, waves } = await measureViaServiceMock(
      function run() {
        // Bind the client the mock will hand back to createServiceClient().
        return runClassroomSectionPageLoader(currentCountingClient!, {
          getSectionStaff,
          getSectionAttendanceSummary,
          getRollupForSection,
          getWriteupProgressByTerm,
          getSectionRoster,
          getClassroomHealth,
        });
      },
      fixtures(),
      { maxWaves: 100 }
    );
    expect(roundTrips).toBe(11);
    expect(waves).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. recomputeSheetEntries — 25 entries, all changed
// ─────────────────────────────────────────────────────────────────────────
// Measured 2026-08-29. lib/grading/recompute-sheet.ts's own header notes a
// roster tops out at 50 (Hard Rule #5) so this never needs to page — but its
// write loop is a textbook row-at-a-time pattern
// (scripts/audit/row-at-a-time-writes.ts flags this exact file), and this is
// the number that pattern actually costs at a realistic roster size.

describe('budget: recomputeSheetEntries (25 entries, all changed)', () => {
  const SHEET_ID = 'sheet-1';
  const TOTALS = { ww_totals: [10, 10], pt_totals: [10, 10, 10], qa_total: 30 };
  const WEIGHTS = { ww_weight: 40, pt_weight: 40, qa_weight: 20 };

  function fixtures(): Fixtures {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: `ge-${i}`,
      // Omit ww_ps/pt_ps/qa_ps/initial_grade/quarterly_grade entirely so
      // numDiffers() reads them as `undefined` -> "caller didn't load it,
      // assume dirty" -> every one of the 25 entries is written.
      ww_scores: [10, 10],
      pt_scores: [6, 10, 10],
      qa_score: 22,
    }));
    return { grade_entries: entries };
  }

  it('measured 2026-08-29: roundTrips=26, waves=26 (one select + 25 SERIAL updates)', async () => {
    const { recomputeSheetEntries } =
      await import('@/lib/grading/recompute-sheet');
    const { roundTrips, waves, result } = await measureQueries(
      (client) =>
        recomputeSheetEntries(
          client as unknown as SupabaseClient,
          SHEET_ID,
          TOTALS,
          WEIGHTS
        ),
      fixtures(),
      { maxWaves: 100 }
    );
    expect(result.entriesScanned).toBe(25);
    expect(result.entriesWritten).toBe(25);
    // The finding this budget exists to carry forward: 26 SERIAL round trips
    // for one sheet. A later phase fixing this is only a win if `waves` drops
    // well below 26 — batching the reads changes nothing here, since the
    // writes are what is serial.
    expect(roundTrips).toBe(26);
    expect(waves).toBe(26);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. logActions — 30 rows
// ─────────────────────────────────────────────────────────────────────────
// Measured 2026-08-29. lib/audit/log-action.ts::logActions already fans its
// rows out via Promise.all — this confirms that shape numerically rather
// than by reading the source, and gives a real "N inserts, 1 wave" number to
// compare a future bulk-audit surface against.

describe('budget: logActions (30 rows)', () => {
  it('measured 2026-08-29: roundTrips=30, waves=1 (Promise.all fan-out)', async () => {
    const { logActions } = await import('@/lib/audit/log-action');
    const rows = Array.from({ length: 30 }, (_, i) => ({
      action: 'attendance.daily.update' as const,
      entityType: 'attendance_daily' as const,
      entityId: `row-${i}`,
      context: { i },
    }));

    const { roundTrips, waves } = await measureQueries(
      (client) =>
        logActions(
          client as unknown as SupabaseClient,
          { id: 'actor-1', email: 'actor@hfse.test' },
          rows
        ),
      { audit_log: [] }
    );
    expect(roundTrips).toBe(30);
    expect(waves).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. Relief bulk book — 10 assignments
// ─────────────────────────────────────────────────────────────────────────
// Measured 2026-08-29. app/api/relief/book/route.ts's own header already
// states the cost as deliberate ("NOT ATOMIC ACROSS CLASSES... every class is
// written [serially]") — this is that stated cost's real number for a
// 10-class teacher, the shape scripts/audit/row-at-a-time-writes.ts flags.

describe('budget: relief bulk book (10 assignments)', () => {
  const COVERED = '11111111-1111-4111-8111-111111111111';
  const RELIEF = '22222222-2222-4222-8222-222222222222';

  function fixtures(): Fixtures {
    const assignments = Array.from({ length: 10 }, (_, i) => ({
      id: `assign-${i}`,
      section_id: `sec-${i}`,
    }));
    return {
      academic_years: [{ id: 'ay-1', ay_code: 'AY2026' }],
      teacher_assignments: assignments,
    };
  }

  it('measured 2026-08-29: roundTrips=13, waves=13 (1 ay + 1 read + 10 SERIAL updates + 1 audit)', async () => {
    getTeacherListMock.mockImplementation(async () => [
      {
        id: RELIEF,
        email: 'relief@hfse.test',
        name: 'Ms Relief',
        disabled: false,
      },
    ]);

    const { POST } = await import('@/app/api/relief/book/route');

    const { result, roundTrips, waves } = await measureViaServiceMock(
      () =>
        POST(
          new Request('http://localhost/api/relief/book', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              covered_teacher_user_id: COVERED,
              relief_teacher_user_id: RELIEF,
            }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any
        ),
      fixtures(),
      { maxWaves: 100 }
    );

    expect((result as Response).status).toBe(200);
    expect(roundTrips).toBe(13);
    expect(waves).toBe(13);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. The attendance student-detail page — data-loading approximation
// ─────────────────────────────────────────────────────────────────────────
// Added 2026-08-29 (phase 4). Same shape-3 reproduction as the classroom page
// above and for the same reason: `app/(attendance)/attendance/students/
// [studentNumber]/page.tsx` is a React Server Component, and no test in this
// repo imports a `page.tsx` and calls it as a plain function. The loader below
// reproduces the page's own sequence of reads using the REAL exported loaders
// it calls, so the fan-out is genuine; only the JSX and the role gate above it
// are stood in for. Stated as an approximation, not hidden as the page itself.

describe('budget: attendance student detail — data loading', () => {
  const STUDENT_NUMBER = 'SN-001';
  const STUDENT_ID = 'stu-1';
  const AY_ID = 'ay-1';
  const AY_CODE = 'AY2026';
  const TERM_ID = 'term-1';

  function fixtures(): Fixtures {
    return {
      students: [
        {
          id: STUDENT_ID,
          student_number: STUDENT_NUMBER,
          last_name: 'Dela Cruz',
          first_name: 'Juan',
          middle_name: null,
          urgent_compassionate_allowance: null,
          vacation_leave_allowance_per_term: null,
        },
      ],
      academic_years: [{ id: AY_ID, ay_code: AY_CODE }],
      ay2026_enrolment_applications: [{ enroleeNumber: 'E-001' }],
      section_students: [
        {
          id: 'ss-1',
          section_id: 'sec-1',
          student_id: STUDENT_ID,
          enrollment_status: 'active',
          sections: {
            id: 'sec-1',
            name: 'P1 Obedience',
            academic_year_id: AY_ID,
          },
        },
      ],
      terms: [
        {
          id: TERM_ID,
          label: 'Term 2',
          term_number: 2,
          academic_year_id: AY_ID,
          start_date: '2026-08-01',
          end_date: '2026-08-31',
        },
      ],
      attendance_daily: [],
      school_calendar: [],
    };
  }

  /**
   * Mirrors the page after phase 4: one wave for the student row + the current
   * AY, one wave for the four (student, AY)-keyed reads, then the vacation
   * quota — which genuinely cannot start until the term resolver has answered.
   */
  async function runStudentDetailLoader(
    client: CountingSupabase,
    fns: {
      getCompassionateUsage: typeof import('@/lib/attendance/queries').getCompassionateUsage;
      getVacationLeaveUsage: typeof import('@/lib/attendance/queries').getVacationLeaveUsage;
      createAdmissionsClient: () => CountingSupabase;
    }
  ) {
    const { getCompassionateUsage, getVacationLeaveUsage } = fns;
    const service = client as unknown as SupabaseClient;

    const [{ data: student }, { data: currentAy }] = await Promise.all([
      service
        .from('students')
        .select(
          'id, student_number, last_name, first_name, middle_name, urgent_compassionate_allowance, vacation_leave_allowance_per_term'
        )
        .eq('student_number', STUDENT_NUMBER)
        .maybeSingle(),
      service
        .from('academic_years')
        .select('id, ay_code')
        .eq('is_current', true)
        .maybeSingle(),
    ]);
    const studentRow = student as { id: string; student_number: string };
    const ayCode = (currentAy as { ay_code: string }).ay_code;
    const ayId = (currentAy as { id: string }).id;

    const [enroleeNumber, usage, currentTerm, ssRows] = await Promise.all([
      (async () => {
        const admissions =
          fns.createAdmissionsClient() as unknown as SupabaseClient;
        const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
        const { data } = await admissions
          .from(`${prefix}_enrolment_applications`)
          .select('enroleeNumber')
          .eq('studentNumber', studentRow.student_number)
          .maybeSingle();
        return (
          (data as { enroleeNumber: string | null } | null)?.enroleeNumber ??
          null
        );
      })(),
      getCompassionateUsage(studentRow.id, ayId),
      (async () => {
        const { data: termRow } = await service
          .from('terms')
          .select('id, label')
          .eq('academic_year_id', ayId)
          .eq('is_current', true)
          .maybeSingle();
        if (termRow) return termRow as { id: string; label: string };
        const { data: t1 } = await service
          .from('terms')
          .select('id, label, term_number')
          .eq('academic_year_id', ayId)
          .order('term_number', { ascending: true })
          .limit(1)
          .maybeSingle();
        return t1 ? (t1 as { id: string; label: string }) : null;
      })(),
      service
        .from('section_students')
        .select('section_id, sections!inner(id, name, academic_year_id)')
        .eq('student_id', studentRow.id)
        .eq('sections.academic_year_id', ayId)
        .in('enrollment_status', ['active', 'late_enrollee'])
        .then(({ data }) => data),
    ]);

    const vlUsage = currentTerm
      ? await getVacationLeaveUsage(studentRow.id, ayId, currentTerm.id)
      : null;

    return { enroleeNumber, usage, currentTerm, ssRows, vlUsage };
  }

  // Measured 2026-08-29, phase 4. Before the fix this page issued the same 20
  // reads across 16 waves: the student row, the current AY, the admissions
  // enrolee lookup, the compassionate quota, the term resolver, the vacation
  // quota and the active-section lookup, each `await`ed one after the last,
  // even though only the vacation quota depends on any of the others. 20/12
  // after — the residual 12 is almost entirely `getVacationLeaveUsage`'s own
  // internal depth, which is a separate (and already reduced) concern.
  it('measured 2026-08-29: roundTrips=20, waves=12', async () => {
    // Resolved under REAL timers before the measured section — see the note on
    // runClassroomSectionPageLoader for why.
    const { getCompassionateUsage, getVacationLeaveUsage } =
      await import('@/lib/attendance/queries');

    const { roundTrips, waves } = await measureViaServiceMock(
      function run() {
        return runStudentDetailLoader(currentCountingClient!, {
          getCompassionateUsage,
          getVacationLeaveUsage,
          createAdmissionsClient: () => currentCountingClient!,
        });
      },
      fixtures(),
      { maxWaves: 100 }
    );
    expect(roundTrips).toBe(20);
    expect(waves).toBe(12);
  });
});
