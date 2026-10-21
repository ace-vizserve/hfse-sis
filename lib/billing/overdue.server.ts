import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  overdueSweepTargets,
  statusKey,
  type OverdueCandidate,
  type StageStatuses,
} from '@/lib/billing/overdue';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import { todaySg } from '@/lib/billing/view';
import { connectedRealmId } from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';

type PageErr = { message: string; code?: string };
type Page<T> = PromiseLike<{ data: T[] | null; error: PageErr | null }>;

const NO_TABLE = /PGRST205|42P01|Could not find the table/i;

const chunks = <T>(list: T[], size = 200): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, i * size + size)
  );

/**
 * After the hourly change check: database only, no QuickBooks calls. Every
 * stage with a tied open invoice now past its due date, not Overdue yet, is
 * recomputed (`syncTilesForStudent`), so it turns Overdue the day after.
 */
export async function sweepOverdueStages(
  service: SupabaseClient,
  now: Date = new Date()
): Promise<{ students: number; changed: number; errors: string[] }> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return { students: 0, changed: 0, errors: [] };
  const today = todaySg(now);
  type Inv = {
    id: string;
    student_number: string;
    ay_code: string | null;
    stage_keys: string[] | null;
    state: OverdueCandidate['state'];
    due_date: string | null;
  };
  const rows = await fetchAllPages<Inv>(
    (from, to) =>
      service
        .from('qbo_invoices')
        .select('id, student_number, ay_code, stage_keys, state, due_date')
        .eq('realm_id', realmId)
        .eq('state', 'open')
        .not('ay_code', 'is', null)
        .lt('due_date', today)
        .range(from, to) as unknown as Page<Inv>,
    1000,
    { tieBreak: 'id' }
  );
  const candidates: OverdueCandidate[] = rows
    .filter((r) => (r.stage_keys ?? []).length > 0)
    .map((r) => ({
      studentNumber: r.student_number,
      ayCode: r.ay_code,
      stageKeys: r.stage_keys,
      state: r.state,
      dueDate: r.due_date,
    }));
  if (candidates.length === 0) return { students: 0, changed: 0, errors: [] };

  // The stage statuses of those students, per AY (the student's newest
  // enrolee in the year, as syncTilesForStudent reads it).
  const statuses: StageStatuses = new Map();
  const errors: string[] = [];
  const byAy = new Map<string, Set<string>>();
  for (const c of candidates) {
    const s = byAy.get(c.ayCode!) ?? new Set<string>();
    s.add(c.studentNumber);
    byAy.set(c.ayCode!, s);
  }
  for (const [ayCode, students] of byAy) {
    const slug = ayCode.slice(2).toLowerCase();
    try {
      const enroleeOf = new Map<string, string>();
      for (const list of chunks([...students])) {
        const { data, error } = await service
          .from(`ay${slug}_enrolment_applications`)
          .select('"enroleeNumber","studentNumber"')
          .in('studentNumber', list);
        if (error) throw new Error(error.message);
        for (const a of (data ?? []) as Array<{
          enroleeNumber: string;
          studentNumber: string;
        }>) {
          const prev = enroleeOf.get(a.studentNumber);
          if (!prev || a.enroleeNumber > prev)
            enroleeOf.set(a.studentNumber, a.enroleeNumber);
        }
      }
      const studentOf = new Map(
        [...enroleeOf].map(([sn, en]) => [en, sn] as const)
      );
      for (const list of chunks([...studentOf.keys()])) {
        const { data, error } = await service
          .from(`ay${slug}_enrolment_status`)
          .select('"enroleeNumber","registrationStatus","feeStatus"')
          .in('enroleeNumber', list);
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as Array<{
          enroleeNumber: string;
          registrationStatus: string | null;
          feeStatus: string | null;
        }>) {
          const sn = studentOf.get(r.enroleeNumber);
          if (!sn) continue;
          statuses.set(statusKey(sn, ayCode), {
            registration: r.registrationStatus,
            fees: r.feeStatus,
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!NO_TABLE.test(msg))
        errors.push(`${ayCode}: stage lookup failed: ${msg}`);
    }
  }

  const targets = overdueSweepTargets(candidates, statuses, today);
  let changed = 0;
  for (const t of targets) {
    try {
      const r = await syncTilesForStudent(
        service,
        t.studentNumber,
        [t.ayCode],
        {
          realmId,
        }
      );
      changed += r.changed;
      errors.push(...r.errors.map((e) => `${t.studentNumber}: ${e}`));
    } catch (e) {
      errors.push(
        `${t.studentNumber}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return { students: targets.length, changed, errors };
}
