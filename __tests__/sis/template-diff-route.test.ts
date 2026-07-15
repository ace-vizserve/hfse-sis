import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({ user: { id: 'u1' }, role: 'superadmin' })
  ),
}));

vi.mock('@/lib/supabase/service', () => {
  const makeChain = (result: { data: unknown; error: null }) => ({
    select: () => makeChain(result),
    eq: () => makeChain(result),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  });
  return {
    createServiceClient: vi.fn(() => ({
      from: (table: string) => {
        if (table === 'academic_years') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { id: 'ay-1' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'template_subject_configs') {
          return makeChain({
            data: [
              {
                subject_id: 'sci',
                ww_weight: 0.35,
                pt_weight: 0.45,
                qa_weight: 0.2,
                ww_max_slots: 5,
                pt_max_slots: 5,
                qa_max: 30,
              },
            ],
            error: null,
          });
        }
        if (table === 'subject_configs') {
          return makeChain({
            data: [
              {
                subject_id: 'sci',
                ww_weight: 0.4,
                pt_weight: 0.4,
                qa_weight: 0.2,
                ww_max_slots: 5,
                pt_max_slots: 5,
                qa_max: 30,
              },
            ],
            error: null,
          });
        }
        if (table === 'template_sections')
          return makeChain({ data: [], error: null });
        if (table === 'sections') return makeChain({ data: [], error: null });
        if (table === 'template_subject_level_offerings')
          return makeChain({ data: [], error: null });
        if (table === 'subject_level_offerings')
          return makeChain({ data: [], error: null });
        return makeChain({ data: [], error: null });
      },
    })),
  };
});

import { GET } from '@/app/api/sis/admin/template/diff/route';

describe('GET /api/sis/admin/template/diff', () => {
  it('returns the computed diff for the requested AY', async () => {
    const req = new Request(
      'http://localhost/api/sis/admin/template/diff?ay_code=AY2027'
    );
    const res = await GET(req as never);
    const body = await res.json();
    expect(body.diff.configChanges).toEqual([
      {
        subjectId: 'sci',
        field: 'wwWeight',
        from: 0.4,
        to: 0.35,
      },
      {
        subjectId: 'sci',
        field: 'ptWeight',
        from: 0.4,
        to: 0.45,
      },
    ]);
  });
});
