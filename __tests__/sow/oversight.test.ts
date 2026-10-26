import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Scheme of work oversight and sign-off (Task 15, boards 9–11).
 *
 * Pinned:
 *   1. Who sees the page, and how much of it (spec §5.3).
 *   2. "Needs a look": a note, a week over and unchecked, two notes running.
 *   3. Only a head of THAT scheme's subject signs or asks; asking needs remarks.
 *   4. The grid underlines a signed week, and a check that landed after the
 *      signature is not what was signed (the race closed on read).
 */

const { weeksMock, logMock } = vi.hoisted(() => ({
  weeksMock: vi.fn(),
  logMock: vi.fn(),
}));
vi.mock('@/lib/sow/weeks', async (orig) => ({
  ...(await orig<typeof import('@/lib/sow/weeks')>()),
  loadTermWeeks: (...a: unknown[]) => weeksMock(...a),
}));
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (...a: unknown[]) => logMock(...a),
}));

import { checksAsSigned, latestChecks } from '@/lib/sow/checks';
import {
  buildCheckGrid,
  buildPlans,
  type GridRow,
  type GridSow,
  needsALook,
  type OversightScope,
  recordSignoff,
  resolveOversightScope,
  SIGNOFF_NOT_HEAD,
  withOversightRead,
} from '@/lib/sow/oversight';
import type { TermWeek } from '@/lib/sow/weeks';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let seq = 0;

