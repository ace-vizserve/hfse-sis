import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  classifyInvoice,
  stageForAccount,
  type BillingMaps,
  type InvoiceLine,
  type StageChoice,
  type StudentApplication,
} from '@/lib/billing/classify';
import {
  groupChanges,
  type InvoiceChange,
} from '@/lib/billing/settings-helpers';
import { syncTilesForAllStudents } from '@/lib/billing/tiles.server';
import { todaySg } from '@/lib/billing/view';
import {
  connectedRealmId,
  qboQueryAll,
  QboNotConnectedError,
} from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';

// What puts an invoice on a Registration / Fees tile, worked out from
// QuickBooks and the SIS's own applications — nothing is set up by hand
// (KD #232 update 2026-10-16). The tile rule is `stageForAccount`, the year
// rule `yearForInvoice` (lib/billing/classify.ts).

type PageErr = { message: string; code?: string };
type Page<T> = PromiseLike<{ data: T[] | null; error: PageErr | null }>;

/** "This year has no admissions tables" (e.g. a future AY). */
const NO_TABLE = /PGRST205|42P01|Could not find the table/i;

/** Income account → tile, from every cached QuickBooks item. */
async function loadAccounts(
  service: SupabaseClient
): Promise<Map<string, StageChoice>> {
  type Row = {
    income_account_id: string;
    income_account_name: string | null;
  };
  const rows = await fetchAllPages<Row>(
    (from, to) =>
      service
        .from('qbo_items')
        .select('qbo_item_id, income_account_id, income_account_name')
        .not('income_account_id', 'is', null)
        .range(from, to) as unknown as Page<Row>,
    1000,
    { tieBreak: 'qbo_item_id' }
  );
  return new Map(
    rows.map((r) => [
      r.income_account_id,
      stageForAccount(r.income_account_name),
    ])
  );
}

/**
 * Every application of the students (all students when `studentNumbers` is
 * left out), any AY, with the Singapore date each was made. Also returns the
 * AY codes whose tables exist.
 */
async function loadApplications(
  service: SupabaseClient,
  studentNumbers?: string[]
): Promise<{
  applications: Map<string, StudentApplication[]>;
  ayCodes: string[];
}> {
  const applications = new Map<string, StudentApplication[]>();
  const ayCodes: string[] = [];
  if (studentNumbers && studentNumbers.length === 0)
    return { applications, ayCodes };
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: true });
  if (error) throw new Error(`Academic years lookup failed: ${error.message}`);
  type Row = { studentNumber: string; created_at: string };
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const table = `ay${ay_code.slice(2)}_enrolment_applications`;
    let rows: Row[];
    try {
      rows = [];
      const lists = studentNumbers
        ? Array.from(
            { length: Math.ceil(studentNumbers.length / 200) },
            (_, i) => studentNumbers.slice(i * 200, i * 200 + 200)
          )
        : [null];
      for (const list of lists) {
        rows.push(
          ...(await fetchAllPages<Row>(
            (from, to) => {
              let q = service
                .from(table)
                .select('"studentNumber",created_at')
                .not('studentNumber', 'is', null);
              if (list) q = q.in('studentNumber', list);
              return q.range(from, to) as unknown as Page<Row>;
            },
            1000,
            { tieBreak: 'enroleeNumber' }
          ))
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (NO_TABLE.test(msg)) continue;
      throw e;
    }
    ayCodes.push(ay_code);
    for (const r of rows) {
      if (!r.created_at) continue;
      const list = applications.get(r.studentNumber) ?? [];
      list.push({
        ayCode: ay_code,
        createdOn: todaySg(new Date(r.created_at)),
      });
      applications.set(r.studentNumber, list);
    }
  }
  return { applications, ayCodes };
}

/**
 * The tile rule's accounts plus the students' applications. Pass
 * `studentNumbers` when only those students' invoices will be placed — an
 * invoice of a student left out gets no year.
 */
export async function loadBillingMaps(
  service: SupabaseClient,
  opts?: { studentNumbers?: string[] }
): Promise<BillingMaps> {
  const [accounts, apps] = await Promise.all([
    loadAccounts(service),
    loadApplications(service, opts?.studentNumbers),
  ]);
  return { accounts, applications: apps.applications };
}

