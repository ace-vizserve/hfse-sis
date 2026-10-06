import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 2 of docs/superpowers/plans/2026-09-28-class-assignment-any-stage.md,
// as it stands after choose mode was removed: class assignment is
// Enrolled-only (assign-section refuses anyone else), a class already named on
// the admissions row (set in Directus) HOLDS A SEAT, and the Enrolled flip
// leaves the child unplaced (and says why) when that class can no longer take
// them — it used to refuse the flip, until the stage dialog's class picker was
// removed on 2026-09-28 — and clears that class from the row. assign-section
// writes the class the person picked unless the row already names it, and
// refuses only a child already on a class list this AY.
//
// The routes run against a small in-memory stand-in for the Supabase query
// builder: every query is recorded, and a per-test resolver answers it by
// table + selected columns. That is enough to prove what was WRITTEN (the
// thing this phase is about) without a live database.

type Q = {
  table: string;
  op: 'select' | 'update' | 'insert' | 'upsert' | 'delete';
  cols: string;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
};
type Answer = { data?: unknown; error?: { message: string } | null };
type Resolver = (q: Q) => Answer;

const h = vi.hoisted(() => ({
  client: null as unknown,
  syncOneStudent: vi.fn(),
  completePlacement: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({
    user: { id: 'user-1', email: 'registrar@hfse.test' },
    role: 'superadmin',
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
vi.mock('@/lib/sync/students', async (orig) => ({
  ...(await orig<typeof import('@/lib/sync/students')>()),
  syncOneStudent: (...args: unknown[]) => h.syncOneStudent(...args),
}));
vi.mock('@/lib/sis/placement-completion', async (orig) => ({
  ...(await orig<typeof import('@/lib/sis/placement-completion')>()),
  completePlacement: (...args: unknown[]) => h.completePlacement(...args),
}));
vi.mock('@/lib/sis/enrolled-at', () => ({
  stampEnrolledAtIfNull: vi.fn(async () => {}),
}));
vi.mock('@/lib/sis/levels', async (orig) => ({
  ...(await orig<typeof import('@/lib/sis/levels')>()),
  resolveLevelId: vi.fn(async () => 'lvl-p1'),
}));

import { POST as assignSection } from '@/app/api/sis/students/[enroleeNumber]/assign-section/route';
import { PATCH as patchStage } from '@/app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route';
import {
  countChosenSeats,
  validateSectionChoice,
  type ChosenClassRow,
} from '@/lib/sis/class-assignment';
import {
  ENROLLED_PREREQ_STAGES,
  STAGE_COLUMN_MAP,
  STAGE_TERMINAL_STATUS,
} from '@/lib/schemas/sis';

// ── The fake client ───────────────────────────────────────────────────────
function fakeClient(resolve: Resolver, log: Q[]) {
  return {
    from(table: string) {
      const q: Q = { table, op: 'select', cols: '', filters: [] };
      log.push(q);
      const out = () => {
        const r = resolve(q);
        return { data: r.data ?? null, error: r.error ?? null, count: null };
      };
      const builder: Record<string, unknown> = {};
      const chain =
        (name: string) =>
        (...args: unknown[]) => {
          if (name === 'select' && q.op === 'select')
            q.cols = String(args[0] ?? '*');
          if (name === 'update' || name === 'insert' || name === 'upsert') {
            q.op = name;
            q.payload = args[0];
          }
          if (name === 'delete') q.op = 'delete';
          if (['eq', 'in', 'not', 'is', 'neq'].includes(name))
            q.filters.push([name, String(args[0]), args.slice(1)]);
          return proxy;
        };
      const proxy: Record<string, unknown> = new Proxy(builder, {
        get(_t, prop: string) {
          if (prop === 'then')
            return (
              res: (v: unknown) => unknown,
              rej: (e: unknown) => unknown
            ) => Promise.resolve(out()).then(res, rej);
          if (prop === 'maybeSingle' || prop === 'single')
            return () => Promise.resolve(out());
          return chain(prop);
        },
      });
      return proxy;
    },
  };
}

// ── One class, one applicant ──────────────────────────────────────────────
const AY = 'AY2027';
const SECTION = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Discipline 1',
};
const OTHER_SECTION_ID = '22222222-2222-4222-8222-222222222222';

type World = {
  applicationStatus: string;
  classLevel: string | null;
  classSection: string | null;
  classStatus?: string | null;
  studentNumber: string | null;
  /** Student numbers on the class list. */
  roster: string[];
  /** Other children's chosen classes (admissions rows). */
  chosen: ChosenClassRow[];
  /** Is this applicant on a class list somewhere this AY? */
  onRosterElsewhere?: string | null;
  /** Does the class the applicant chose exist in the SIS? */
  chosenSectionExists?: boolean;
};

function resolverFor(w: World): Resolver {
  return (q) => {
    const has = (s: string) => q.cols.includes(s);
    if (q.op !== 'select') return {};
    if (q.table === 'ay2027_enrolment_applications') {
      if (has('studentNumber') && q.filters.some(([op]) => op === 'in')) {
        return {
          data: w.chosen.map((c) => ({
            enroleeNumber: c.enroleeNumber,
            studentNumber: c.studentNumber,
          })),
        };
      }
      return {
        data: {
          enroleeNumber: 'E1',
          studentNumber: w.studentNumber,
          enroleeFullName: 'Ana Reyes',
          levelApplied: 'Primary One',
        },
      };
    }
    if (q.table === 'ay2027_enrolment_status') {
      if (q.filters.some(([op]) => op === 'not')) {
        // The chosen-seat read: every row naming a class, this child included.
        return {
          data: [
            ...w.chosen.map((c) => ({
              enroleeNumber: c.enroleeNumber,
              classLevel: c.classLevel,
              classSection: c.classSection,
              applicationStatus: c.applicationStatus,
            })),
            ...(w.classSection
              ? [
                  {
                    enroleeNumber: 'E1',
                    classLevel: w.classLevel,
                    classSection: w.classSection,
                    applicationStatus: w.applicationStatus,
                  },
                ]
              : []),
          ],
        };
      }
      // Any single-row read of this child's status row (pre-image, prereqs,
      // post-save class check): every prereq stage finished.
      const prereqs = Object.fromEntries(
        ENROLLED_PREREQ_STAGES.map((k) => [
          STAGE_COLUMN_MAP[k].statusCol,
          STAGE_TERMINAL_STATUS[k],
        ])
      );
      return {
        data: {
          ...prereqs,
          enroleeNumber: 'E1',
          applicationStatus: w.applicationStatus,
          classLevel: w.classLevel,
          classSection: w.classSection,
          classStatus: w.classStatus ?? (w.classSection ? 'Finished' : null),
          classUpdatedDate: null,
          classUpdatedBy: null,
        },
      };
    }
    if (q.table === 'sections') {
      if (has('levels!inner')) {
        const id = q.filters.find(([op, c]) => op === 'eq' && c === 'id')?.[2];
        const sid = (id as unknown[])[0];
        return {
          data: {
            id: sid,
            name: sid === SECTION.id ? SECTION.name : 'Grit',
            level_id: 'lvl-p1',
            levels: { label: 'Primary One' },
            academic_years: { ay_code: AY },
          },
        };
      }
      // resolveChosenSection's lookup by level + name.
      return w.chosenSectionExists === false
        ? {}
        : { data: { id: SECTION.id } };
    }
    if (q.table === 'levels') {
      // resolveChosenSection reads the whole catalog; other reads take one row.
      return q.filters.length === 0
        ? { data: [{ id: 'lvl-p1', label: 'Primary One' }] }
        : { data: { id: 'lvl-p1', label: 'Primary One' } };
    }
    if (q.table === 'level_aliases') return { data: [] };
    if (q.table === 'section_students') {
      if (has('student:students')) {
        return {
          data: w.roster.map((n) => ({
            section_id: SECTION.id,
            student: { student_number: n },
          })),
        };
      }
      if (has('section:sections')) {
        return {
          data: w.onRosterElsewhere
            ? [{ id: 'ss-9', section: { name: w.onRosterElsewhere } }]
            : [],
        };
      }
      return { data: [] };
    }
    if (q.table === 'students') {
      return { data: w.studentNumber ? { id: 'stu-1' } : null };
    }
    if (q.table === 'academic_years') return { data: { id: 'ay-2027' } };
    return {};
  };
}

function others(n: number, status = 'Submitted'): ChosenClassRow[] {
  return Array.from({ length: n }, (_, i) => ({
    enroleeNumber: `E-other-${i}`,
    studentNumber: `H-other-${i}`,
    classLevel: 'Primary One',
    classSection: 'Discipline-1',
    applicationStatus: status,
  }));
}
function rosterOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `H-roster-${i}`);
}

let log: Q[] = [];
function setWorld(w: World) {
  log = [];
  h.client = fakeClient(resolverFor(w), log);
}
const statusWrites = () =>
  log.filter((q) => q.table === 'ay2027_enrolment_status' && q.op === 'update');

beforeEach(() => {
  vi.clearAllMocks();
  h.syncOneStudent.mockResolvedValue({ ok: true, change: 'enrolled' });
  h.completePlacement.mockResolvedValue({
    midTermEnrolment: null,
    sectionStudentId: 'ss-1',
    indexNumber: 7,
    enrollmentDateStamped: true,
    enrollmentDateBefore: null,
    enrollmentDateAfter: '2026-09-28',
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('countChosenSeats', () => {
  const sections = [
    { id: 's1', name: 'Discipline 1' },
    { id: 's2', name: 'Grit' },
  ];
  const row = (over: Partial<ChosenClassRow>): ChosenClassRow => ({
    enroleeNumber: 'E',
    studentNumber: 'H',
    classLevel: 'Primary One',
    classSection: 'Discipline 1',
    applicationStatus: 'Submitted',
    ...over,
  });

  it('matches a Directus spelling the way the sync does', () => {
    const counts = countChosenSeats(
      [
        row({ enroleeNumber: 'a', classSection: 'Discipline-1' }),
        row({ enroleeNumber: 'b', classLevel: 'Primary 1' }),
      ],
      'Primary One',
      sections,
      new Map()
    );
    expect(counts.get('s1')).toBe(2);
  });

  it('leaves out Cancelled / Withdrawn, other levels and unknown classes', () => {
    const counts = countChosenSeats(
      [
        row({ enroleeNumber: 'a', applicationStatus: 'Cancelled' }),
        row({ enroleeNumber: 'b', applicationStatus: 'Withdrawn' }),
        row({ enroleeNumber: 'c', classLevel: 'Year 8' }),
        row({ enroleeNumber: 'd', classSection: 'Nowhere' }),
        row({ enroleeNumber: 'e', applicationStatus: 'Enrolled' }),
      ],
      'Primary One',
      sections,
      new Map()
    );
    // Only the Enrolled-but-not-on-the-list child holds a seat.
    expect(counts.get('s1')).toBe(1);
    expect(counts.get('s2')).toBeUndefined();
  });

  it('counts a class filed under one of the level\'s form names ("Year 8" → Secondary One)', () => {
    const counts = countChosenSeats(
      [row({ enroleeNumber: 'a', classLevel: 'Year 8' })],
      'Secondary One',
      sections,
      new Map(),
      null,
      new Set(['Year 8'])
    );
    expect(counts.get('s1')).toBe(1);
  });

  it('does not count a child already on that class list, or the excluded child', () => {
    const counts = countChosenSeats(
      [
        row({ enroleeNumber: 'a', studentNumber: 'H-on-list' }),
        row({ enroleeNumber: 'self', studentNumber: 'H-self' }),
        row({ enroleeNumber: 'c', studentNumber: 'H-c' }),
      ],
      'Primary One',
      sections,
      new Map([['s1', new Set(['H-on-list'])]]),
      'self'
    );
    expect(counts.get('s1')).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('validateSectionChoice counts chosen seats', () => {
  const base: World = {
    applicationStatus: 'Submitted',
    classLevel: null,
    classSection: null,
    studentNumber: 'H-self',
    roster: [],
    chosen: [],
  };

  it('is full at 49 on the list plus 1 chosen', async () => {
    setWorld({ ...base, roster: rosterOf(49), chosen: others(1) });
    const r = await validateSectionChoice(
      h.client as never,
      SECTION.id,
      AY,
      'Primary One',
      { enroleeNumber: 'E1', studentNumber: 'H-self' }
    );
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(
      /49 in the class and 1 more assigned to it and waiting to enrol/
    );
  });

  it('never counts the child against their own chosen seat', async () => {
    setWorld({
      ...base,
      classLevel: 'Primary One',
      classSection: 'Discipline 1',
      roster: rosterOf(49),
    });
    const r = await validateSectionChoice(
      h.client as never,
      SECTION.id,
      AY,
      'Primary One',
      { enroleeNumber: 'E1', studentNumber: 'H-self' }
    );
    expect(r).toHaveProperty('section');
  });

  it('does not count a child who already holds a class row this year (e.g. withdrawn after enrolling)', async () => {
    // 49 on the list; one more chose the class but already has a class row
    // this AY — a KD #147 withdrawal keeps Enrolled + their class columns.
    const withdrawn: ChosenClassRow = {
      ...others(1, 'Enrolled')[0],
      studentNumber: 'H-roster-0 ',
    };
    setWorld({ ...base, roster: rosterOf(49), chosen: [withdrawn] });
    const r = await validateSectionChoice(
      h.client as never,
      SECTION.id,
      AY,
      'Primary One',
      { enroleeNumber: 'E1', studentNumber: 'H-self' }
    );
    expect(r).toHaveProperty('section');
  });

  it('never counts the child against their own place on the list', async () => {
    setWorld({ ...base, roster: [...rosterOf(49), 'H-self'] });
    const r = await validateSectionChoice(
      h.client as never,
      SECTION.id,
      AY,
      'Primary One',
      { enroleeNumber: 'E1', studentNumber: 'H-self' }
    );
    expect(r).toHaveProperty('section');
  });
});

// ──────────────────────────────────────────────────────────────────────────
async function assignRequest(sectionId: string): Promise<Response> {
  return (await assignSection(
    new Request(`http://x/api/sis/students/E1/assign-section?ay=${AY}`, {
      method: 'POST',
      body: JSON.stringify({ sectionId }),
    }),
    { params: Promise.resolve({ enroleeNumber: 'E1' }) }
  ))!;
}

describe('assign-section — Enrolled only', () => {
  const submitted: World = {
    applicationStatus: 'Submitted',
    classLevel: null,
    classSection: null,
    studentNumber: 'H-self',
    roster: rosterOf(10),
    chosen: others(3),
  };

  for (const status of ['Submitted', 'Ongoing Verification', 'Processing']) {
    it(`refuses a ${status} applicant with 422 and writes nothing`, async () => {
      setWorld({ ...submitted, applicationStatus: status });
      const res = await assignRequest(SECTION.id);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe(
        `Only Enrolled applicants can be assigned to a class (this one is ${status}). They can be given a class once their application is Enrolled.`
      );
      expect(log.filter((q) => q.op !== 'select')).toEqual([]);
      expect(h.syncOneStudent).not.toHaveBeenCalled();
      expect(h.completePlacement).not.toHaveBeenCalled();
      expect(h.logAction).not.toHaveBeenCalled();
    });
  }

  it('refuses a blank status too, and writes nothing', async () => {
    setWorld({ ...submitted, applicationStatus: '' });
    const res = await assignRequest(SECTION.id);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/this one is not set/);
    expect(statusWrites()).toEqual([]);
  });

  it('refuses a Submitted applicant even when Directus already set a class', async () => {
    setWorld({
      ...submitted,
      classLevel: 'Primary One',
      classSection: 'Grit',
    });
    const res = await assignRequest(SECTION.id);
    expect(res.status).toBe(422);
    expect(statusWrites()).toEqual([]);
  });

  it('still refuses Cancelled', async () => {
    setWorld({ ...submitted, applicationStatus: 'Cancelled' });
    const res = await assignRequest(SECTION.id);
    expect(res.status).toBe(422);
    expect(statusWrites()).toEqual([]);
  });

  it('places an Enrolled child as before', async () => {
    setWorld({ ...submitted, applicationStatus: 'Enrolled' });
    const res = await assignRequest(SECTION.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: 'placed' });
    expect(h.syncOneStudent).toHaveBeenCalledTimes(1);
    expect(h.completePlacement).toHaveBeenCalledTimes(1);
    expect(h.logAction.mock.calls[0][0]).toMatchObject({
      action: 'sis.student.assign_section',
    });
  });

  it('refuses an Enrolled child whose class the waiting seats have filled', async () => {
    setWorld({
      ...submitted,
      applicationStatus: 'Enrolled (Conditional)',
      roster: rosterOf(45),
      chosen: others(5),
    });
    const res = await assignRequest(SECTION.id);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/is full/);
    expect(statusWrites()).toEqual([]);
    expect(h.syncOneStudent).not.toHaveBeenCalled();
  });
});

describe('assign-section — a class already named on the row', () => {
  // Enrolled, the row names Discipline 1 (Directus spelling), and the child
  // has a `students` row — a returning child, or one synced before.
  const named: World = {
    applicationStatus: 'Enrolled',
    classLevel: 'Primary One',
    classSection: 'Discipline-1',
    studentNumber: 'H-self',
    roster: rosterOf(10),
    chosen: [],
  };
  function assignAudit() {
    return h.logAction.mock.calls
      .map((c) => c[0] as { action: string; context: Record<string, unknown> })
      .find((a) => a.action === 'sis.student.assign_section');
  }

  it('writes a DIFFERENT picked class, and the response and audit name it', async () => {
    setWorld(named);
    const res = await assignRequest(OTHER_SECTION_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      mode: 'placed',
      sectionName: 'Grit',
    });
    expect(statusWrites()).toHaveLength(1);
    expect(statusWrites()[0].payload).toMatchObject({
      classSection: 'Grit',
      classLevel: 'Primary One',
      classStatus: 'Finished',
    });
    expect(h.syncOneStudent).toHaveBeenCalledTimes(1);
    expect(assignAudit()?.context).toMatchObject({
      sectionId: OTHER_SECTION_ID,
      sectionName: 'Grit',
      replaced_class: {
        classLevel: 'Primary One',
        classSection: 'Discipline-1',
      },
    });
  });

  it('rolls the picked class back when the sync fails', async () => {
    setWorld(named);
    h.syncOneStudent.mockResolvedValueOnce({ ok: false, reason: 'boom' });
    const res = await assignRequest(OTHER_SECTION_ID);
    expect(res.status).toBe(500);
    expect(statusWrites()).toHaveLength(2);
    expect(statusWrites()[1].payload).toMatchObject({
      classSection: 'Discipline-1',
      classLevel: 'Primary One',
    });
  });

  it('only syncs when the picked class IS the one the row names', async () => {
    setWorld(named);
    const res = await assignRequest(SECTION.id);
    expect(res.status).toBe(200);
    expect(statusWrites()).toEqual([]);
    expect(h.syncOneStudent).toHaveBeenCalledTimes(1);
    expect(assignAudit()?.context).not.toHaveProperty('replaced_class');
  });

  it('assigns a returning child who has a students row but no class this year', async () => {
    // Used to 422 "already in Discipline-1 — use Move student", which the
    // card cannot offer without a class row.
    setWorld({ ...named, onRosterElsewhere: null });
    const res = await assignRequest(OTHER_SECTION_ID);
    expect(res.status).toBe(200);
    expect(h.syncOneStudent).toHaveBeenCalledTimes(1);
  });

  it('refuses a child already on a class list this year — Move student', async () => {
    setWorld({ ...named, onRosterElsewhere: 'Grit' });
    const res = await assignRequest(OTHER_SECTION_ID);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(
      'This student is already in Grit. To move them, use Move student instead.'
    );
    expect(statusWrites()).toEqual([]);
    expect(h.syncOneStudent).not.toHaveBeenCalled();
  });

  it('still checks the picked class has room, resync included', async () => {
    setWorld({ ...named, roster: rosterOf(50) });
    const res = await assignRequest(SECTION.id);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/is full/);
    expect(h.syncOneStudent).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
async function flip(status: string, sectionId?: string): Promise<Response> {
  return (await patchStage(
    new Request(`http://x/api/sis/students/E1/stage/application?ay=${AY}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        remarks: null,
        ...(sectionId ? { section_id: sectionId } : {}),
      }),
    }),
    {
      params: Promise.resolve({ enroleeNumber: 'E1', stageKey: 'application' }),
    }
  ))!;
}

describe('the Enrolled flip with a class chosen earlier', () => {
  const chose: World = {
    applicationStatus: 'Submitted',
    classLevel: 'Primary One',
    classSection: 'Discipline-1',
    studentNumber: 'H-self',
    roster: rosterOf(10),
    chosen: [],
  };

  // Until 2026-09-28 an unusable class REFUSED the flip so the stage dialog's
  // class picker could offer another. The picker is gone (KD #226), so the
  // enrolment now saves, the child is left unplaced, and the response + audit
  // row say why — the class is then given on the Class Assignment card.
  function stageAudit() {
    return h.logAction.mock.calls
      .map((c) => c[0] as { action: string; context: Record<string, unknown> })
      .find((a) => a.action === 'sis.stage.update');
  }

  it('enrols without placing when the chosen class does not exist in the SIS', async () => {
    setWorld({ ...chose, chosenSectionExists: false });
    const res = await flip('Enrolled');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chosenClassUnavailable.chosenClass).toBe(
      'Primary One Discipline-1'
    );
    expect(body.chosenClassUnavailable.reason).toMatch(
      /no class called "Discipline 1"/
    );
    expect(body.classAutoAssigned).toBe(false);
    expect(body.awaitingPlacement).toBe(true);
    expect(statusWrites()).toHaveLength(1);
    // The unusable class is cleared in the same write, and the class stage's
    // who/when are left alone — nobody chose a class here.
    const payload = statusWrites()[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      applicationStatus: 'Enrolled',
      classSection: null,
      classLevel: null,
      classStatus: null,
    });
    expect(payload).not.toHaveProperty('classUpdatedDate');
    expect(payload).not.toHaveProperty('classUpdatedby');
    expect(h.syncOneStudent).not.toHaveBeenCalled();
    expect(h.completePlacement).not.toHaveBeenCalled();
    // The audit keeps the class the row held, and why it was dropped.
    const context = stageAudit()?.context;
    expect(context).toMatchObject({
      chosen_class_unavailable: {
        class: 'Primary One Discipline-1',
        reason: expect.stringMatching(/no class called "Discipline 1"/),
      },
    });
    expect(context?.changes).toEqual(
      expect.arrayContaining([
        { field: 'classSection', from: 'Discipline-1', to: null },
        { field: 'classLevel', from: 'Primary One', to: null },
        { field: 'classStatus', from: 'Finished', to: null },
      ])
    );
  });

  it('enrols without placing when the chosen class is full', async () => {
    setWorld({ ...chose, roster: rosterOf(48), chosen: others(2) });
    const res = await flip('Enrolled (Conditional)');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chosenClassUnavailable.reason).toMatch(
      /Primary One Discipline-1.*full/
    );
    expect(statusWrites()).toHaveLength(1);
    expect(statusWrites()[0].payload).toMatchObject({
      applicationStatus: 'Enrolled (Conditional)',
      classSection: null,
      classLevel: null,
      classStatus: null,
    });
    expect(h.syncOneStudent).not.toHaveBeenCalled();
    expect(stageAudit()?.context).toHaveProperty('chosen_class_unavailable');
  });

  it('leaves the class on the row when it can take them', async () => {
    setWorld({ ...chose, roster: rosterOf(10) });
    await flip('Enrolled');
    expect(statusWrites()[0].payload).not.toHaveProperty('classSection');
  });

  it('places the child in a chosen class that can take them', async () => {
    // 49 others hold the rest; the child's own chosen seat is theirs.
    setWorld({ ...chose, roster: rosterOf(40), chosen: others(9) });
    const res = await flip('Enrolled');
    expect(res.status).toBe(200);
    expect(statusWrites()).toHaveLength(1);
    expect(h.syncOneStudent).toHaveBeenCalledTimes(1);
    expect(h.completePlacement).toHaveBeenCalledTimes(1);
    expect((await res.json()).chosenClassUnavailable).toBeNull();
  });

  // No screen sends `section_id` any more; the route still accepts it for API
  // compatibility.
  it('takes a class sent with a Conditional flip', async () => {
    setWorld({ ...chose, roster: rosterOf(48), chosen: others(2) });
    const res = await flip('Enrolled (Conditional)', OTHER_SECTION_ID);
    expect(res.status).toBe(200);
    expect(statusWrites()[0].payload).toMatchObject({
      applicationStatus: 'Enrolled (Conditional)',
      classSection: 'Grit',
      classLevel: 'Primary One',
    });
  });
});
