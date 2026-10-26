import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The relief teacher's lesson page and note (Task 14, boards 13–14).
 *
 * Pinned:
 *   1. A live relief teacher reads this week's lesson from the APPROVED
 *      snapshot — never the working copy, so a scheme being revised still
 *      shows the plan in force (spec §4.4).
 *   2. Last week in this class: its mark and every note on it.
 *   3. With no approved scheme the note still saves, against no week.
 *   4. A cover window that has ended is refused (the window rule is
 *      `isReliefLive`, not re-derived here).
 *   5. One note per relief teacher, class, subject and day: saving again the
 *      same day replaces it.
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
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: async () => [
    ['holder', 'Ms Holder'],
    ['relief', 'Mr Relief'],
  ],
}));

import {
  loadCoveringLesson,
  RELIEF_COVER_ENDED,
  saveReliefNote,
} from '@/lib/sow/relief';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let seq = 0;
/** The conflict keys every upsert was made on. */
let upserts: string[] = [];

/** A just-enough chainable fake of the Supabase query builder. */
function fakeService(tables: Tables) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let inserted: Row[] | null = null;
      let deleting = false;
      const run = () => {
        if (inserted) return { data: inserted, error: null };
        const rows = tables[table] ?? [];
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (deleting) {
          tables[table] = rows.filter((r) => !hit.includes(r));
          return { data: null, error: null };
        }
        return { data: hit, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        insert: (v: Row | Row[]) => {
          const list = Array.isArray(v) ? v : [v];
          inserted = list.map((r) => ({
            id: `${table}-${++seq}`,
            created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)).toISOString(),
            ...r,
          }));
          (tables[table] ??= []).push(...inserted);
          return q;
        },
        delete: () => {
          deleting = true;
          return q;
        },
        // Like the database: a row matching the conflict key is updated in
        // place, anything else is inserted. Refuses without a key, so a save
        // that forgets it fails here rather than duplicating.
        upsert: (v: Row, opts?: { onConflict?: string }) => {
          if (!opts?.onConflict) throw new Error('upsert without onConflict');
          upserts.push(opts.onConflict);
          const keys = opts.onConflict.split(',');
          const list = (tables[table] ??= []);
          const hit = list.find((r) => keys.every((k) => r[k] === v[k]));
          if (hit) Object.assign(hit, v);
          else
            list.push({
              id: `${table}-${++seq}`,
              created_at: new Date(
                Date.UTC(2026, 9, 1, 0, 0, seq)
              ).toISOString(),
              ...v,
            });
          inserted = [];
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
            data: (run().data as Row[] | null)?.[0] ?? null,
            error: null,
          }),
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const RELIEF = { id: 'relief', email: 'r@x.sg', role: 'teacher' as const };

const snapshot = (prefix = 'Topic') => ({
  module: {},
  weeks: [1, 2, 3].map((n) => ({
    weekNumber: n,
    topic: `${prefix} ${n}`,
    learningOutcomes: `<p>Outcomes ${n}</p>`,
    textbookPages: null,
    activities: `<p>Activities ${n}</p>`,
    assessment: null,
    remarks: null,
  })),
});

// Week 1 is 5–9 Oct, week 2 is 12–16 Oct, week 3 is 19–23 Oct 2026.
const TERM_WEEKS = [1, 2, 3].map((n) => ({
  kind: 'week',
  weekNumber: n,
  startsOn: `2026-10-${String(5 + (n - 1) * 7).padStart(2, '0')}`,
  endsOn: `2026-10-${String(9 + (n - 1) * 7).padStart(2, '0')}`,
  schoolDays: [],
}));
const TODAY = '2026-10-14'; // Wednesday of week 2