/** Re-reads every QuickBooks item into `qbo_items`; returns how many. */
export async function refreshItems(service: SupabaseClient): Promise<number> {
  const realmId = await connectedRealmId(service);
  if (!realmId) throw new QboNotConnectedError();
  const items = await qboQueryAll<{
    Id: string;
    Name: string;
    Active?: boolean;
    IncomeAccountRef?: { value: string; name?: string };
  }>(service, 'Item', 'Active IN (true, false)');
  const rows = items.map((it) => ({
    qbo_item_id: it.Id,
    name: it.Name,
    income_account_id: it.IncomeAccountRef?.value ?? null,
    income_account_name: it.IncomeAccountRef?.name ?? null,
    active: it.Active !== false,
    synced_at: new Date().toISOString(),
    realm_id: realmId,
  }));
  for (let k = 0; k < rows.length; k += 500) {
    const { error } = await service
      .from('qbo_items')
      .upsert(rows.slice(k, k + 500));
    if (error) throw new Error(`Saving items failed: ${error.message}`);
  }
  return rows.length;
}

/** One stored invoice whose year or tiles change. */
export type Move = {
  id: string;
  studentNumber: string;
  docNumber: string | null;
  fromAy: string | null;
  fromStages: string[];
  toAy: string | null;
  toStages: string[];
};

/**
 * Re-applies the tile and year rules to every stored invoice. Returns the
 * students whose invoices moved, every year they moved from or to, and the
 * moves themselves. With `dryRun`, nothing is written.
 */
export async function reclassifyAll(
  service: SupabaseClient,
  preloaded?: { realmId: string; maps: BillingMaps },
  opts?: { dryRun?: boolean }
): Promise<{ changed: string[]; years: string[]; moves: Move[] }> {
  const realmId = preloaded?.realmId ?? (await connectedRealmId(service));
  if (!realmId) return { changed: [], years: [], moves: [] };
  const maps = preloaded?.maps ?? (await loadBillingMaps(service));
  const changed = new Set<string>();
  const years = new Set<string>();
  const moves: Move[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service
      .from('qbo_invoices')
      .select(
        'id, student_number, doc_number, txn_date, lines, ay_code, stage_keys'
      )
      .eq('realm_id', realmId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
    const page: Move[] = [];
    for (const r of (data ?? []) as Array<{
      id: string;
      student_number: string;
      doc_number: string | null;
      txn_date: string | null;
      lines: InvoiceLine[];
      ay_code: string | null;
      stage_keys: string[];
    }>) {
      const c = classifyInvoice(
        r.lines ?? [],
        r.txn_date,
        maps,
        r.student_number
      );
      if (
        c.ayCode === r.ay_code &&
        c.stageKeys.join(',') === (r.stage_keys ?? []).join(',')
      )
        continue;
      page.push({
        id: r.id,
        studentNumber: r.student_number,
        docNumber: r.doc_number,
        fromAy: r.ay_code,
        fromStages: r.stage_keys ?? [],
        toAy: c.ayCode,
        toStages: c.stageKeys,
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
  return { changed: [...changed], years: [...years], moves };
}

/**
 * Re-applies the rules to every stored invoice, then recomputes the tiles of
 * the students whose invoices moved plus every student with an invoice on a
 * tile, for every AY that has tables and every year an invoice moved from.
 * Run once after the rules change (scripts/qbo/billing-link.ts --reclassify).
 */
export async function reclassifyAndSyncTiles(
  service: SupabaseClient,
  opts?: { dryRun?: boolean }
): Promise<{
  studentsAffected: number;
  moves: Move[];
  tileErrors: string[];
}> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return { studentsAffected: 0, moves: [], tileErrors: [] };
  const [accounts, apps] = await Promise.all([
    loadAccounts(service),
    loadApplications(service),
  ]);
  const maps: BillingMaps = { accounts, applications: apps.applications };
  const { changed, years, moves } = await reclassifyAll(
    service,
    { realmId, maps },
    { dryRun: opts?.dryRun }
  );
  if (opts?.dryRun)
    return { studentsAffected: changed.length, moves, tileErrors: [] };
  const tiles = await syncTilesForAllStudents(
    service,
    [...new Set([...apps.ayCodes, ...years])],
    { realmId, extraStudents: changed }
  );
  return { studentsAffected: changed.length, moves, tileErrors: tiles.errors };
}
