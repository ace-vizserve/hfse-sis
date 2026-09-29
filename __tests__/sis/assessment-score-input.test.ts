import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Assessment stage's Math / English grades are typed as two numbers,
// Score and Out of, and stored as exactly `score/max`. The rule is one
// function pair shared by the edit dialog and the stage PATCH route; the
// route is exercised end to end below with the same in-memory Supabase
// stand-in as enrolled-flip-acknowledge-open-steps.test.ts.

const h = vi.hoisted(() => ({
  client: null as unknown,
  logAction: vi.fn(),
}));

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({
    user: { id: 'user-1', email: 'admissions@hfse.test' },
    role: 'admissions',
  })),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => h.client,
}));
vi.mock('@/lib/supabase/admissions', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabase/admissions')>()),
  createAdmissionsClient: () => h.client,
}));
vi.mock('@/lib/audit/log-action', async (orig) => ({
  ...(await orig<typeof import('@/lib/audit/log-action')>()),
  logAction: (...args: unknown[]) => h.logAction(...args),
}));
vi.mock('next/cache', async (orig) => ({
  ...(await orig<typeof import('next/cache')>()),
  revalidateTag: vi.fn(),
}));
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
  invalidateAllOperationalDrills: vi.fn(),
}));

import { PATCH as patchStage } from '@/app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route';
import {
  checkAssessmentScoreInput,
  checkAssessmentScoreSubmission,
} from '@/lib/admissions/assessment-grade';
import {
  STAGE_COLUMN_MAP,
  checkStageScoreExtras,
  findStageCompletionBlockers,
} from '@/lib/schemas/sis';

describe('checkAssessmentScoreInput — the two boxes', () => {
  it('valid → stored as exactly score/max, no trailing zeros', () => {
    expect(checkAssessmentScoreInput('29', '31')).toEqual({
      ok: true,
      value: '29/31',
    });
    expect(checkAssessmentScoreInput(' 29.50 ', '31.0')).toEqual({
      ok: true,
      value: '29.5/31',
    });
    expect(checkAssessmentScoreInput('0', '31')).toEqual({
      ok: true,
      value: '0/31',
    });
    expect(checkAssessmentScoreInput('31', '31')).toEqual({
      ok: true,
      value: '31/31',
    });
  });

  it('both blank clears', () => {
    expect(checkAssessmentScoreInput('', '  ')).toEqual({
      ok: true,
      value: null,
    });
  });

  it('refuses in plain English', () => {
    expect(checkAssessmentScoreInput('abc', '31')).toMatchObject({
      ok: false,
      field: 'score',
      error: 'Enter the score as a number.',
    });
    expect(checkAssessmentScoreInput('', '31')).toMatchObject({
      ok: false,
      field: 'score',
    });
    expect(checkAssessmentScoreInput('29', 'x')).toMatchObject({
      ok: false,
      field: 'max',
    });
    expect(checkAssessmentScoreInput('29', '')).toMatchObject({
      ok: false,
      field: 'max',
    });
    expect(checkAssessmentScoreInput('0', '0')).toMatchObject({
      ok: false,
      field: 'max',
      error: 'Out of must be more than 0.',
    });
    expect(checkAssessmentScoreInput('32', '31')).toMatchObject({
      ok: false,
      field: 'score',
      error: "The score can't be higher than the total.",
    });
    expect(checkAssessmentScoreInput('-1', '31')).toMatchObject({
      ok: false,
      field: 'score',
    });
  });
});