function world(
  over: {
    state?: string;
    snapshot?: unknown;
    reliefEndedOn?: string | null;
    noSow?: boolean;
  } = {}
) {
  const tables: Tables = {
    teacher_assignments: [
      {
        id: 'a1',
        teacher_user_id: 'holder',
        section_id: 'secA',
        subject_id: 'sci',
        role: 'subject_teacher',
        relief_teacher_user_id: 'relief',
        relief_started_on: '2026-10-12',
        relief_ended_on:
          over.reliefEndedOn === undefined ? '2026-10-16' : over.reliefEndedOn,
      },
    ],
    sections: [
      {
        id: 'secA',
        name: 'Discipline 2',
        level_id: 'L1',
        academic_year_id: 'ay1',
      },
    ],
    levels: [{ id: 'L1', label: 'Secondary 1' }],
    subjects: [{ id: 'sci', name: 'Science' }],
    subject_configs: [],
    terms: [
      {
        id: 't1',
        academic_year_id: 'ay1',
        term_number: 1,
        start_date: '2026-10-05',
        end_date: '2026-10-23',
        is_current: true,
      },
    ],
    schemes_of_work: over.noSow
      ? []
      : [
          {
            id: 'sow1',
            subject_id: 'sci',
            level_id: 'L1',
            term_id: 't1',
            track: 'Standard',
            state: over.state ?? 'approved',
            approved_snapshot:
              over.snapshot === undefined ? snapshot() : over.snapshot,
          },
        ],
    scheme_of_work_classes: over.noSow
      ? []
      : [{ sow_id: 'sow1', section_id: 'secA' }],
    // The working copy. A relief teacher must never see it.
    scheme_of_work_weeks: over.noSow
      ? []
      : [1, 2, 3].map((n) => ({
          sow_id: 'sow1',
          week_number: n,
          topic: `Being revised ${n}`,
        })),
    scheme_of_work_checks: [],
    scheme_of_work_relief_notes: [],
  };
  return { tables, service: fakeService(tables) };
}

beforeEach(() => {
  seq = 0;
  upserts = [];
  weeksMock.mockReset();
  logMock.mockReset();
  weeksMock.mockResolvedValue({
    weeks: TERM_WEEKS,
    eventsByWeek: new Map([[2, ['General PTC (online)']]]),
  });
});

