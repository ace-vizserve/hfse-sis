/**
 * Regression test for the C2 completion fix in `lib/supabase/admissions.ts`.
 *
 * Context: the original C2 fix (bug-hunt 2026-07-07) replaced a spliced
 * `.or()` PostgREST filter — vulnerable to `,`/`(`/`)` grammar injection —
 * with two parameterized `.ilike('motherEmail', trimmed)` /
 * `.ilike('fatherEmail', trimmed)` calls. That closed the grammar-injection
 * class, but `.ilike(column, pattern)` still treats `pattern` as a genuine
 * ILIKE pattern — so a caller's own `%`/`_` characters remain live
 * wildcards. Since this function is the SOLE authorization basis for the
 * internet-facing `/api/parent/v2/*` endpoints, a parent registered as
 * `%@gmail.com` would over-match every parent whose stored email ends
 * `@gmail.com` and could pull other families' report cards.
 *
 * This test mocks the Supabase service client and asserts that the pattern
 * actually handed to `.ilike()` has `%`/`_` escaped (`\%`/`\_`), restoring
 * exact-match semantics.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Capture every (table, column, pattern) triple passed to `.ilike()` so the
// test can assert on exactly what reaches Supabase, without a live DB.
const ilikeCalls: Array<{ table: string; column: string; pattern: string }> =
  [];

vi.mock('@/lib/supabase/service', () => {
  return {
    createServiceClient: vi.fn(() => ({
      from: (table: string) => {
        if (table === 'academic_years') {
          return {
            select: () => ({
              order: () =>
                Promise.resolve({ data: [{ ay_code: 'AY2026' }], error: null }),
            }),
          };
        }
        // Both ayYYYY_enrolment_applications and ayYYYY_enrolment_status
        // land here. Only the apps table is queried via `.ilike()`; the
        // status table is never reached because the apps query returns no
        // rows in this test (enroleeNumbers.length === 0 short-circuits).
        return {
          select: () => ({
            ilike: (column: string, pattern: string) => {
              ilikeCalls.push({ table, column, pattern });
              return Promise.resolve({ data: [], error: null });
            },
          }),
        };
      },
    })),
  };
});

import { getAllStudentsByParentEmail } from '@/lib/supabase/admissions';

describe('getAllStudentsByParentEmail — ILIKE wildcard escaping (C2 completion)', () => {
  beforeEach(() => {
    ilikeCalls.length = 0;
  });

  it('escapes a literal "%" in the caller email before it reaches .ilike()', async () => {
    await getAllStudentsByParentEmail('%@gmail.com');

    expect(ilikeCalls.length).toBeGreaterThan(0);
    for (const call of ilikeCalls) {
      // The escaped pattern must not contain a bare (unescaped) wildcard —
      // every literal % must be preceded by a backslash.
      expect(call.pattern).toBe('\\%@gmail.com');
      expect(call.pattern).not.toBe('%@gmail.com');
    }

    const columns = ilikeCalls.map((c) => c.column).sort();
    expect(columns).toEqual(['fatherEmail', 'motherEmail']);
  });

  it('escapes a literal "_" the same way', async () => {
    await getAllStudentsByParentEmail('jo_hn@example.com');

    expect(ilikeCalls.length).toBeGreaterThan(0);
    for (const call of ilikeCalls) {
      expect(call.pattern).toBe('jo\\_hn@example.com');
    }
  });

  it('escapes a mixed "%"/"_" email exactly, mirroring lib/sis/queries.ts', async () => {
    await getAllStudentsByParentEmail('jo%hn_doe@x.com');

    expect(ilikeCalls.length).toBeGreaterThan(0);
    for (const call of ilikeCalls) {
      expect(call.pattern).toBe('jo\\%hn\\_doe@x.com');
    }
  });

  it('leaves an email with no metacharacters unchanged', async () => {
    await getAllStudentsByParentEmail('jane.smith@example.com');

    expect(ilikeCalls.length).toBeGreaterThan(0);
    for (const call of ilikeCalls) {
      expect(call.pattern).toBe('jane.smith@example.com');
    }
  });
});
