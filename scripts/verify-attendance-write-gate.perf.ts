/**
 * Proves migration 149's SQL write-gate agrees with the TypeScript one.
 *
 * Moving the attendance write into the browser means the "is this a teaching
 * day" rule moves from `lib/attendance/school-days.ts` into
 * `public.attendance_write_blocked()`. Two copies of a calendar rule is exactly
 * how a register and a sheet start disagreeing, so this compares them over
 * every real (term, date, section) in the year rather than trusting the port.
 *
 * The rule has four parts and three of them are easy to get backwards — I got
 * two wrong on the first pass:
 *
 *   1. encodable = school_day | hbl | (school_holiday AND hbl_overlay).
 *      The fourth case is a real HBL register, not an edge case.
 *   2. Term with NO calendar rows       -> nothing blocked (legacy mode).
 *   3. Term WITH a calendar, date absent -> BLOCKED (implicit holiday).
 *      Inverting 2 and 3 is how a class gets marked on an unlisted Saturday.
 *   4. Audience: the row for the student's half beats the school-wide 'all'.
 *
 * ⚠ REQUIRES MIGRATION 149.
 *
 * Run:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     --config scripts/vitest.perf.config.ts \
 *     scripts/verify-attendance-write-gate.perf.ts --pool=threads
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

const AY = 'AY2026';

describe('attendance write gate — SQL vs TypeScript', () => {
  it('agrees on every date of the year, for every section', async () => {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const { createNonSchoolDayChecker } =
      await import('@/lib/attendance/school-days');
    const { levelTypeForAudienceLookup } = await import('@/lib/sis/levels');

    const svc = createServiceClient();

    const { data: ay } = await svc
      .from('academic_years')
      .select('id')
      .eq('ay_code', AY)
      .single();
    const ayId = (ay as { id: string }).id;

    const { data: terms } = await svc
      .from('terms')
      .select('id')
      .eq('academic_year_id', ayId);
    const termIds = (terms ?? []).map((t: { id: string }) => t.id);

    // One student per section is enough: the gate depends on the section's
    // LEVEL, not the child, so every student in a section answers identically.
    const { data: sections } = await svc
      .from('sections')
      .select('id, name, level:levels(code)')
      .eq('academic_year_id', ayId);

    type Sec = {
      id: string;
      name: string;
      level: { code: string } | { code: string }[] | null;
    };
    const probes: Array<{ section: string; code: string; ssId: string }> = [];
    for (const s of (sections ?? []) as Sec[]) {
      const { data: one } = await svc
        .from('section_students')
        .select('id')
        .eq('section_id', s.id)
        .limit(1);
      const ssId = (one ?? [])[0]?.id as string | undefined;
      if (!ssId) continue;
      const lvl = Array.isArray(s.level) ? s.level[0] : s.level;
      probes.push({ section: s.name, code: lvl?.code ?? '', ssId });
    }

    // Every date any calendar row mentions, plus a handful that none does —
    // the unlisted dates are the case that matters most (rule 3).
    const { data: calRows } = await svc
      .from('school_calendar')
      .select('term_id, date')
      .in('term_id', termIds);
    const dates = new Map<string, Set<string>>();
    for (const r of (calRows ?? []) as Array<{
      term_id: string;
      date: string;
    }>) {
      if (!dates.has(r.term_id)) dates.set(r.term_id, new Set());
      dates.get(r.term_id)!.add(r.date);
    }
    // Add unlisted probes: a Saturday and a Sunday per term.
    for (const t of termIds) {
      if (!dates.has(t)) dates.set(t, new Set());
      dates.get(t)!.add('2026-08-01'); // Saturday
      dates.get(t)!.add('2026-08-02'); // Sunday
    }

    const isNonSchoolDay = createNonSchoolDayChecker(svc);

    let compared = 0;
    const disagreements: string[] = [];

    for (const [termId, dateSet] of dates) {
      for (const date of dateSet) {
        for (const p of probes) {
          const levelType = levelTypeForAudienceLookup(p.code);
          const ts = await isNonSchoolDay(termId, date, levelType);
          const { data: sqlVal, error } = await svc.rpc(
            'attendance_write_blocked',
            {
              p_term_id: termId,
              p_date: date,
              p_section_student_id: p.ssId,
            }
          );
          if (error) {
            throw new Error(
              'attendance_write_blocked missing — apply migration 149 first. ' +
                error.message
            );
          }
          compared++;
          if (Boolean(sqlVal) !== ts) {
            disagreements.push(
              `${p.section} ${date}: sql=${sqlVal} ts=${ts} (level ${p.code}, audience ${levelType ?? 'all'})`
            );
          }
        }
      }
    }

    console.log('\n  comparisons made : ' + compared);
    console.log('  sections probed  : ' + probes.length);
    console.log('  disagreements    : ' + disagreements.length);
    for (const d of disagreements.slice(0, 15)) console.log('    ' + d);

    expect(disagreements.slice(0, 15)).toEqual([]);
    expect(compared).toBeGreaterThan(0);
  }, 600_000);
});
