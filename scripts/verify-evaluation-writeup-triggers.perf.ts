/**
 * Checks migration 150's triggers on live data, without changing anything.
 *
 * The evaluation write-up's derived state moved out of
 * `PATCH /api/evaluation/writeups` and into triggers: `updated_at`,
 * `submitted_at`, `created_by`, and the audit row whose ACTION depends on the
 * submitted transition (submit / resubmit / save / none).
 *
 * WHY THIS IS SAFE TO RUN AGAINST PRODUCTION. It re-writes one existing
 * write-up with the values it already has. That is a genuine no-op, and the
 * trigger is supposed to treat it as one — no audit row, `submitted_at`
 * unmoved, `created_by` unchanged. So the test and the behaviour under test are
 * the same thing: if it leaves a trail, the trigger is wrong AND the test told
 * us by finding the row it should not have created.
 *
 * ⚠ Runs as the SERVICE role, so it proves the TRIGGERS, not the POLICIES.
 * RLS is bypassed here by definition. Confirming a teacher can write their own
 * section and not another's needs a real teacher session — click-test that.
 *
 * ⚠ REQUIRES MIGRATION 150.
 *
 * Run:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     --config scripts/vitest.perf.config.ts \
 *     scripts/verify-evaluation-writeup-triggers.perf.ts --pool=threads
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

describe('evaluation write-up triggers', () => {
  it('treats a no-op save as a no-op: no audit row, nothing moved', async () => {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const svc = createServiceClient();

    const { data: rows } = await svc
      .from('evaluation_writeups')
      .select(
        'id, term_id, student_id, section_id, writeup, submitted, submitted_at, created_by, updated_at'
      )
      .limit(1);
    const before = (rows ?? [])[0] as
      | {
          id: string;
          writeup: string | null;
          submitted: boolean | null;
          submitted_at: string | null;
          created_by: string | null;
          updated_at: string;
        }
      | undefined;

    if (!before) {
      console.log(
        '\n  No write-ups exist yet — nothing to exercise. Skipping.'
      );
      return;
    }

    const { count: auditBefore } = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .like('action', 'evaluation.writeup.%');

    // Same values back. The trigger must see nothing worth recording.
    const { error } = await svc
      .from('evaluation_writeups')
      .update({ writeup: before.writeup, submitted: before.submitted })
      .eq('id', before.id);
    expect(
      error,
      'Update failed — is migration 150 applied? ' + (error?.message ?? '')
    ).toBeNull();

    const { data: afterRows } = await svc
      .from('evaluation_writeups')
      .select('submitted_at, created_by, updated_at')
      .eq('id', before.id)
      .single();
    const after = afterRows as {
      submitted_at: string | null;
      created_by: string | null;
      updated_at: string;
    };

    const { count: auditAfter } = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .like('action', 'evaluation.writeup.%');

    console.log('\n  audit rows before : ' + auditBefore);
    console.log(
      '  audit rows after  : ' + auditAfter + '   (must be unchanged)'
    );
    console.log(
      '  submitted_at      : ' +
        before.submitted_at +
        ' -> ' +
        after.submitted_at
    );
    console.log(
      '  created_by        : ' +
        (before.created_by === after.created_by ? 'unchanged' : 'CHANGED')
    );
    console.log(
      '  updated_at        : ' +
        (before.updated_at !== after.updated_at
          ? 'bumped (expected)'
          : 'not bumped')
    );

    // The point of the test.
    expect(auditAfter).toBe(auditBefore);
    // Derived state must not drift on a no-op.
    expect(after.submitted_at).toBe(before.submitted_at);
    expect(after.created_by).toBe(before.created_by);
    // `updated_at` SHOULD move — it records the write, not the change.
    expect(after.updated_at).not.toBe(before.updated_at);
  }, 120_000);
});
