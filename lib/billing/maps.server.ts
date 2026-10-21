import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  groupChanges,
  type InvoiceChange,
} from '@/lib/billing/settings-helpers';
import {
  addTypedNumber,
  emptyMaps,
  tieFor,
  type BillingMaps,
  type TieReason,
} from '@/lib/billing/tie';
import { syncTilesForAllStudents } from '@/lib/billing/tiles.server';
import { connectedRealmId } from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';

// What ties an invoice to a Registration / Fees stage it was not created
// from: the invoice number staff typed on that stage (spec 2026-10-21). Read
// from every AY's admissions tables; nothing is set up by hand.

type PageErr = { message: string; code?: string };
type Page<T> = PromiseLike<{ data: T[] | null; error: PageErr | null }>;

/** "This year has no admissions tables" (e.g. a future AY). */
const NO_TABLE = /PGRST205|42P01|Could not find the table/i;

const chunks = <T>(list: T[], size = 200): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, i * size + size)
  );

/**
 * The invoice numbers typed on the students' Registration and Fees stages
 * (all students when `studentNumbers` is left out), every AY. Also returns
 * the AY codes whose tables exist.
 */
async function loadTypedNumbers(
  service: SupabaseClient,
  studentNumbers?: string[]
): Promise<{ maps: BillingMaps; ayCodes: string[] }> {
  const maps = emptyMaps();
  const ayCodes: string[] = [];
  if (studentNumbers && studentNumbers.length === 0) return { maps, ayCodes };
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: true });
  if (error) throw new Error(`Academic years lookup failed: ${error.message}`);
  type App = { enroleeNumber: string; studentNumber: string };
  type Stage = {
    enroleeNumber: string;
    registrationInvoice: string | null;
    feeInvoice: string | null;
  };
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const slug = ay_code.slice(2).toLowerCase();
    let apps: App[] = [];
    let stages: Stage[] = [];
    try {
      for (const list of studentNumbers ? chunks(studentNumbers) : [null])
        apps.push(
          ...(await fetchAllPages<App>(
            (from, to) => {
              let q = service
                .from(`ay${slug}_enrolment_applications`)
                .select('"enroleeNumber","studentNumber"')
                .not('studentNumber', 'is', null);
              if (list) q = q.in('studentNumber', list);
              return q.range(from, to) as unknown as Page<App>;
            },
            1000,
            { tieBreak: 'enroleeNumber' }
          ))
        );
      apps = apps.filter((a) => a.enroleeNumber && a.studentNumber);
      const enrolees = studentNumbers ? apps.map((a) => a.enroleeNumber) : null;
      if (!enrolees || enrolees.length > 0)
        for (const list of enrolees ? chunks(enrolees) : [null])
          stages.push(
            ...(await fetchAllPages<Stage>(
              (from, to) => {
                let q = service
                  .from(`ay${slug}_enrolment_status`)
                  .select('"enroleeNumber","registrationInvoice","feeInvoice"')
                  .or('registrationInvoice.not.is.null,feeInvoice.not.is.null');
                if (list) q = q.in('enroleeNumber', list);
                return q.range(from, to) as unknown as Page<Stage>;
              },
              1000,
              { tieBreak: 'enroleeNumber' }
            ))
          );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (NO_TABLE.test(msg)) continue;
      throw e;
    }
    ayCodes.push(ay_code);
    const studentOf = new Map(
      apps.map((a) => [a.enroleeNumber, a.studentNumber])
    );
    stages = stages.filter((s) => studentOf.has(s.enroleeNumber));
    for (const s of stages) {
      const sn = studentOf.get(s.enroleeNumber)!;
      addTypedNumber(maps, sn, s.registrationInvoice, {
        ayCode: ay_code,
        stage: 'registration',
      });
      addTypedNumber(maps, sn, s.feeInvoice, {
        ayCode: ay_code,
        stage: 'fees',
      });
    }
  }
  return { maps, ayCodes };
}

/**
 * The typed-number ties' data. Pass `studentNumbers` when only those
 * students' invoices will be saved — another student's invoice then gets no
 * typed-number tie.
 */
export async function loadBillingMaps(
  service: SupabaseClient,
  opts?: { studentNumbers?: string[] }
): Promise<BillingMaps> {
  return (await loadTypedNumbers(service, opts?.studentNumbers)).maps;
}