describe('loadCoveringLesson', () => {
  it("a live relief teacher sees this week's lesson from the approved snapshot", async () => {
    const { service } = world();
    const r = await loadCoveringLesson(service, 'relief', 'secA', 'sci', TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lesson.sow).toMatchObject({ id: 'sow1' });
    expect(r.lesson.week).toMatchObject({
      weekNumber: 2,
      weekCount: 3,
      isNext: false,
      topic: 'Topic 2',
      learningOutcomes: '<p>Outcomes 2</p>',
    });
    expect(r.lesson.events).toEqual(['General PTC (online)']);
    expect(r.lesson.noteWeekNumber).toBe(2);
    expect(r.lesson.context).toMatchObject({
      sectionName: 'Secondary 1 Discipline 2',
      subjectName: 'Science',
      coveredTeacherName: 'Ms Holder',
    });
  });

  it('a SOW being revised still shows the approved plan', async () => {
    const { service } = world({
      state: 'draft',
      snapshot: snapshot('Approved'),
    });
    const r = await loadCoveringLesson(service, 'relief', 'secA', 'sci', TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lesson.week?.topic).toBe('Approved 2');
  });

  it("last week's notes are shown", async () => {
    const { service, tables } = world();
    tables.scheme_of_work_checks.push(
      {
        sow_id: 'sow1',
        week_number: 1,
        section_id: 'secA',
        teacher_user_id: 'holder',
        option: 'as_planned',
        note: null,
        recorded_at: '2026-10-08T01:00:00.000Z',
      },
      // The newer check wins.
      {
        sow_id: 'sow1',
        week_number: 1,
        section_id: 'secA',
        teacher_user_id: 'holder',
        option: 'adjusted',
        note: '<p>Lost Thursday to Recollection</p>',
        recorded_at: '2026-10-09T01:00:00.000Z',
      }
    );
    tables.scheme_of_work_relief_notes.push({
      id: 'rn0',
      sow_id: 'sow1',
      week_number: 1,
      section_id: 'secA',
      subject_id: 'sci',
      taught_on: '2026-10-07',
      relief_teacher_user_id: 'relief',
      note: '<p>Did the worksheet</p>',
      created_at: '2026-10-07T05:00:00.000Z',
    });
    const r = await loadCoveringLesson(service, 'relief', 'secA', 'sci', TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lesson.lastWeek).toMatchObject({
      weekNumber: 1,
      mark: 'note',
      options: ['adjusted'],
      notes: ['<p>Lost Thursday to Recollection</p>'],
      reliefNotes: [
        {
          taughtOn: '2026-10-07',
          name: 'Mr Relief',
          note: '<p>Did the worksheet</p>',
        },
      ],
    });
  });

  it('a cover window that ended yesterday is refused', async () => {
    const { service } = world({ reliefEndedOn: '2026-10-13' });
    const r = await loadCoveringLesson(service, 'relief', 'secA', 'sci', TODAY);
    expect(r).toEqual({ ok: false, status: 403, error: RELIEF_COVER_ENDED });

    const saved = await saveReliefNote(service, RELIEF, {
      sectionId: 'secA',
      subjectId: 'sci',
      note: '<p>x</p>',
      today: TODAY,
    });
    expect(saved).toEqual({
      ok: false,
      status: 403,
      error: RELIEF_COVER_ENDED,
    });
  });

  it('someone who never covered the class gets a 404', async () => {
    const { service } = world();
    const r = await loadCoveringLesson(service, 'other', 'secA', 'sci', TODAY);
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
});

describe('saveReliefNote', () => {
  it('with no approved SOW the note still saves', async () => {
    const { service, tables } = world({ noSow: true });
    const lesson = await loadCoveringLesson(
      service,
      'relief',
      'secA',
      'sci',
      TODAY
    );
    expect(lesson.ok).toBe(true);
    if (!lesson.ok) return;
    expect(lesson.lesson.sow).toBeNull();
    expect(lesson.lesson.week).toBeNull();

    const r = await saveReliefNote(service, RELIEF, {
      sectionId: 'secA',
      subjectId: 'sci',
      note: '<p>Revised food chains</p>',
      today: TODAY,
    });
    expect(r).toEqual({ ok: true, weekNumber: null });
    expect(tables.scheme_of_work_relief_notes).toHaveLength(1);
    expect(tables.scheme_of_work_relief_notes[0]).toMatchObject({
      sow_id: null,
      week_number: null,
      section_id: 'secA',
      subject_id: 'sci',
      taught_on: TODAY,
      relief_teacher_user_id: 'relief',
      note: '<p>Revised food chains</p>',
    });
  });

  it('a second note the same day replaces the first', async () => {
    const { service, tables } = world();
    const first = await saveReliefNote(service, RELIEF, {
      sectionId: 'secA',
      subjectId: 'sci',
      note: '<p>First go</p>',
      today: TODAY,
    });
    expect(first).toEqual({ ok: true, weekNumber: 2 });
    const second = await saveReliefNote(service, RELIEF, {
      sectionId: 'secA',
      subjectId: 'sci',
      note: '<p>Finished Ch 3.3</p>',
      today: TODAY,
    });
    expect(second).toEqual({ ok: true, weekNumber: 2 });
    expect(tables.scheme_of_work_relief_notes).toHaveLength(1);
    expect(tables.scheme_of_work_relief_notes[0]).toMatchObject({
      sow_id: 'sow1',
      week_number: 2,
      note: '<p>Finished Ch 3.3</p>',
    });

    const lesson = await loadCoveringLesson(
      service,
      'relief',
      'secA',
      'sci',
      TODAY
    );
    expect(lesson.ok && lesson.lesson.myNoteToday).toBe(
      '<p>Finished Ch 3.3</p>'
    );

    // The audit row says THAT there was a note, never what it said.
    const call = logMock.mock.calls.at(-1)![0];
    expect(call.action).toBe('sow.relief_note');
    expect(call.context).toEqual({
      section_id: 'secA',
      subject_id: 'sci',
      taught_on: TODAY,
      week_number: 2,
      note_present: true,
    });
  });

  it("upserts on the table's one-per-day key; another day is its own note", async () => {
    const { service, tables } = world();
    // A row already there for today (another tab saved first): it is
    // replaced in place, never joined by a second one.
    tables.scheme_of_work_relief_notes.push({
      id: 'existing',
      sow_id: 'sow1',
      week_number: 2,
      section_id: 'secA',
      subject_id: 'sci',
      taught_on: TODAY,
      relief_teacher_user_id: 'relief',
      note: '<p>Old</p>',
      created_at: '2026-10-14T01:00:00.000Z',
    });
    await saveReliefNote(service, RELIEF, {
      sectionId: 'secA',
      subjectId: 'sci',
      note: '<p>New</p>',
      today: TODAY,
    });
    expect(upserts).toEqual([
      'relief_teacher_user_id,section_id,subject_id,taught_on',
    ]);
    expect(tables.scheme_of_work_relief_notes).toHaveLength(1);
    expect(tables.scheme_of_work_relief_notes[0]).toMatchObject({
      id: 'existing',
      note: '<p>New</p>',
    });

    // Thursday of the same week is a separate note.
    await saveReliefNote(service, RELIEF, {
      sectionId: 'secA',
      subjectId: 'sci',
      note: '<p>Thursday</p>',
      today: '2026-10-15',
    });
    expect(tables.scheme_of_work_relief_notes).toHaveLength(2);
  });

  it('an empty note is refused', async () => {
    const { service, tables } = world();
    const r = await saveReliefNote(service, RELIEF, {
      sectionId: 'secA',
      subjectId: 'sci',
      note: '<p>  </p>',
      today: TODAY,
    });
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(tables.scheme_of_work_relief_notes).toHaveLength(0);
  });
});