/** A just-enough chainable fake of the Supabase query builder. */
function fakeService(tables: Tables) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let inserted: Row[] | null = null;
      const run = () => {
        if (inserted) return { data: inserted, error: null };
        const rows = tables[table] ?? [];
        return {
          data: rows.filter((r) => filters.every((f) => f(r))),
          error: null,
        };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        insert: (v: Row | Row[]) => {
          const list = Array.isArray(v) ? v : [v];
          inserted = list.map((r) => ({
            id: `${table}-${++seq}`,
            created_at: new Date(
              Date.UTC(2026, 9, 20, 0, 0, seq)
            ).toISOString(),
            ...r,
          }));
          (tables[table] ??= []).push(...inserted);
          return q;
        },
        eq: (c: string, v: unknown) => {
          filters.push((r) => r[c] === v);
          return q;
        },
        in: (c: string, v: unknown[]) => {
          filters.push((r) => v.includes(r[c]));
          return q;
        },
        order: () => q,
        limit: () => q,
        single: () =>
          Promise.resolve({
            data: (run().data as Row[])[0] ?? null,
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({
            data: (run().data as Row[])[0] ?? null,
            error: null,
          }),
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const SOW_FLOW = 'markbook.scheme_of_work';

function scopeWorld(): Tables {
  return {
    subject_heads: [
      { subject_id: 'sci', user_id: 'head-sci', applies_to_level_type: null },
      {
        subject_id: 'math',
        user_id: 'head-math-pri',
        applies_to_level_type: 'primary',
      },
    ],
    approval_stages: [
      {
        id: 'st-oic',
        flow: SOW_FLOW,
        is_active: true,
        resolver: 'named',
      },
      {
        id: 'st-head',
        flow: SOW_FLOW,
        is_active: true,
        resolver: 'subject_head',
      },
      // A step of another flow names nobody here.
      {
        id: 'st-other',
        flow: 'markbook.grade_change',
        is_active: true,
        resolver: 'named',
      },
    ],
    approval_stage_approvers: [
      {
        stage_id: 'st-oic',
        user_id: 'oic-sec',
        applies_to_level_type: 'secondary',
      },
      {
        stage_id: 'st-other',
        user_id: 'gc-approver',
        applies_to_level_type: null,
      },
    ],
  };
}

describe('resolveOversightScope', () => {
  it('an office role sees everything', async () => {
    const service = fakeService(scopeWorld());
    for (const role of [
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ] as const) {
      expect(await resolveOversightScope(service, 'office', role)).toEqual({
        all: true,
      });
    }
  });

  it('a subject head sees only their subject', async () => {
    const service = fakeService(scopeWorld());
    const scope = await resolveOversightScope(service, 'head-sci', 'teacher');
    expect(scope).toMatchObject({
      all: false,
      subjectIds: ['sci'],
      levelTypes: [],
    });

    // A head scoped to one half sees that subject in that half only.
    const pri = await resolveOversightScope(
      service,
      'head-math-pri',
      'teacher'
    );
    expect(pri).toMatchObject({ all: false, subjectIds: ['math'] });
    if (!pri || pri.all) throw new Error('expected a scoped answer');
    expect(pri.heads).toEqual([{ subjectId: 'math', levelType: 'primary' }]);
  });

  it('an OIC scoped to secondary sees secondary only', async () => {
    const service = fakeService(scopeWorld());
    expect(
      await resolveOversightScope(service, 'oic-sec', 'teacher')
    ).toMatchObject({ all: false, subjectIds: [], levelTypes: ['secondary'] });
  });

  it('a teacher with no role in it gets no access', async () => {
    const service = fakeService(scopeWorld());
    expect(await resolveOversightScope(service, 'nobody', 'teacher')).toBe(
      null
    );
    // Approving another flow is not a step of the scheme-of-work flow.
    expect(await resolveOversightScope(service, 'gc-approver', 'teacher')).toBe(
      null
    );
  });
});

// ── The grid ────────────────────────────────────────────────────────────────

const WEEKS: TermWeek[] = [1, 2, 3, 4].map((n) => ({
  kind: 'week' as const,
  weekNumber: n,
  startsOn: `2026-10-${String(5 + (n - 1) * 7).padStart(2, '0')}`,
  endsOn: `2026-10-${String(9 + (n - 1) * 7).padStart(2, '0')}`,
  schoolDays: [],
}));
// Wednesday of week 3: weeks 1–2 are over, week 4 has not started.
const TODAY = '2026-10-21';

const SNAPSHOT = {
  module: {},
  weeks: [1, 2, 3, 4].map((n) => ({
    weekNumber: n,
    topic: `Topic ${n}`,
    learningOutcomes: null,
    textbookPages: null,
    activities: null,
    assessment: null,
    remarks: null,
  })),
};

const SOW: GridSow = {
  id: 'sow1',
  subjectId: 'sci',
  subjectName: 'Science',
  levelId: 'L1',
  levelLabel: 'Secondary 1',
  levelType: 'secondary',
  track: 'Standard',
  snapshot: SNAPSHOT,
  sectionIds: ['secA'],
};

const check = (
  week: number,
  option: 'as_planned' | 'adjusted' | 'delayed' | 'extra',
  at: string,
  note: string | null = option === 'as_planned' ? null : 'A note'
) => ({
  sow_id: 'sow1',
  week_number: week,
  section_id: 'secA',
  teacher_user_id: 't1',
  option,
  note,
  recorded_at: at,
});

function grid(over: {
  checks?: ReturnType<typeof check>[];
  signoffs?: Array<{
    week_number: number;
    kind: 'signed' | 'asked';
    created_at: string;
    remarks?: string | null;
  }>;
}) {
  return buildCheckGrid({
    sows: [SOW],
    sectionNames: new Map([['secA', 'Discipline 1']]),
    termWeeks: new Map([['L1', WEEKS]]),
    assignments: [
      {
        teacher_user_id: 't1',
        section_id: 'secA',
        subject_id: 'sci',
        role: 'subject_teacher',
      },
    ],
    checks: over.checks ?? [],
    signoffs: (over.signoffs ?? []).map((s) => ({
      sow_id: 'sow1',
      section_id: 'secA',
      signed_by: 'head-sci',
      remarks: null,
      ...s,
    })),
    reliefNotes: [],
    names: new Map([['t1', 'Ms Tan']]),
    heads: [{ subjectId: 'sci', userId: 'head-sci', appliesToLevelType: null }],
    viewerId: 'head-sci',
    today: TODAY,
  });
}

type Mark = GridRow['cells'][number]['mark'];

/**
 * Grid rows built by the real `buildCheckGrid` from checks, so the labels
 * (level + section) and the marks are the code's own. Section names carry
 * NO level: the code must add it. 'ok' / 'note' are checks; 'missed' and
 * 'todo' are no check (weeks 1–2 are over on TODAY, week 3 is not).
 */
function lookRows(
  spec: {
    section: string;
    level: string;
    marks: Mark[];
    notes?: string[];
  }[],
  signed: { section: string; week: number }[] = []
): GridRow[] {
  const sows: GridSow[] = spec.map((s, i) => ({
    ...SOW,
    id: `sow${i}`,
    levelLabel: s.level,
    sectionIds: [`sec${i}`],
  }));
  const checks = spec.flatMap((s, i) =>
    s.marks.flatMap((m, w) =>
      m === 'ok' || m === 'note'
        ? [
            {
              sow_id: `sow${i}`,
              week_number: w + 1,
              section_id: `sec${i}`,
              teacher_user_id: 't1',
              option: (m === 'ok' ? 'as_planned' : 'delayed') as
                | 'as_planned'
                | 'delayed',
              note:
                m === 'ok'
                  ? null
                  : `<p>${s.notes?.[w] ?? 'Lab not available'}</p>`,
              recorded_at: '2026-10-01T00:00:00.000Z',
            },
          ]
        : []
    )
  );
  return buildCheckGrid({
    sows,
    sectionNames: new Map(spec.map((s, i) => [`sec${i}`, s.section])),
    termWeeks: new Map([['L1', WEEKS]]),
    assignments: spec.map((_, i) => ({
      teacher_user_id: 't1',
      section_id: `sec${i}`,
      subject_id: 'sci',
      role: 'subject_teacher',
    })),
    checks,
    signoffs: signed.map((s) => {
      const i = spec.findIndex((x) => x.section === s.section);
      return {
        sow_id: `sow${i}`,
        section_id: `sec${i}`,
        week_number: s.week,
        kind: 'signed' as const,
        signed_by: 'head-sci',
        remarks: null,
        created_at: '2026-10-25T00:00:00.000Z',
      };
    }),
    reliefNotes: [],
    names: new Map([['t1', 'Ms Tan']]),
    heads: [{ subjectId: 'sci', userId: 'head-sci', appliesToLevelType: null }],
    viewerId: 'head-sci',
    today: TODAY,
  });
}

describe('needsALook', () => {
  it('needsALook lists a note, a missed week, and two adjusted weeks in a row', () => {
    const items = needsALook(
      lookRows([
        {
          section: 'Integrity 1',
          level: 'Secondary 2',
          marks: ['ok', 'ok', 'note'],
        },
        {
          section: 'Integrity 2',
          level: 'Secondary 2',
          marks: ['ok', 'missed', 'todo'],
        },
        {
          section: 'Consistency',
          level: 'Secondary 3',
          marks: ['note', 'note', 'todo'],
          notes: ['Ch 5 started', 'Ch 5 taking longer than planned'],
        },
        {
          section: 'Discipline 1',
          level: 'Secondary 1',
          marks: ['ok', 'ok', 'ok'],
        },
      ]),
      3
    );
    expect(items.map((i) => [i.who, i.note])).toEqual(
      expect.arrayContaining([
        [
          'Secondary 2 Integrity 1 · Science, Wk 3',
          'Delayed: “Lab not available”',
        ],
        [
          'Secondary 2 Integrity 2 · Science, Wk 2',
          'Week 2 is over and was never checked.',
        ],
        [
          'Secondary 3 Consistency · Science, Wk 1–2',
          'Delayed two weeks running: “Ch 5 taking longer than planned”',
        ],
      ])
    );
    // The two-week run is one item, not two notes plus a run.
    expect(items).toHaveLength(3);
    // "Review and sign" opens the run's latest week.
    expect(items.find((i) => i.who.startsWith('Secondary 3'))?.weekNumber).toBe(
      2
    );
  });

  it('a signed note no longer needs a look on its own', () => {
    const rows = lookRows(
      [
        {
          section: 'Integrity 1',
          level: 'Secondary 2',
          marks: ['ok', 'ok', 'note'],
        },
      ],
      [{ section: 'Integrity 1', week: 3 }]
    );
    expect(rows[0].cells[2]).toMatchObject({ mark: 'note', signed: true });
    expect(needsALook(rows, 3)).toEqual([]);
  });

  it('reads each row up to its own current week', () => {
    const rows = lookRows([
      { section: 'Integrity 2', level: 'Secondary 2', marks: ['ok', 'missed'] },
    ]);
    // This row's level is still in week 1 (a level-only closure, say).
    rows[0].currentWeek = 1;
    expect(needsALook(rows, 3)).toEqual([]);
    rows[0].currentWeek = null;
    expect(needsALook(rows, 3)).toHaveLength(1);
  });
});

describe('withOversightRead — the widened read of a scheme', () => {
  const head = (
    subjectId: string,
    levelType: 'primary' | 'secondary' | null
  ): OversightScope => ({
    all: false,
    subjectIds: [subjectId],
    levelTypes: [],
    heads: [{ subjectId, levelType }],
  });

  it('a head scoped to primary cannot read a secondary SOW of the same subject', () => {
    expect(
      withOversightRead('none', head('sci', 'primary'), {
        subjectId: 'sci',
        levelType: 'secondary',
      })
    ).toBe('none');
  });

  it("a subject head cannot read another subject's SOW", () => {
    expect(
      withOversightRead('none', head('sci', null), {
        subjectId: 'math',
        levelType: 'secondary',
      })
    ).toBe('none');
  });

  it('an approver scoped to secondary cannot read a primary SOW', () => {
    const oic: OversightScope = {
      all: false,
      subjectIds: [],
      levelTypes: ['secondary'],
      heads: [],
    };
    expect(
      withOversightRead('none', oic, { subjectId: 'sci', levelType: 'primary' })
    ).toBe('none');
    expect(
      withOversightRead('none', oic, {
        subjectId: 'sci',
        levelType: 'secondary',
      })
    ).toBe('read');
  });

  it("an in-scope overseer gets 'read', never 'edit'", () => {
    const sow = { subjectId: 'sci', levelType: 'secondary' as const };
    expect(withOversightRead('none', head('sci', null), sow)).toBe('read');
    expect(withOversightRead('none', { all: true }, sow)).toBe('read');
    // What the viewer already has is left alone — never raised to 'edit'.
    expect(withOversightRead('read', { all: true }, sow)).toBe('read');
    expect(withOversightRead('none', null, sow)).toBe('none');
  });
});

describe('the grid', () => {
  it('a signed week shows underlined', () => {
    const [r] = grid({
      checks: [
        check(1, 'as_planned', '2026-10-09T01:00:00.000Z'),
        check(2, 'adjusted', '2026-10-16T01:00:00.000Z'),
      ],
      signoffs: [
        {
          week_number: 1,
          kind: 'signed',
          created_at: '2026-10-10T01:00:00.000Z',
        },
        // Asking leaves the week unsigned.
        {
          week_number: 2,
          kind: 'asked',
          created_at: '2026-10-17T01:00:00.000Z',
          remarks: '<p>Which worksheet?</p>',
        },
      ],
    });
    expect(r.cells.map((c) => [c.mark, c.signed])).toEqual([
      ['ok', true],
      ['note', false],
      ['todo', false],
      ['todo', false],
    ]);
    expect(r.cells[1].signoff).toMatchObject({
      kind: 'asked',
      remarks: '<p>Which worksheet?</p>',
    });
    expect(r.currentWeek).toBe(3);
    expect(r.canSign).toBe(true);
    expect(r.teachers).toEqual([
      { userId: 't1', name: 'Ms Tan', role: 'subject_teacher' },
    ]);
    // The level leads the class name; the section name stays as stored.
    expect(r.className).toBe('Secondary 1 Discipline 1');
    expect(r.sectionName).toBe('Discipline 1');
    // The plan is not copied into the cells; it is sent once per scheme.
    expect(r.cells[0]).not.toHaveProperty('topic');
    expect(buildPlans([SOW]).sow1[2]).toEqual({
      topic: 'Topic 2',
      activities: null,
      assessment: null,
    });
  });

  it('a check recorded after the signature is not what was signed', () => {
    const checks = [
      check(1, 'as_planned', '2026-10-09T01:00:00.000Z'),
      // Raced past the signature: the subject head never saw it.
      check(1, 'delayed', '2026-10-10T01:00:05.000Z'),
    ];
    const signoffs = [
      {
        sow_id: 'sow1',
        week_number: 1,
        section_id: 'secA',
        kind: 'signed' as const,
        created_at: '2026-10-10T01:00:00.000Z',
      },
    ];
    expect(latestChecks(checksAsSigned(checks, signoffs))).toEqual([checks[0]]);
    const [r] = grid({ checks, signoffs });
    expect(r.cells[0]).toMatchObject({ mark: 'ok', signed: true });
  });
});

// ── Signing ─────────────────────────────────────────────────────────────────

function signWorld() {
  const tables: Tables = {
    schemes_of_work: [
      {
        id: 'sow1',
        subject_id: 'sci',
        level_id: 'L1',
        term_id: 't1',
        approved_snapshot: SNAPSHOT,
      },
    ],
    levels: [{ id: 'L1', level_type: 'secondary' }],
    scheme_of_work_classes: [{ sow_id: 'sow1', section_id: 'secA' }],
    subject_heads: [
      { subject_id: 'sci', user_id: 'head-sci', applies_to_level_type: null },
      {
        subject_id: 'sci',
        user_id: 'head-sci-pri',
        applies_to_level_type: 'primary',
      },
      { subject_id: 'math', user_id: 'head-math', applies_to_level_type: null },
    ],
    scheme_of_work_signoffs: [],
  };
  return { tables, service: fakeService(tables) };
}

const HEAD = { id: 'head-sci', email: 'h@x.sg', role: 'teacher' as const };
const signInput = (
  over: Partial<Parameters<typeof recordSignoff>[2]> = {}
) => ({
  sowId: 'sow1',
  weekNumber: 2,
  sectionId: 'secA',
  kind: 'signed' as const,
  remarks: '',
  ...over,
});

beforeEach(() => {
  seq = 0;
  weeksMock.mockReset();
  logMock.mockReset();
  weeksMock.mockResolvedValue({ weeks: WEEKS, eventsByWeek: new Map() });
});

describe('recordSignoff', () => {
  it('only the subject head can sign', async () => {
    const { service, tables } = signWorld();
    for (const actor of [
      // Heads another subject.
      { id: 'head-math', email: null, role: 'teacher' as const },
      // Heads this subject for the other half of the school.
      { id: 'head-sci-pri', email: null, role: 'teacher' as const },
      // The office oversees everything but does not sign.
      { id: 'office', email: null, role: 'school_admin' as const },
    ]) {
      const r = await recordSignoff(service, actor, signInput(), {
        today: TODAY,
      });
      expect(r).toEqual({ ok: false, status: 403, error: SIGNOFF_NOT_HEAD });
    }
    expect(SIGNOFF_NOT_HEAD).toBe('Only the subject head signs off weeks.');
    expect(tables.scheme_of_work_signoffs).toHaveLength(0);

    const ok = await recordSignoff(service, HEAD, signInput(), {
      today: TODAY,
    });
    expect(ok.ok).toBe(true);
    expect(tables.scheme_of_work_signoffs[0]).toMatchObject({
      sow_id: 'sow1',
      week_number: 2,
      section_id: 'secA',
      signed_by: 'head-sci',
      kind: 'signed',
      remarks: null,
    });
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0][0]).toMatchObject({
      action: 'sow.sign',
      entityId: 'sow1',
      context: { week_number: 2, section_id: 'secA', remarks_present: false },
    });
  });

  it('asking needs remarks', async () => {
    const { service, tables } = signWorld();
    for (const remarks of ['', '<p></p>', '<p>   </p>']) {
      const r = await recordSignoff(
        service,
        HEAD,
        signInput({ kind: 'asked', remarks }),
        { today: TODAY }
      );
      expect(r).toMatchObject({ ok: false, status: 422 });
    }
    expect(tables.scheme_of_work_signoffs).toHaveLength(0);

    const r = await recordSignoff(
      service,
      HEAD,
      signInput({ kind: 'asked', remarks: '<p>Which worksheet?</p>' }),
      { today: TODAY }
    );
    expect(r.ok).toBe(true);
    expect(tables.scheme_of_work_signoffs[0]).toMatchObject({
      kind: 'asked',
      remarks: '<p>Which worksheet?</p>',
    });
    // The audit row says THAT there were remarks, never what they said.
    const ctx = logMock.mock.calls[0][0].context as Record<string, unknown>;
    expect(logMock.mock.calls[0][0].action).toBe('sow.ask');
    expect(ctx.remarks_present).toBe(true);
    expect(JSON.stringify(ctx)).not.toContain('worksheet');
  });

  it('refuses a week that has not started, and a class not on the scheme', async () => {
    const { service } = signWorld();
    expect(
      await recordSignoff(service, HEAD, signInput({ weekNumber: 4 }), {
        today: TODAY,
      })
    ).toMatchObject({ ok: false, status: 422 });
    expect(
      await recordSignoff(service, HEAD, signInput({ sectionId: 'secZ' }), {
        today: TODAY,
      })
    ).toMatchObject({ ok: false, status: 404 });
  });
});
