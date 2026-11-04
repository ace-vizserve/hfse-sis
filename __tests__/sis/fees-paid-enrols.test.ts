import { beforeEach, describe, expect, it, vi } from 'vitest';

// Marking Fees as Paid enrols the student (Miss Luz, Miss Hazel, 2026-11-04):
// "pag na marked as paid ko na sana mag automatic tag as enrolled na po".
// Same in-memory Supabase stand-in as enrolled-flip-acknowledge-open-steps.

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
  stamp: vi.fn(async () => true),
  completePlacement: vi.fn(async () => ({ midTermEnrolment: null })),
}));

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({
    user: { id: 'user-1', email: 'hazel@hfse.test' },
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
  stampEnrolledAtIfNull: () => h.stamp(),
}));
vi.mock('@/lib/sis/placement-completion', () => ({
  completePlacement: () => h.completePlacement(),
}));
vi.mock('@/lib/qbo/stage-invoices', () => ({
  loadQboStageLock: vi.fn(async () => ({
    connected: false,
    invoiceState: null,
  })),
}));

import { PATCH as patchStage } from '@/app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route';
import { canEnrolOnFeesPaid } from '@/lib/sis/enrol-on-fees-paid';

const AY = 'AY2027';

function fakeClient(statusRow: Record<string, unknown>, log: Q[]) {
  const answer = (q: Q) => {
    if (q.table === 'ay2027_enrolment_status')
      return q.op === 'update' ? [statusRow] : statusRow;
    if (q.table === 'ay2027_enrolment_applications')
      return {
        enroleeNumber: 'E1',
        studentNumber: 'H-1',
        levelApplied: 'Primary One',
        category: 'New',
      };
    return null;
  };
  return {
    from(table: string) {
      const q: Q = { table, op: 'select', cols: '', filters: [] };
      log.push(q);
      const out = () => ({ data: answer(q), error: null, count: null });
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

let log: Q[] = [];
function setRow(over: Record<string, unknown> = {}) {
  log = [];
  h.client = fakeClient(
    {
      enroleeNumber: 'E1',
      applicationStatus: 'Processing',
      enroleeType: 'New',
      registrationStatus: 'Finished',
      documentStatus: 'Finished',
      assessmentStatus: 'Finished',
      contractStatus: 'Signed',
      feeStatus: 'Invoiced',
      feeRemarks: null,
      feeInvoice: 'HFSE1',
      feePaymentDate: null,
      feeStartDate: '2027-01-04',
      classLevel: null,
      classSection: null,
      classStatus: null,
      ...over,
    },
    log
  );
}

const applicationWrites = () =>
  log.filter(
    (q) =>
      q.op === 'update' &&
      q.table === 'ay2027_enrolment_status' &&
      (q.payload as Record<string, unknown>).applicationStatus !== undefined
  );

async function saveFees(status: string): Promise<Response> {
  return (await patchStage(
    new Request(`http://x/api/sis/students/E1/stage/fees?ay=${AY}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        remarks: null,
        extras: {
          invoice: 'HFSE1',
          paymentDate: status === 'Paid' ? '2026-11-04' : null,
          startDate: '2027-01-04',
        },
      }),
    }),
    { params: Promise.resolve({ enroleeNumber: 'E1', stageKey: 'fees' }) }
  ))!;
}

const enrolAudit = () =>
  h.logAction.mock.calls
    .map((c) => c[0] as { action: string; context: Record<string, unknown> })
    .find(
      (a) =>
        a.action === 'sis.stage.update' && a.context.stage === 'application'
    );

beforeEach(() => {
  vi.clearAllMocks();
  h.syncOneStudent.mockResolvedValue({ ok: true, change: 'no-op' });
});

describe('marking Fees as Paid in the SIS', () => {
  it('enrols the student and records who and why', async () => {
    setRow();
    const res = await saveFees('Paid');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feesPaidEnrolment).toMatchObject({
      enrolled: true,
      openSteps: [],
      awaitingPlacement: true,
    });
    const [write] = applicationWrites();
    expect(write.payload).toMatchObject({
      applicationStatus: 'Enrolled',
      applicationUpdatedBy: 'hazel@hfse.test',
    });
    // Only if it is still what was read: never over a Cancelled saved meanwhile.
    expect(write.filters).toContainEqual([
      'eq',
      'applicationStatus',
      ['Processing'],
    ]);
    expect(h.stamp).toHaveBeenCalled();
    expect(enrolAudit()?.context).toMatchObject({
      trigger: 'fees_paid',
      changes: [
        { field: 'applicationStatus', from: 'Processing', to: 'Enrolled' },
      ],
    });
  });

  it('enrols with steps still open, and says which', async () => {
    setRow({ documentStatus: 'Pending', contractStatus: 'Sent' });
    const body = await (await saveFees('Paid')).json();
    expect(body.feesPaidEnrolment.enrolled).toBe(true);
    expect(body.feesPaidEnrolment.openSteps).toEqual(['Documents', 'Contract']);
    expect(enrolAudit()?.context.open_steps_at_enrolment).toEqual([
      'Documents',
      'Contract',
    ]);
  });

  it('takes an unusable class off the record, and says so', async () => {
    setRow({
      classLevel: 'Primary One',
      classSection: 'Patience',
      classStatus: 'Finished',
    });
    // The class itself is checked by the shared rule, tested in
    // class-choice-before-enrolled; here it cannot be found, so it is cleared.
    const body = await (await saveFees('Paid')).json();
    expect(body.feesPaidEnrolment.chosenClassUnavailable).toMatchObject({
      chosenClass: 'Primary One Patience',
    });
    expect(applicationWrites()[0].payload).toMatchObject({
      classSection: null,
      classLevel: null,
      classStatus: null,
    });
    expect(h.syncOneStudent).not.toHaveBeenCalled();
  });

  it.each(['Enrolled', 'Enrolled (Conditional)', 'Cancelled', 'Withdrawn'])(
    'leaves an application at %s alone',
    async (applicationStatus) => {
      setRow({ applicationStatus });
      const body = await (await saveFees('Paid')).json();
      expect(body.feesPaidEnrolment).toBeNull();
      expect(applicationWrites()).toEqual([]);
    }
  );

  it('does nothing when Fees was already Paid (a re-save)', async () => {
    setRow({ feeStatus: 'Paid', feePaymentDate: '2026-11-01' });
    const body = await (await saveFees('Paid')).json();
    expect(body.feesPaidEnrolment).toBeNull();
    expect(applicationWrites()).toEqual([]);
  });

  it('does nothing for any other Fees status', async () => {
    setRow({ feeStatus: 'Pending' });
    const body = await (await saveFees('Invoiced')).json();
    expect(body.feesPaidEnrolment).toBeNull();
    expect(applicationWrites()).toEqual([]);
  });
});

describe('canEnrolOnFeesPaid', () => {
  it('is true only for an application still in the pipeline', () => {
    for (const s of ['Submitted', 'Ongoing Verification', 'Processing'])
      expect(canEnrolOnFeesPaid(s)).toBe(true);
    for (const s of [
      'Enrolled',
      'Enrolled (Conditional)',
      'Cancelled',
      'Withdrawn',
      '',
      null,
    ])
      expect(canEnrolOnFeesPaid(s)).toBe(false);
  });
});
