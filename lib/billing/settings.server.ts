import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  classifyInvoice,
  type BillingMaps,
  type InvoiceLine,
  type StageChoice,
} from '@/lib/billing/classify';
import {
  connectedRealmId,
  qboQueryAll,
  qboErrorMessage,
  QboNotConnectedError,
} from '@/lib/qbo/client';
import {
  groupChanges,
  summarizeMoves,
  tilesSweepBlocker,
  yearAfterReclassify,
  type InvoiceChange,
  type Move,
  type MovePreview,
} from '@/lib/billing/settings-helpers';
import { syncTilesForAllStudents } from '@/lib/billing/tiles.server';

export type BillingSettings = {
  accounts: Array<{
    id: string;
    name: string;
    stage: StageChoice | null;
    itemCount: number;
  }>;
  items: Array<{
    id: string;
    name: string;
    accountId: string | null;
    accountName: string | null;
    stage: StageChoice | null;
  }>;
  ranges: Array<{ ayCode: string; startsOn: string; endsOn: string }>;
  depositChoices: Array<{ id: string; name: string }>;
  depositChoicesError: string | null;
  depositAccounts: Array<{ id: string; label: string; sort: number }>;
};

function must<T>(
  r: { data: T | null; error: { message: string } | null },
  what: string
): T {
  if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

/**
 * Replace a settings table's contents without ever leaving it empty on
 * failure: upsert the new rows first, then delete the keys no longer listed.
 * A failed upsert leaves the old settings untouched.
 */
export async function replaceRows(
  service: SupabaseClient,
  table: string,
  key: string,
  rows: Array<Record<string, unknown>>
): Promise<void> {
  if (rows.length) {
    const up = await service.from(table).upsert(rows, { onConflict: key });
    if (up.error) throw new Error(up.error.message);
  }
  if (!rows.length) {
    const del = await service.from(table).delete().neq(key, '');
    if (del.error) throw new Error(del.error.message);
    return;
  }
  const keep = new Set(rows.map((r) => String(r[key])));
  const existing = await service.from(table).select(key);
  if (existing.error) throw new Error(existing.error.message);
  const stale = (existing.data as unknown as Array<Record<string, string>>)
    .map((r) => r[key])
    .filter((k) => !keep.has(k));
  for (let i = 0; i < stale.length; i += 200) {
    const del = await service
      .from(table)
      .delete()
      .in(key, stale.slice(i, i + 200));
    if (del.error) throw new Error(del.error.message);
  }
}

export async function loadBillingMaps(
  service: SupabaseClient
): Promise<BillingMaps> {
  const [a, i, y] = await Promise.all([
    service.from('billing_account_map').select('qbo_account_id, stage'),
    service.from('billing_item_map').select('qbo_item_id, stage'),
    service.from('billing_year_ranges').select('ay_code, starts_on, ends_on'),
  ]);
  return {
    accounts: new Map(
      must(a, 'Account mapping lookup').map(
        (r: { qbo_account_id: string; stage: StageChoice }) => [
          r.qbo_account_id,
          r.stage,
        ]
      )
    ),
    items: new Map(
      must(i, 'Item mapping lookup').map(
        (r: { qbo_item_id: string; stage: StageChoice }) => [
          r.qbo_item_id,
          r.stage,
        ]
      )
    ),
    ranges: must(y, 'Year ranges lookup').map(
      (r: { ay_code: string; starts_on: string; ends_on: string }) => ({
        ayCode: r.ay_code,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
      })
    ),
  };
}

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

export async function loadSettings(
  service: SupabaseClient
): Promise<BillingSettings> {
  const [items, am, im, y, dep] = await Promise.all([
    service
      .from('qbo_items')
      .select('qbo_item_id, name, income_account_id, income_account_name')
      .order('name'),
    service.from('billing_account_map').select('qbo_account_id, stage'),
    service.from('billing_item_map').select('qbo_item_id, stage'),
    service
      .from('billing_year_ranges')
      .select('ay_code, starts_on, ends_on')
      .order('ay_code'),
    service
      .from('billing_deposit_accounts')
      .select('qbo_account_id, label, sort')
      .order('sort'),
  ]);
  const accStage = new Map(
    must(am, 'Account mapping lookup').map(
      (r: { qbo_account_id: string; stage: StageChoice }) => [
        r.qbo_account_id,
        r.stage,
      ]
    )
  );
  const itemStage = new Map(
    must(im, 'Item mapping lookup').map(
      (r: { qbo_item_id: string; stage: StageChoice }) => [
        r.qbo_item_id,
        r.stage,
      ]
    )
  );
  const itemRows = must(items, 'Items lookup') as Array<{
    qbo_item_id: string;
    name: string;
    income_account_id: string | null;
    income_account_name: string | null;
  }>;
  const accounts = new Map<
    string,
    { id: string; name: string; stage: StageChoice | null; itemCount: number }
  >();
  for (const it of itemRows) {
    if (!it.income_account_id) continue;
    const prev = accounts.get(it.income_account_id);
    accounts.set(it.income_account_id, {
      id: it.income_account_id,
      name: it.income_account_name ?? it.income_account_id,
      stage: accStage.get(it.income_account_id) ?? null,
      itemCount: (prev?.itemCount ?? 0) + 1,
    });
  }
  let depositChoices: Array<{ id: string; name: string }> = [];
  let depositChoicesError: string | null = null;
  try {
    const banks = await qboQueryAll<{ Id: string; Name: string }>(
      service,
      'Account',
      "AccountType IN ('Bank', 'Other Current Asset', 'Credit Card')"
    );
    depositChoices = banks.map((b) => ({ id: b.Id, name: b.Name }));
  } catch (e) {
    // Not connected: the page shows the saved list only. Anything else is
    // reported so the page can say why the choices are missing.
    if (!(e instanceof QboNotConnectedError))
      depositChoicesError = qboErrorMessage(e);
  }
  return {
    accounts: [...accounts.values()].sort((x, z) =>
      x.name.localeCompare(z.name)
    ),
    items: itemRows.map((it) => ({
      id: it.qbo_item_id,
      name: it.name,
      accountId: it.income_account_id,
      accountName: it.income_account_name,
      stage: itemStage.get(it.qbo_item_id) ?? null,
    })),
    ranges: must(y, 'Year ranges lookup').map(
      (r: { ay_code: string; starts_on: string; ends_on: string }) => ({
        ayCode: r.ay_code,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
      })
    ),
    depositChoices,
    depositChoicesError,
    depositAccounts: must(dep, 'Payment accounts lookup').map(
      (r: { qbo_account_id: string; label: string; sort: number }) => ({
        id: r.qbo_account_id,
        label: r.label,
        sort: r.sort,
      })
    ),
  };
}

type Moved = Move & { id: string };

/**
 * Every stored invoice whose year or tiles change under `maps`, a page at a
 * time. Shared by reclassifyAll (which writes them) and previewReclassify
 * (which only counts them), so the preview is exactly what a save does.
 */
async function* reclassifyMoves(
  service: SupabaseClient,
  realmId: string,
  maps: BillingMaps
): AsyncGenerator<Moved[]> {
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service
      .from('qbo_invoices')
      .select(
        'id, student_number, txn_date, lines, ay_code, stage_keys, enrolee_number'
      )
      .eq('realm_id', realmId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
    const page: Moved[] = [];
    for (const r of (data ?? []) as Array<{
      id: string;
      student_number: string;
      txn_date: string | null;
      lines: InvoiceLine[];
      ay_code: string | null;
      stage_keys: string[];
      enrolee_number: string | null;
    }>) {
      const c = classifyInvoice(r.lines ?? [], r.txn_date, maps);
      // A KD #231 row keeps its year; its stage keys still follow the mapping.
      const ayCode = yearAfterReclassify(r.enrolee_number, r.ay_code, c.ayCode);
      if (
        ayCode === r.ay_code &&
        c.stageKeys.join(',') === (r.stage_keys ?? []).join(',')
      )
        continue;
      page.push({
        id: r.id,
        studentNumber: r.student_number,
        fromAy: r.ay_code,
        fromStages: r.stage_keys ?? [],
        toAy: ayCode,
        toStages: c.stageKeys,
      });
    }
    yield page;
    if (!data || data.length < 1000) return;
  }
}

/**
 * Re-applies the mapping and year ranges to every stored invoice. Returns the
 * students whose invoices moved and every year they moved from or to.
 */
export async function reclassifyAll(
  service: SupabaseClient,
  preloaded?: { realmId: string; maps: BillingMaps }
): Promise<{ changed: string[]; years: string[] }> {
  const realmId = preloaded?.realmId ?? (await connectedRealmId(service));
  if (!realmId) return { changed: [], years: [] };
  const maps = preloaded?.maps ?? (await loadBillingMaps(service));
  const changed = new Set<string>();
  const years = new Set<string>();
  for await (const page of reclassifyMoves(service, realmId, maps)) {
    const pending: InvoiceChange[] = page.map((m) => ({
      id: m.id,
      ayCode: m.toAy,
      stageKeys: m.toStages,
    }));
    for (const m of page) {
      changed.add(m.studentNumber);
      if (m.fromAy) years.add(m.fromAy);
      if (m.toAy) years.add(m.toAy);
    }
    for (const g of groupChanges(pending)) {
      const up = await service
        .from('qbo_invoices')
        .update({ ay_code: g.ayCode, stage_keys: g.stageKeys })
        .in('id', g.ids);
      if (up.error)
        throw new Error(`Invoice update failed: ${up.error.message}`);
    }
  }
  return { changed: [...changed], years: [...years] };
}

/** What saving `maps` would move, without saving anything. */
export async function previewReclassify(
  service: SupabaseClient,
  maps: BillingMaps
): Promise<MovePreview> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return summarizeMoves([]);
  const all: Move[] = [];
  for await (const page of reclassifyMoves(service, realmId, maps))
    all.push(...page);
  return summarizeMoves(all);
}

/**
 * After the mapping or the year ranges are saved: re-apply them to every
 * stored invoice, then recompute the tiles of the students whose invoices
 * moved plus every student with an invoice on a tile, for every year in the
 * ranges and every year an invoice moved from. While no year range or no
 * Registration / Fees mapping exists, the tiles are not touched.
 */
export async function sweepAfterSettingsSave(service: SupabaseClient): Promise<{
  studentsAffected: number;
  tilesSkipped?: string;
  tileErrors: string[];
}> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return { studentsAffected: 0, tileErrors: [] };
  const maps = await loadBillingMaps(service);
  const { changed, years } = await reclassifyAll(service, { realmId, maps });
  const blocker = tilesSweepBlocker(maps);
  if (blocker)
    return {
      studentsAffected: changed.length,
      tilesSkipped: blocker,
      tileErrors: [],
    };
  const tiles = await syncTilesForAllStudents(
    service,
    [...new Set([...maps.ranges.map((r) => r.ayCode), ...years])],
    { realmId, extraStudents: changed }
  );
  return { studentsAffected: changed.length, tileErrors: tiles.errors };
}
