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
  QboNotConnectedError,
} from '@/lib/qbo/client';

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
  depositAccounts: Array<{ id: string; label: string; sort: number }>;
};

function must<T>(
  r: { data: T | null; error: { message: string } | null },
  what: string
): T {
  if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
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
  try {
    const banks = await qboQueryAll<{ Id: string; Name: string }>(
      service,
      'Account',
      "AccountType IN ('Bank', 'Other Current Asset', 'Credit Card')"
    );
    depositChoices = banks.map((b) => ({ id: b.Id, name: b.Name }));
  } catch {
    // Not connected: the page shows the saved list only.
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
    depositAccounts: must(dep, 'Payment accounts lookup').map(
      (r: { qbo_account_id: string; label: string; sort: number }) => ({
        id: r.qbo_account_id,
        label: r.label,
        sort: r.sort,
      })
    ),
  };
}

export async function reclassifyAll(
  service: SupabaseClient
): Promise<{ changed: string[] }> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return { changed: [] };
  const maps = await loadBillingMaps(service);
  const changed = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service
      .from('qbo_invoices')
      .select('id, student_number, txn_date, lines, ay_code, stage_keys')
      .eq('realm_id', realmId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{
      id: string;
      student_number: string;
      txn_date: string | null;
      lines: InvoiceLine[];
      ay_code: string | null;
      stage_keys: string[];
    }>) {
      const c = classifyInvoice(r.lines ?? [], r.txn_date, maps);
      if (
        c.ayCode === r.ay_code &&
        c.stageKeys.join(',') === (r.stage_keys ?? []).join(',')
      )
        continue;
      const up = await service
        .from('qbo_invoices')
        .update({ ay_code: c.ayCode, stage_keys: c.stageKeys })
        .eq('id', r.id);
      if (up.error)
        throw new Error(`Invoice update failed: ${up.error.message}`);
      changed.add(r.student_number);
    }
    if (!data || data.length < 1000) break;
  }
  return { changed: [...changed] };
}
