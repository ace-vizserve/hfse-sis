import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sending a scheme of work for review, and what each decision does to it
 * (Task 9).
 *
 * Pinned:
 *   1. A send opens a request whose subject is the NEW submission row, and
 *      a resend after a return opens another request, at step 1.
 *   2. The teacher who sent it is on no pool of their own request — a subject
 *      head step or a named one (Review Focus #3).
 *   3. The last approve freezes a snapshot copy-from-last-year can read; a
 *      return records the note and the week.
 *   4. An empty topic, or no steps configured, leaves the scheme a draft with
 *      a plain sentence.
 *   5. Reopen is for the office only and keeps the approved snapshot.
 */

const { loadMock, weeksMock, logMock } = vi.hoisted(() => ({
  loadMock: vi.fn(),
  weeksMock: vi.fn(),
  logMock: vi.fn(),
}));
vi.mock('@/lib/auth/teacher-assignments', () => ({
  loadEffectiveAssignmentsForUser: (...a: unknown[]) => loadMock(...a),
}));
vi.mock('@/lib/sow/weeks', async (orig) => ({
  ...(await orig<typeof import('@/lib/sow/weeks')>()),
  loadTermWeeks: (...a: unknown[]) => weeksMock(...a),
}));
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (...a: unknown[]) => logMock(...a),
  logActions: vi.fn(() => Promise.resolve()),
}));

import { SUBJECT_HANDLERS, SUBJECT_PRECHECKS } from '@/lib/approvals/decide';
import {
  DecideApprovalSchema,
  SOW_APPROVAL_FLOW,
} from '@/lib/schemas/approval-flows';
import { SowSnapshotSchema } from '@/lib/schemas/sow';
import {
  NO_STEPS_MESSAGE,
  RETURN_NOTE_REQUIRED,
  reopenSow,
  SOW_SUBJECT_TYPE,
  submitSow,
  TOPIC_REQUIRED_MESSAGE,
} from '@/lib/sow/approval';
import { sowApprovalHandler } from '@/lib/sow/approval-handler';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let seq = 0;

