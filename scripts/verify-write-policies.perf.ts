/**
 * Proves the WRITE POLICIES, not the triggers — the one thing every other
 * verification in this series could not.
 *
 * ⚠ WHY THE OTHER SCRIPTS DO NOT COVER THIS. They all run as the service role,
 * which bypasses RLS by definition. So migrations 149/150/152/156 have their
 * triggers proven and their policies unproven, and the failure mode is not
 * subtle: if `is_subject_teacher_for_sheet` is wrong, a teacher types a score
 * and nothing saves.
 *
 * An admin click-test cannot answer it either. `is_registrar_or_above()`
 * short-circuits every one of these policies, so an admin passes even when the
 * teacher rule is broken.
 *
 * This asks the database directly, via the read-only probes in migration 157:
 * for each real teacher, which sheets would the policy let them write?
 *
 * WHAT WOULD FAIL IT:
 *   * a teacher who is assigned to teach a subject on an unlocked sheet but is
 *     refused — they could not enter marks;
 *   * a teacher allowed to write a sheet they do not teach — cross-class edit;
 *   * anyone allowed to write a LOCKED sheet from the browser, which would put
 *     a hole through Hard Rule #5.
 *
 * Read-only and safe against production: it evaluates policy predicates and
 * writes nothing.
 *
 * ⚠ REQUIRES MIGRATION 157.
 *
 * Run:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     --config scripts/vitest.perf.config.ts \
 *     scripts/verify-write-policies.perf.ts --pool=threads
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

type Probe = {
  can_write: boolean;
  is_subject_teacher: boolean;
  is_registrar_or_above: boolean;
  sheet_is_locked: boolean;
};

describe('grade_entries write policy', () => {
  it('lets exactly the assigned subject teachers write, and only unlocked sheets', async () => {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const svc = createServiceClient();

    // Real teaching assignments: (teacher, section, subject) triples.
    const { data: assignments, error: aErr } = await svc
      .from('teacher_assignments')
      .select('teacher_user_id, section_id, subject_id, role')
      .in('role', ['subject_teacher', 'co_teacher'])
      .not('teacher_user_id', 'is', null)
      .limit(200);
    expect(aErr, aErr?.message ?? '').toBeNull();

    const rows = (assignments ?? []) as Array<{
      teacher_user_id: string;
      section_id: string;
      subject_id: string;
    }>;
    if (rows.length === 0) {
      console.log(
        '\n  No subject-teacher assignments exist — nothing to prove.'
      );
      return;
    }

    // The sheets those assignments actually cover.
    const sectionIds = [...new Set(rows.map((r) => r.section_id))];
    const { data: sheetRows } = await svc
      .from('grading_sheets')
      .select('id, section_id, subject_id, is_locked')
      .in('section_id', sectionIds);
    const sheets = (sheetRows ?? []) as Array<{
      id: string;
      section_id: string;
      subject_id: string;
      is_locked: boolean;
    }>;

    // Every (section, subject) each teacher covers, so a "not theirs" sheet is
    // genuinely not theirs.
    const pairKey = (s: { section_id: string; subject_id: string }) =>
      `${s.section_id}|${s.subject_id}`;
    const taughtBy = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!taughtBy.has(r.teacher_user_id)) {
        taughtBy.set(r.teacher_user_id, new Set());
      }
      taughtBy.get(r.teacher_user_id)!.add(pairKey(r));
    }

    const shouldWrite: string[] = [];
    const wronglyRefused: string[] = [];
    const wronglyAllowed: string[] = [];
    const lockedButAllowed: string[] = [];
    let checked = 0;

    for (const a of rows.slice(0, 60)) {
      // ⚠ PREFER AN UNLOCKED SHEET FOR THE POSITIVE CASE.
      //
      // A plain `.find()` returns the first sheet for that (section, subject),
      // and with four terms per pair and 848 of 1,116 sheets locked, that is
      // almost always a locked one — so the check that matters, "a teacher CAN
      // save their own marks", ran twice in 120 evaluations while the run
      // reported a clean pass. 225 unlocked sheets have an assigned teacher;
      // this picks from those.
      const theirs = sheets.filter(
        (s) => s.section_id === a.section_id && s.subject_id === a.subject_id
      );
      const mine = theirs.find((s) => !s.is_locked) ?? theirs[0];
      // A locked sheet they DO teach, so Hard Rule #5 is tested on a row the
      // policy would otherwise admit — the only case where the lock is what
      // stops the write, rather than the assignment.
      const mineLocked = theirs.find((s) => s.is_locked);
      // ⚠ EXCLUDE EVERY PAIR THIS TEACHER HOLDS, not just the row in hand.
      //
      // Teachers routinely teach several subjects in one section — the first
      // version compared against the current assignment only, picked a sheet
      // covered by the same teacher's OTHER assignment, and reported the policy
      // as letting a teacher write somebody else's sheet. It was allowing a
      // sheet they genuinely teach. A negative test has to be sure the case is
      // actually negative, or it manufactures a bug report.
      const notMine = sheets.find(
        (s) => !s.is_locked && !taughtBy.get(a.teacher_user_id)?.has(pairKey(s))
      );

      for (const [sheet, expectTeach] of [
        [mine, true],
        [mineLocked, true],
        [notMine, false],
      ] as const) {
        if (!sheet) continue;
        const { data, error } = await svc.rpc('rls_probe_grade_write', {
          p_user_id: a.teacher_user_id,
          p_sheet_id: sheet.id,
        });
        if (error) {
          throw new Error(
            `probe failed — is migration 157 applied? ${error.message}`
          );
        }
        const p = ((data ?? []) as Probe[])[0];
        if (!p) continue;
        checked++;

        // An admin account holding a teaching row passes by role, which is
        // correct and tells us nothing about the teacher rule.
        if (p.is_registrar_or_above) continue;

        const expected = expectTeach && !sheet.is_locked;
        const label = `teacher ${a.teacher_user_id.slice(0, 8)} → sheet ${sheet.id.slice(0, 8)}${sheet.is_locked ? ' (locked)' : ''}`;

        if (expected) shouldWrite.push(label);
        if (expected && !p.can_write) wronglyRefused.push(label);
        if (!expectTeach && p.can_write) wronglyAllowed.push(label);
        if (sheet.is_locked && p.can_write) lockedButAllowed.push(label);
      }
    }

    console.log('\n  policy evaluations        : ' + checked);
    console.log('  should be able to write   : ' + shouldWrite.length);
    console.log('  🔴 wrongly REFUSED        : ' + wronglyRefused.length);
    console.log('  🔴 wrongly ALLOWED        : ' + wronglyAllowed.length);
    console.log('  🔴 locked sheet writable  : ' + lockedButAllowed.length);
    for (const l of [
      ...wronglyRefused,
      ...wronglyAllowed,
      ...lockedButAllowed,
    ].slice(0, 15)) {
      console.log('     ' + l);
    }

    // A teacher who cannot write their own unlocked sheet cannot do their job.
    expect(
      wronglyRefused,
      'A teacher assigned to an unlocked sheet is refused by the policy — they cannot enter marks.'
    ).toEqual([]);
    // A teacher who can write somebody else's sheet is a cross-class edit.
    expect(
      wronglyAllowed,
      'A teacher can write a sheet they are not assigned to.'
    ).toEqual([]);
    // Hard Rule #5: post-lock edits go through the approval flow, never a
    // direct browser write.
    expect(
      lockedButAllowed,
      'A locked sheet is writable from the browser — Hard Rule #5 is bypassable.'
    ).toEqual([]);

    // A run that evaluated nothing must not report success.
    expect(
      checked,
      'No policy evaluations ran — the probe is not testing anything.'
    ).toBeGreaterThan(0);

    // ⚠ AND NEITHER MUST A RUN THAT ONLY EVER PROVED THE REFUSALS.
    //
    // The first version of this script reported a clean pass having tested the
    // "a teacher can save their own marks" case exactly twice out of 120
    // evaluations, because it kept picking locked sheets. Refusals are easy to
    // get right by accident — a policy that denies everyone passes every
    // negative assertion. The positive case is the one that says the feature
    // works at all.
    expect(
      shouldWrite.length,
      'Almost nothing exercised the CAN-write path, so a policy that refuses ' +
        'everybody would also pass this. The probe is picking the wrong sheets.'
    ).toBeGreaterThan(10);
  }, 180_000);
});
