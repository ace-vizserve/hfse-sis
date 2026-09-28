import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Enrolled flip WARNS, it does not block (2026-09-28, Mr Ace). Open
// prerequisite steps still refuse the flip — unless the body carries
// `acknowledge_open_steps: true` (the dialog's "Enrol anyway" tick), in which
// case the save goes ahead and the audit row records what was outstanding.
// Enrolled (Conditional) is untouched: it skips the gate outright (KD #180).
//
// Same in-memory Supabase stand-in as class-choice-before-enrolled.test.ts:
// every query is recorded, and a resolver answers it by table.

type Q = {
  table: string;
  op: 'select' | 'update' | 'insert' | 'upsert' | 'delete';
  cols: string;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
};

const h = vi.hoisted(() => ({
  client: null as unknown,
  logAction: vi.fn(),
  syncOneStudent: vi.fn(),
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
vi.mock('@/lib/sync/students', async (orig) => ({
  ...(await orig<typeof import('@/lib/sync/students')>()),
  syncOneStudent: (...args: unknown[]) => h.syncOneStudent(...args),
}));
vi.mock('@/lib/sis/enrolled-at', () => ({
  stampEnrolledAtIfNull: vi.fn(async () => {}),
}));

import { PATCH as patchStage } from '@/app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route';
import {
  ENROLLED_PREREQ_STAGES,
  STAGE_COLUMN_MAP,
  STAGE_TERMINAL_STATUS,
  evaluateEnrolledFlip,
} from '@/lib/schemas/sis';

const AY = 'AY2027';

function fakeClient(
  category: string,
  statusRow: Record<string, unknown>,
  log: Q[]
) {
  const resolve = (q: Q): { data?: unknown } => {
    if (q.op !== 'select') return {};
    if (q.table === 'ay2027_enrolment_status') return { data: statusRow };
    if (q.table === 'ay2027_enrolment_applications') {
      return {
        data: {
          enroleeNumber: 'E1',
          studentNumber: 'H-1',
          levelApplied: 'Primary One',
          category,
        },
      };
    }
    return {};
  };
  return {
    from(table: string) {
      const q: Q = { table, op: 'select', cols: '', filters: [] };
      log.push(q);
      const out = () => ({
        data: resolve(q).data ?? null,
        error: null,
        count: null,
      });
      const chain =
        (name: string) =>
        (...args: unknown[]) => {
          if (name === 'select' && q.op === 'select')
            q.cols = String(args[0] ?? '*');
          if (name === 'update' || name === 'insert' || name === 'upsert') {
            q.op = name;
            q.payload = args[0];
          }
          if (['eq', 'in', 'not', 'is', 'neq'].includes(name))
            q.filters.push([name, String(args[0]), args.slice(1)]);
          return proxy;
        };
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
            return chain(prop);
          },
        }
      );
      return proxy;
    },
  };
}

const ALL_DONE: Record<string, unknown> = Object.fromEntries(
  ENROLLED_PREREQ_STAGES.map((k) => [
    STAGE_COLUMN_MAP[k].statusCol,
    STAGE_TERMINAL_STATUS[k],
  ])
);

let log: Q[] = [];
function setRow(over: Record<string, unknown>, category = 'New') {
  log = [];
  h.client = fakeClient(
    category,
    {
      ...ALL_DONE,
      enroleeNumber: 'E1',
      applicationStatus: 'Processing',
      applicationRemarks: null,
      enroleeType: 'New',
      classLevel: null,
      classSection: null,
      classStatus: null,
      ...over,
    },
    log
  );
}
const statusWrites = () =>
  log.filter((q) => q.table === 'ay2027_enrolment_status' && q.op === 'update');

async function flip(body: Record<string, unknown>): Promise<Response> {
  return (await patchStage(
    new Request(`http://x/api/sis/students/E1/stage/application?ay=${AY}`, {
      method: 'PATCH',
      body: JSON.stringify({ remarks: null, ...body }),
    }),
    {
      params: Promise.resolve({ enroleeNumber: 'E1', stageKey: 'application' }),
    }
  ))!;
}

function stageAudit() {
  return h.logAction.mock.calls
    .map((c) => c[0] as { action: string; context: Record<string, unknown> })
    .find((a) => a.action === 'sis.stage.update');
}

beforeEach(() => {
  vi.clearAllMocks();
  h.syncOneStudent.mockResolvedValue({ ok: true, change: 'no-op' });
});