describe('checkAssessmentScoreSubmission — only a change is judged', () => {
  it('an untouched legacy value passes as-is', () => {
    const legacy = '<p>93.55% (29/31)</p>';
    expect(checkAssessmentScoreSubmission(legacy, legacy)).toEqual({
      ok: true,
      value: legacy,
    });
    expect(checkAssessmentScoreSubmission('na', 'na')).toEqual({
      ok: true,
      value: 'na',
    });
    // A numeric column value round-trips as its string.
    expect(checkAssessmentScoreSubmission('77', 77)).toEqual({
      ok: true,
      value: '77',
    });
  });

  it('a changed value must be score/max', () => {
    expect(checkAssessmentScoreSubmission('77%', 'na')).toMatchObject({
      ok: false,
      error: 'Enter the score as a number.',
    });
    expect(checkAssessmentScoreSubmission('1/2/3', null)).toMatchObject({
      ok: false,
    });
    expect(checkAssessmentScoreSubmission('29/31', null)).toEqual({
      ok: true,
      value: '29/31',
    });
  });

  it('blank clears', () => {
    expect(checkAssessmentScoreSubmission(null, '77%')).toEqual({
      ok: true,
      value: null,
    });
    expect(checkAssessmentScoreSubmission('', '77%')).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe('checkStageScoreExtras — the stage-level rule', () => {
  const cols = STAGE_COLUMN_MAP.assessment;

  it('Math and English are score fields', () => {
    const kinds = Object.fromEntries(
      cols.extras.map((e) => [e.fieldKey, e.kind])
    );
    expect(kinds).toMatchObject({
      math: 'score',
      english: 'score',
      schedule: 'date',
      medical: 'text',
    });
  });

  it('normalises changed values, ignores fields not sent', () => {
    const r = checkStageScoreExtras(
      cols,
      { math: '29.50/31', schedule: '2026-09-01' },
      { assessmentGradeMath: null, assessmentGradeEnglish: '77%' }
    );
    expect(r).toEqual({ ok: true, normalised: { math: '29.5/31' } });
  });

  it('names the field and the problem', () => {
    const r = checkStageScoreExtras(
      cols,
      { math: '40/31', english: '<p>77%</p>' },
      { assessmentGradeMath: null, assessmentGradeEnglish: '<p>77%</p>' }
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.errors).toEqual([
      {
        fieldKey: 'math',
        label: 'Math grade',
        field: 'score',
        error: "The score can't be higher than the total.",
      },
    ]);
  });

  it('Assessment Finished still requires both grades in the new shape', () => {
    const base = { schedule: '2026-09-01' };
    expect(
      findStageCompletionBlockers('assessment', 'Finished', {
        ...base,
        math: '29/31',
        english: null,
      }).map((b) => b.fieldKey)
    ).toEqual(['english']);
    expect(
      findStageCompletionBlockers('assessment', 'Finished', {
        ...base,
        math: '29/31',
        english: '20/31',
      })
    ).toEqual([]);
  });
});

// ── The route ────────────────────────────────────────────────────────────────

type Q = {
  table: string;
  op: string;
  payload?: unknown;
};

function fakeClient(statusRow: Record<string, unknown>, log: Q[]) {
  return {
    from(table: string) {
      const q: Q = { table, op: 'select' };
      log.push(q);
      const out = () => ({
        data:
          q.op === 'select' && table === 'ay2027_enrolment_status'
            ? statusRow
            : null,
        error: null,
        count: null,
      });
      const proxy: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then')
              return (
                res: (v: unknown) => unknown,
                rej: (e: unknown) => unknown
              ) => Promise.resolve(out()).then(res, rej);
            if (prop === 'maybeSingle' || prop === 'single')
              return () => Promise.resolve(out());
            return (...args: unknown[]) => {
              if (prop === 'update' || prop === 'insert' || prop === 'upsert') {
                q.op = prop;
                q.payload = args[0];
              }
              return proxy;
            };
          },
        }
      );
      return proxy;
    },
  };
}

let log: Q[] = [];
function setRow(over: Record<string, unknown>) {
  log = [];
  h.client = fakeClient(
    {
      enroleeNumber: 'E1',
      assessmentStatus: 'Ongoing Assessment',
      assessmentRemarks: null,
      assessmentSchedule: '2026-09-01',
      assessmentGradeMath: null,
      assessmentGradeEnglish: null,
      assessmentMedical: null,
      classSection: null,
      classLevel: null,
      classStatus: null,
      ...over,
    },
    log
  );
}
const writes = () =>
  log.filter((q) => q.table === 'ay2027_enrolment_status' && q.op === 'update');

async function save(body: Record<string, unknown>): Promise<Response> {
  return (await patchStage(
    new Request('http://x/api/sis/students/E1/stage/assessment?ay=AY2027', {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'Ongoing Assessment',
        remarks: null,
        ...body,
      }),
    }),
    { params: Promise.resolve({ enroleeNumber: 'E1', stageKey: 'assessment' }) }
  ))!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stage PATCH — assessment grades', () => {
  it('valid: stores exactly score/max', async () => {
    setRow({});
    const res = await save({ extras: { math: '29.50/31', english: '20/31' } });
    expect(res.status).toBe(200);
    expect(writes()[0].payload).toMatchObject({
      assessmentGradeMath: '29.5/31',
      assessmentGradeEnglish: '20/31',
    });
  });

  it('score > max: 400, nothing written', async () => {
    setRow({});
    const res = await save({ extras: { math: '32/31' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_score');
    expect(body.error).toBe(
      "Math grade: The score can't be higher than the total."
    );
    expect(writes()).toEqual([]);
  });

  it('max 0: 400', async () => {
    setRow({});
    const res = await save({ extras: { english: '0/0' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'English grade: Out of must be more than 0.'
    );
    expect(writes()).toEqual([]);
  });

  it('non-number: 400', async () => {
    setRow({});
    const res = await save({ extras: { math: 'abc/31' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'Math grade: Enter the score as a number.'
    );
    const res2 = await save({ extras: { math: '93%' } });
    expect(res2.status).toBe(400);
  });

  it('blank clears to null', async () => {
    setRow({ assessmentGradeMath: '29/31' });
    const res = await save({ extras: { math: '' } });
    expect(res.status).toBe(200);
    expect(writes()[0].payload).toMatchObject({ assessmentGradeMath: null });
  });

  it('an untouched legacy grade does not block saving the other fields', async () => {
    const legacy = '<p>23/31 - 74.19%</p>';
    setRow({ assessmentGradeMath: legacy, assessmentGradeEnglish: 'na' });
    const res = await save({
      remarks: 'Rescheduled',
      extras: {
        schedule: '2026-09-10',
        math: legacy,
        english: 'na',
        medical: null,
      },
    });
    expect(res.status).toBe(200);
    expect(writes()[0].payload).toMatchObject({
      assessmentGradeMath: legacy,
      assessmentGradeEnglish: 'na',
      assessmentSchedule: '2026-09-10',
    });
  });
});
