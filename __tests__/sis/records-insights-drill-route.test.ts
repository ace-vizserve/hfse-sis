import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({
    user: { id: 'u1', email: 'registrar@hfse.test' },
    role: 'school_admin',
  })),
}));

const { buildInsightsDrillRows } = vi.hoisted(() => ({
  buildInsightsDrillRows: vi.fn(),
}));
vi.mock('@/lib/sis/insights-drill-rows', () => ({ buildInsightsDrillRows }));

import { GET } from '@/app/api/records/drill/[target]/route';
import type { RecordsDrillRow } from '@/lib/sis/drill';

function row(over: Partial<RecordsDrillRow>): RecordsDrillRow {
  return {
    enroleeNumber: 'E1',
    studentNumber: 'S1',
    fullName: 'Jane Doe',
    enrollmentStatus: 'active',
    applicationStatus: '',
    level: 'Primary One',
    sectionId: 'sec1',
    sectionName: 'P1 Obedience',
    pipelineStage: 'Enrolled',
    applicationDate: null,
    enrollmentDate: null,
    withdrawalDate: null,
    daysSinceUpdate: null,
    hasMissingDocs: false,
    expiringDocsCount: 0,
    documentsComplete: 0,
    documentsTotal: 0,
    ...over,
  };
}

async function get(target: string, query: string): Promise<Response> {
  const res = await GET(
    new Request(`http://localhost/api/records/drill/${target}?${query}`),
    { params: Promise.resolve({ target }) }
  );
  if (!res) throw new Error('no response');
  return res;
}

beforeEach(() => buildInsightsDrillRows.mockReset());

describe('records drill route — insights targets', () => {
  it('asks for the comparison year on retention', async () => {
    const res = await get('retention', 'ay=AY2026');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_compare_ay' });
  });

  it('rejects a malformed comparison year', async () => {
    const res = await get('retention', 'ay=AY2026&compareAy=2025');
    expect(res.status).toBe(400);
  });

  it('builds retention from both years and applies the segment', async () => {
    buildInsightsDrillRows.mockResolvedValue([
      row({ returned: true }),
      row({ returned: false }),
    ]);
    const res = await get(
      'retention',
      `ay=AY2026&compareAy=AY2025&segment=${encodeURIComponent('level:P1|outcome:didNotReturn')}`
    );
    expect(res.status).toBe(200);
    expect(buildInsightsDrillRows).toHaveBeenCalledWith(
      'retention',
      'AY2026',
      'AY2025'
    );
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.compareAy).toBe('AY2025');
    expect(json.title).toBe('Primary One · did not come back');
  });

  it('opens the comparison year when the chart asks for it', async () => {
    buildInsightsDrillRows.mockResolvedValue([row({})]);
    await get('enrolled-headcount', 'ay=AY2025&segment=level%3AP1');
    expect(buildInsightsDrillRows).toHaveBeenCalledWith(
      'enrolled-headcount',
      'AY2025',
      null
    );
  });

  it('writes the new columns to the CSV', async () => {
    buildInsightsDrillRows.mockResolvedValue([
      row({
        movementKind: 'withdrawn',
        withdrawalReason: 'Financial / non-payment',
        controllable: 'controllable',
        withdrawalDate: '2026-03-20',
      }),
    ]);
    const res = await get('withdrawals', 'ay=AY2026&format=csv');
    const csv = await res.text();
    expect(csv.split('\n')[0]).toContain('Preventable?');
    expect(csv).toContain('Financial / non-payment');
    expect(csv).toContain('Preventable');
  });
});