/** A just-enough chainable fake of the Supabase query builder. */
function fakeService(tables: Tables) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let patch: Row = {};
      let inserted: Row[] = [];
      const run = () => {
        const rows = (tables[table] ??= []);
        if (op === 'insert') return { data: inserted, error: null };
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          for (const r of hit) Object.assign(r, patch);
          return { data: hit, error: null };
        }
        if (op === 'delete') {
          tables[table] = rows.filter((r) => !hit.includes(r));
          return { data: null, error: null };
        }
        return { data: hit, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        insert: (v: Row | Row[]) => {
          op = 'insert';
          const list = Array.isArray(v) ? v : [v];
          inserted = list.map((r) => ({
            id: `${table}-${++seq}`,
            ...(table === 'scheme_of_work_submissions'
              ? {
                  outcome: 'pending',
                  return_note: null,
                  return_week_number: null,
                }
              : {}),
            ...r,
          }));
          (tables[table] ??= []).push(...inserted);
          return q;
        },
        update: (p: Row) => {
          op = 'update';
          patch = p;
          return q;
        },
        delete: () => {
          op = 'delete';
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
        single: () => {
          const res = run();
          return Promise.resolve({
            data: (res.data as Row[])[0] ?? null,
            error: null,
          });
        },
        maybeSingle: () => {
          const res = run();
          return Promise.resolve({
            data: (res.data as Row[] | null)?.[0] ?? null,
            error: null,
          });
        },
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const TEACHER = { id: 'u1', email: 't@x.sg', role: 'teacher' as const };
const COORD = {
  id: 'coord1',
  email: 'c@x.sg',
  role: 'academic_coordinator' as const,
};
const T0 = '2026-10-01T00:00:00.000Z';

function world(over: { stages?: Row[]; state?: string } = {}) {
  const tables: Tables = {
    schemes_of_work: [
      {
        id: 'sow1',
        subject_id: 'math',
        level_id: 'L1',
        term_id: 't1',
        state: over.state ?? 'draft',
        module: { title: 'Number' },
        approved_snapshot: null,
        approved_at: null,
        current_submission_id: null,
        updated_at: T0,
      },
    ],
    scheme_of_work_classes: [{ sow_id: 'sow1', section_id: 'sec1' }],
    scheme_of_work_weeks: [
      {
        sow_id: 'sow1',
        week_number: 1,
        topic: 'Fractions',
        learning_outcomes: '<p>Add them</p>',
        textbook_pages: 'p. 4',
        activities: null,
        assessment: null,
        remarks: null,
      },
      {
        sow_id: 'sow1',
        week_number: 2,
        topic: 'Decimals',
        learning_outcomes: null,
        textbook_pages: null,
        activities: null,
        assessment: 'Quiz',
        remarks: null,
      },
    ],
    levels: [{ id: 'L1', level_type: 'primary' }],
    subject_heads: [
      { subject_id: 'math', user_id: 'head1', applies_to_level_type: null },
      // The teacher heads the subject too — and must still not vet their own.
      { subject_id: 'math', user_id: 'u1', applies_to_level_type: null },
    ],
    approval_stages: over.stages ?? [
      {
        id: 'cfg1',
        flow: SOW_APPROVAL_FLOW,
        stage_order: 1,
        label: 'Subject head',
        resolver: 'subject_head',
        approval_rule: 'any',
        is_active: true,
      },
      {
        id: 'cfg2',
        flow: SOW_APPROVAL_FLOW,
        stage_order: 2,
        label: 'Academic coordinator',
        resolver: 'named',
        approval_rule: 'any',
        is_active: true,
      },
    ],
    approval_stage_approvers: [
      { stage_id: 'cfg2', user_id: 'coord1', applies_to_level_type: null },
      { stage_id: 'cfg2', user_id: 'u1', applies_to_level_type: null },
    ],
    approval_requests: [],
    approval_request_stages: [],
    scheme_of_work_submissions: [],
  };
  return { tables, service: fakeService(tables) };
}

/** What `approval_advance` would have done before the handler runs. */
function decideAs(
  tables: Tables,
  requestId: string,
  outcome: 'advanced' | 'completed' | 'rejected'
) {
  const req = tables.approval_requests.find((r) => r.id === requestId)!;
  if (outcome !== 'advanced') {
    req.status = outcome === 'completed' ? 'approved' : 'rejected';
  }
}

function ctxFor(
  service: SupabaseClient,
  requestId: string,
  subjectId: string,
  over: Partial<Parameters<typeof sowApprovalHandler>[0]> = {}
): Parameters<typeof sowApprovalHandler>[0] {
  return {
    service,
    actor: { id: 'head1', email: 'h@x.sg', role: 'teacher' },
    requestId,
    flow: SOW_APPROVAL_FLOW,
    subjectId,
    action: 'approve',
    outcome: 'completed',
    decidedStageOrder: 2,
    nextStageOrder: null,
    note: null,
    via: 'in_app',
    ...over,
  };
}

beforeEach(() => {
  seq = 0;
  loadMock.mockReset();
  weeksMock.mockReset();
  logMock.mockReset();
  loadMock.mockResolvedValue([
    {
      teacher_user_id: 'u1',
      role: 'subject_teacher',
      subject_id: 'math',
      section_id: 'sec1',
      via: 'substantive',
    },
  ]);
  weeksMock.mockResolvedValue({
    weeks: [
      {
        kind: 'week',
        weekNumber: 1,
        startsOn: 'a',
        endsOn: 'b',
        schoolDays: [],
      },
      {
        kind: 'week',
        weekNumber: 2,
        startsOn: 'c',
        endsOn: 'd',
        schoolDays: [],
      },
    ],
    eventsByWeek: new Map(),
  });
});

describe('sending a scheme of work for review', () => {
  it('sending opens a request whose subject is the submission', async () => {
    const { service, tables } = world();
    const r = await submitSow(service, TEACHER, 'sow1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(tables.scheme_of_work_submissions).toHaveLength(1);
    const submission = tables.scheme_of_work_submissions[0];
    expect(submission).toMatchObject({
      id: r.submissionId,
      sow_id: 'sow1',
      submitted_by: 'u1',
      outcome: 'pending',
    });

    expect(tables.approval_requests).toHaveLength(1);
    expect(tables.approval_requests[0]).toMatchObject({
      id: r.requestId,
      flow: SOW_APPROVAL_FLOW,
      subject_type: SOW_SUBJECT_TYPE,
      subject_id: r.submissionId,
      current_stage_order: 1,
      filed_by: 'u1',
    });
    expect(SOW_SUBJECT_TYPE).toBe('scheme_of_work_submission');

    expect(tables.schemes_of_work[0]).toMatchObject({
      state: 'in_review',
      current_submission_id: r.submissionId,
    });
    expect(r.stalled).toBe(false);
    expect(logMock.mock.calls.map((c) => c[0].action)).toEqual(['sow.submit']);
  });

  it('a resend after a return opens a NEW request at step 1', async () => {
    const { service, tables } = world();
    const first = await submitSow(service, TEACHER, 'sow1');
    if (!first.ok) throw new Error('first send failed');
    decideAs(tables, first.requestId, 'rejected');
    const back = await sowApprovalHandler(
      ctxFor(service, first.requestId, first.submissionId, {
        action: 'reject',
        outcome: 'rejected',
        decidedStageOrder: 1,
        note: 'Week 2 needs a topic that matches the syllabus.',
        weekNumber: 2,
      })
    );
    expect(back.ok).toBe(true);
    expect(tables.schemes_of_work[0].state).toBe('returned');

    const second = await submitSow(service, TEACHER, 'sow1');
    if (!second.ok) throw new Error('second send failed');

    expect(tables.scheme_of_work_submissions).toHaveLength(2);
    expect(tables.approval_requests).toHaveLength(2);
    expect(second.submissionId).not.toBe(first.submissionId);
    expect(second.requestId).not.toBe(first.requestId);
    const req2 = tables.approval_requests.find(
      (q) => q.id === second.requestId
    )!;
    expect(req2.subject_id).toBe(second.submissionId);
    expect(req2.current_stage_order).toBe(1);
    expect(tables.schemes_of_work[0]).toMatchObject({
      state: 'in_review',
      current_submission_id: second.submissionId,
    });
  });

  it('the teacher who sent it is never on a pool', async () => {
    const { service, tables } = world();
    const r = await submitSow(service, TEACHER, 'sow1');
    expect(r.ok).toBe(true);
    const stages = tables.approval_request_stages;
    expect(stages).toHaveLength(2);
    for (const s of stages) {
      expect(s.approver_pool as string[]).not.toContain('u1');
    }
    expect(stages.find((s) => s.stage_order === 1)!.approver_pool).toEqual([
      'head1',
    ]);
    expect(stages.find((s) => s.stage_order === 2)!.approver_pool).toEqual([
      'coord1',
    ]);
  });

  it('the filer is refused if they try to decide it anyway', async () => {
    const precheck = SUBJECT_PRECHECKS[SOW_SUBJECT_TYPE];
    expect(precheck).toBeDefined();
    const base = {
      requestId: 'r',
      flow: SOW_APPROVAL_FLOW,
      subjectId: 's',
      filedBy: 'u1',
      action: 'approve' as const,
      note: null,
    };
    expect(await precheck({ ...base, actor: TEACHER })).toMatchObject({
      status: 403,
    });
    expect(
      await precheck({
        ...base,
        actor: { id: 'head1', email: null, role: 'teacher' },
      })
    ).toBeNull();
    expect(SUBJECT_HANDLERS[SOW_SUBJECT_TYPE]).toBe(sowApprovalHandler);
  });

  it('a step with nobody on it reads as stalled', async () => {
    const { service, tables } = world();
    tables.subject_heads = [
      { subject_id: 'math', user_id: 'u1', applies_to_level_type: null },
    ];
    const r = await submitSow(service, TEACHER, 'sow1');
    expect(r).toMatchObject({ ok: true, stalled: true });
  });

  it('sending with an empty topic is a 422', async () => {
    const { service, tables } = world();
    tables.scheme_of_work_weeks[1].topic = '   ';
    const r = await submitSow(service, TEACHER, 'sow1');
    expect(r).toEqual({
      ok: false,
      status: 422,
      error: TOPIC_REQUIRED_MESSAGE,
    });
    expect(TOPIC_REQUIRED_MESSAGE).toBe(
      'Every week needs a topic before it can be sent.'
    );
    expect(tables.scheme_of_work_submissions).toHaveLength(0);
    expect(tables.approval_requests).toHaveLength(0);
    expect(tables.schemes_of_work[0].state).toBe('draft');
  });

  it('no steps configured leaves it a draft with the plain sentence', async () => {
    const { service, tables } = world({ stages: [] });
    const r = await submitSow(service, TEACHER, 'sow1');
    expect(r).toEqual({ ok: false, status: 422, error: NO_STEPS_MESSAGE });
    expect(NO_STEPS_MESSAGE).toBe(
      "Approval steps for schemes of work haven't been set up yet. Ask an SIS administrator."
    );
    expect(tables.scheme_of_work_submissions[0].outcome).toBe('cancelled');
    expect(tables.schemes_of_work[0]).toMatchObject({
      state: 'draft',
      current_submission_id: null,
    });
  });

  it('in review or approved cannot be sent again', async () => {
    for (const state of ['in_review', 'approved']) {
      const { service } = world({ state });
      expect(await submitSow(service, TEACHER, 'sow1')).toMatchObject({
        ok: false,
        status: 423,
      });
    }
  });

  it('somebody who cannot edit it cannot send it', async () => {
    const { service } = world();
    loadMock.mockResolvedValue([]);
    expect(await submitSow(service, TEACHER, 'sow1')).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe('deciding a scheme of work', () => {
  async function sent() {
    const w = world();
    const r = await submitSow(w.service, TEACHER, 'sow1');
    if (!r.ok) throw new Error('send failed');
    logMock.mockClear();
    return { ...w, ...r };
  }

  it('a vet that leaves a next step audits sow.vet and nothing else', async () => {
    const { service, tables, requestId, submissionId } = await sent();
    decideAs(tables, requestId, 'advanced');
    const r = await sowApprovalHandler(
      ctxFor(service, requestId, submissionId, {
        outcome: 'advanced',
        decidedStageOrder: 1,
        nextStageOrder: 2,
      })
    );
    expect(r).toMatchObject({
      ok: true,
      message: "Vetted — it's gone to Academic coordinator.",
    });
    expect(tables.schemes_of_work[0].state).toBe('in_review');
    expect(tables.scheme_of_work_submissions[0].outcome).toBe('pending');
    expect(logMock.mock.calls.map((c) => c[0].action)).toEqual(['sow.vet']);
  });

  it('the last approve freezes the snapshot and marks it approved', async () => {
    const { service, tables, requestId, submissionId } = await sent();
    decideAs(tables, requestId, 'completed');
    const r = await sowApprovalHandler(
      ctxFor(service, requestId, submissionId)
    );
    expect(r).toMatchObject({ ok: true, message: 'Approved.' });

    const sow = tables.schemes_of_work[0];
    expect(sow.state).toBe('approved');
    expect(typeof sow.approved_at).toBe('string');
    const snapshot = SowSnapshotSchema.parse(sow.approved_snapshot);
    expect(snapshot).toEqual({
      module: { title: 'Number' },
      weeks: [
        {
          weekNumber: 1,
          topic: 'Fractions',
          learningOutcomes: '<p>Add them</p>',
          textbookPages: 'p. 4',
          activities: null,
          assessment: null,
          remarks: null,
        },
        {
          weekNumber: 2,
          topic: 'Decimals',
          learningOutcomes: null,
          textbookPages: null,
          activities: null,
          assessment: 'Quiz',
          remarks: null,
        },
      ],
    });
    expect(tables.scheme_of_work_submissions[0].outcome).toBe('approved');
    expect(logMock.mock.calls.map((c) => c[0].action)).toEqual(['sow.approve']);
  });

  it('a return records the note and the week', async () => {
    const { service, tables, requestId, submissionId } = await sent();
    decideAs(tables, requestId, 'rejected');
    const r = await sowApprovalHandler(
      ctxFor(service, requestId, submissionId, {
        action: 'reject',
        outcome: 'rejected',
        decidedStageOrder: 1,
        note: 'Week 2 needs a quiz plan.',
        weekNumber: 2,
      })
    );
    expect(r).toMatchObject({ ok: true, message: 'Returned to the teacher.' });
    expect(tables.schemes_of_work[0].state).toBe('returned');
    expect(tables.scheme_of_work_submissions[0]).toMatchObject({
      outcome: 'returned',
      return_note: 'Week 2 needs a quiz plan.',
      return_week_number: 2,
    });
    const audit = logMock.mock.calls.map((c) => c[0]);
    expect(audit.map((a) => a.action)).toEqual(['sow.return']);
    expect(audit[0].context).toMatchObject({
      week_number: 2,
      note_present: true,
    });
  });

  it('a return needs a note', async () => {
    const precheck = SUBJECT_PRECHECKS[SOW_SUBJECT_TYPE];
    const refusal = await precheck({
      actor: { id: 'head1', email: null, role: 'teacher' },
      requestId: 'r',
      flow: SOW_APPROVAL_FLOW,
      subjectId: 's',
      filedBy: 'u1',
      action: 'reject',
      note: '<p></p>',
    });
    expect(refusal).toMatchObject({
      status: 400,
      body: { error: RETURN_NOTE_REQUIRED },
    });
    expect(RETURN_NOTE_REQUIRED).toBe(
      'Say what needs changing before you return it.'
    );
  });

  it('the decide body takes an optional week number', () => {
    expect(
      DecideApprovalSchema.safeParse({
        action: 'reject',
        note: 'Fix it',
        weekNumber: 3,
      }).success
    ).toBe(true);
    expect(
      DecideApprovalSchema.safeParse({
        action: 'reject',
        note: 'Fix it',
        weekNumber: 0,
      }).success
    ).toBe(false);
    expect(DecideApprovalSchema.safeParse({ action: 'approve' }).success).toBe(
      true
    );
  });
});

describe('reopening an approved scheme of work', () => {
  const SNAPSHOT = { module: { title: 'Number' }, weeks: [] };

  it('reopen keeps the approved snapshot', async () => {
    const { service, tables } = world({ state: 'approved' });
    tables.schemes_of_work[0].approved_snapshot = SNAPSHOT;
    const r = await reopenSow(service, COORD, 'sow1', 'Syllabus changed.');
    expect(r).toEqual({ ok: true });
    expect(tables.schemes_of_work[0].state).toBe('draft');
    expect(tables.schemes_of_work[0].approved_snapshot).toEqual(SNAPSHOT);
    const audit = logMock.mock.calls.map((c) => c[0]);
    expect(audit.map((a) => a.action)).toEqual(['sow.reopen']);
    expect(audit[0].context).toMatchObject({ note: 'Syllabus changed.' });
  });

  it('a teacher cannot reopen', async () => {
    const { service, tables } = world({ state: 'approved' });
    const r = await reopenSow(service, TEACHER, 'sow1', 'Please');
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(tables.schemes_of_work[0].state).toBe('approved');
  });

  it('needs a note, and an approved scheme', async () => {
    const { service } = world({ state: 'approved' });
    expect(await reopenSow(service, COORD, 'sow1', '  ')).toMatchObject({
      ok: false,
      status: 400,
    });
    const draft = world();
    expect(
      await reopenSow(draft.service, COORD, 'sow1', 'Why not')
    ).toMatchObject({ ok: false, status: 409 });
  });
});