describe('the Enrolled flip with steps still open', () => {
  it('refuses without the acknowledgement: 422, the blockers, nothing written', async () => {
    setRow({ documentStatus: 'Pending', feeStatus: null });
    const res = await flip({ status: 'Enrolled' });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('prereqs_incomplete');
    expect(body.blockers.map((b: { stage: string }) => b.stage)).toEqual([
      'Documents',
      'Fees',
    ]);
    expect(statusWrites()).toEqual([]);
    expect(h.logAction).not.toHaveBeenCalled();
  });

  it('refuses when the flag is sent as false', async () => {
    setRow({ feeStatus: 'Pending' });
    const res = await flip({
      status: 'Enrolled',
      acknowledge_open_steps: false,
    });
    expect(res.status).toBe(422);
    expect(statusWrites()).toEqual([]);
  });

  it('saves with the acknowledgement, and the audit row carries the open steps', async () => {
    setRow({ documentStatus: 'Pending', feeStatus: null });
    const res = await flip({
      status: 'Enrolled',
      acknowledge_open_steps: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openSteps).toEqual(['Documents', 'Fees']);
    expect(statusWrites()).toHaveLength(1);
    expect(statusWrites()[0].payload).toMatchObject({
      applicationStatus: 'Enrolled',
    });
    expect(stageAudit()?.context).toMatchObject({
      open_steps_at_enrolment: ['Documents', 'Fees'],
    });
  });

  it('still refuses a class from a role that may not place, even acknowledged', () => {
    // Exercised through the pure gate: which roles may place is
    // lib/auth/student-record.ts's business, not this test's.
    const r = evaluateEnrolledFlip({
      canAssignSection: false,
      sectionId: '11111111-1111-4111-8111-111111111111',
      prereqStatuses: { fees: 'Pending' },
      studentNumber: 'H-1',
      acknowledgeOpenSteps: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.code).toBe('placement_forbidden');
  });

  it('the flag means nothing when every step is finished', async () => {
    setRow({});
    const res = await flip({
      status: 'Enrolled',
      acknowledge_open_steps: true,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).openSteps).toEqual([]);
    expect(stageAudit()?.context).not.toHaveProperty('open_steps_at_enrolment');
  });

  it('a Current child is not held back by Assessment', async () => {
    setRow({ assessmentStatus: null }, 'Current');
    const res = await flip({ status: 'Enrolled' });
    expect(res.status).toBe(200);
    expect((await res.json()).openSteps).toEqual([]);
  });
});

describe('re-saving an application that is already Enrolled', () => {
  // The open-steps check is for the change INTO Enrolled. A remarks edit on a
  // child enrolled earlier (with steps open) is not enrolling anyone again.
  it('needs no acknowledgement and records no open steps', async () => {
    setRow({
      applicationStatus: 'Enrolled',
      documentStatus: 'Pending',
      feeStatus: null,
    });
    const res = await flip({
      status: 'Enrolled',
      remarks: 'Called the parent',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).openSteps).toEqual([]);
    expect(statusWrites()).toHaveLength(1);
    expect(statusWrites()[0].payload).toMatchObject({
      applicationRemarks: 'Called the parent',
    });
    expect(stageAudit()?.context).not.toHaveProperty('open_steps_at_enrolment');
  });

  it('coming from Enrolled (Conditional) is a change into Enrolled — the flag is still needed', async () => {
    setRow({
      applicationStatus: 'Enrolled (Conditional)',
      feeStatus: 'Pending',
    });
    const res = await flip({ status: 'Enrolled' });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('prereqs_incomplete');
    expect(statusWrites()).toEqual([]);
  });
});

describe('Enrolled (Conditional) — unchanged, skips the gate', () => {
  it('saves with steps open and no acknowledgement, recording no open steps', async () => {
    setRow({ documentStatus: 'Pending', feeStatus: null });
    const res = await flip({ status: 'Enrolled (Conditional)' });
    expect(res.status).toBe(200);
    expect((await res.json()).openSteps).toEqual([]);
    expect(statusWrites()).toHaveLength(1);
    expect(stageAudit()?.context).not.toHaveProperty('open_steps_at_enrolment');
  });
});

describe('evaluateEnrolledFlip — the acknowledgement', () => {
  const open = { registration: 'Finished', documents: null };

  it('returns openSteps only when steps were open and acknowledged', () => {
    const r = evaluateEnrolledFlip({
      canAssignSection: true,
      sectionId: null,
      prereqStatuses: open,
      studentNumber: 'H-1',
      category: 'Current',
      acknowledgeOpenSteps: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.openSteps?.map((b) => b.stage)).toEqual([
      'Documents',
      'Contract',
      'Fees',
    ]);
  });

  it('without it, the same input is refused', () => {
    const r = evaluateEnrolledFlip({
      canAssignSection: true,
      sectionId: null,
      prereqStatuses: open,
      studentNumber: 'H-1',
    });
    expect(r.ok).toBe(false);
  });
});

describe('the stage dialog, as it ships', () => {
  // Source reads, because the dialog is a 'use client' component with form
  // state. Its class picker was removed on 2026-09-28 (classes are given on
  // the Class Assignment card, KD #226); these pin that it stays gone and
  // that the open-steps panel still has the steps to show.
  const root = join(__dirname, '..', '..');
  const dialog = readFileSync(
    join(root, 'components', 'sis', 'edit-stage-dialog.tsx'),
    'utf8'
  );
  const tab = readFileSync(
    join(root, 'components', 'sis', 'enrollment-tab.tsx'),
    'utf8'
  );

  it('sends no class with the save and offers no picker', () => {
    expect(dialog).not.toContain('section_id');
    expect(dialog).not.toContain('InlineAddSection');
    expect(dialog).not.toMatch(/canAssignSection/);
  });

  it('asks for "Enrol anyway" only on the change into Enrolled', () => {
    expect(dialog).toContain(
      "const enrollingNow = initialStatus !== 'Enrolled'"
    );
    expect(dialog).not.toContain('Save anyway');
  });

  it('the tab still passes the prerequisites in', () => {
    // The prop is optional, so forgetting it fails silently — the open-steps
    // panel would never render and the save would 422 with no warning.
    expect(tab).toContain('prereqStatuses={prereqStatuses}');
  });
});