/** One stored invoice whose tie changes. */
export type Move = {
  id: string;
  studentNumber: string;
  docNumber: string | null;
  fromAy: string | null;
  fromStages: string[];
  toAy: string | null;
  toStages: string[];
  reason: TieReason;
};

/**
 * Re-ties every stored invoice by `tieFor`: an invoice keeps the tie it has;
 * one with none is tied to the stage whose typed number is its number.
 * Returns the students whose invoices got a tie, every year involved, the
 * moves, and how many invoices ended up with each reason. With `dryRun`,
 * nothing is written.
 */
export async function retieAll(
  service: SupabaseClient,
  preloaded?: { realmId: string; maps: BillingMaps },
  opts?: { dryRun?: boolean }
): Promise<{
  changed: string[];
  years: string[];
  moves: Move[];
  reasons: Record<TieReason, number>;
}> {
  const reasons: Record<TieReason, number> = {
    kept: 0,
    created: 0,
    typed: 0,
    none: 0,
  };
  const realmId = preloaded?.realmId ?? (await connectedRealmId(service));
  if (!realmId) return { changed: [], years: [], moves: [], reasons };
  const maps = preloaded?.maps ?? (await loadBillingMaps(service));
  const changed = new Set<string>();
  const years = new Set<string>();
  const moves: Move[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service
      .from('qbo_invoices')
      .select('id, student_number, doc_number, ay_code, stage_keys')
      .eq('realm_id', realmId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
    const page: Move[] = [];
    for (const r of (data ?? []) as Array<{
      id: string;
      student_number: string;
      doc_number: string | null;
      ay_code: string | null;
      stage_keys: string[] | null;
    }>) {
      const { place, reason } = tieFor({
        existing: {
          ayCode: r.ay_code,
          stageKeys: r.stage_keys,
          studentNumber: r.student_number,
        },
        studentNumber: r.student_number,
        docNumber: r.doc_number,
        maps,
      });
      reasons[reason]++;
      if (
        place.ayCode === r.ay_code &&
        place.stageKeys.join(',') === (r.stage_keys ?? []).join(',')
      )
        continue;
      page.push({
        id: r.id,
        studentNumber: r.student_number,
        docNumber: r.doc_number,
        fromAy: r.ay_code,
        fromStages: r.stage_keys ?? [],
        toAy: place.ayCode,
        toStages: place.stageKeys,
        reason,
      });
    }
    for (const m of page) {
      changed.add(m.studentNumber);
      if (m.fromAy) years.add(m.fromAy);
      if (m.toAy) years.add(m.toAy);
    }
    moves.push(...page);
    if (!opts?.dryRun) {
      const pending: InvoiceChange[] = page.map((m) => ({
        id: m.id,
        ayCode: m.toAy,
        stageKeys: m.toStages,
      }));
      for (const g of groupChanges(pending)) {
        const up = await service
          .from('qbo_invoices')
          .update({ ay_code: g.ayCode, stage_keys: g.stageKeys })
          .in('id', g.ids);
        if (up.error)
          throw new Error(`Invoice update failed: ${up.error.message}`);
      }
    }
    if (!data || data.length < 1000) break;
  }
  return { changed: [...changed], years: [...years], moves, reasons };
}

/**
 * Re-ties every stored invoice, then recomputes the stages of every student
 * with a tied invoice, for every AY that has tables. Run once after the
 * switch to ties (migration 195) — scripts/qbo/billing-link.ts --reclassify.
 */
export async function retieAndSyncTiles(
  service: SupabaseClient,
  opts?: { dryRun?: boolean }
): Promise<{
  studentsAffected: number;
  moves: Move[];
  reasons: Record<TieReason, number>;
  tileErrors: string[];
}> {
  const realmId = await connectedRealmId(service);
  if (!realmId)
    return {
      studentsAffected: 0,
      moves: [],
      reasons: { kept: 0, created: 0, typed: 0, none: 0 },
      tileErrors: [],
    };
  const { maps, ayCodes } = await loadTypedNumbers(service);
  const { changed, years, moves, reasons } = await retieAll(
    service,
    { realmId, maps },
    { dryRun: opts?.dryRun }
  );
  if (opts?.dryRun)
    return { studentsAffected: changed.length, moves, reasons, tileErrors: [] };
  const tiles = await syncTilesForAllStudents(
    service,
    [...new Set([...ayCodes, ...years])],
    { realmId, extraStudents: changed }
  );
  return {
    studentsAffected: changed.length,
    moves,
    reasons,
    tileErrors: tiles.errors,
  };
}
