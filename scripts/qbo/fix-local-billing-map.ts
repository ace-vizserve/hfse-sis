/**
 * Puts the LOCAL Billing mapping in HFSE's real shape (production sales
 * report, 2026-10-15): Registration = the Admissions & Registration account,
 * Fees = the Enrolment Fees accounts, and nothing else — Student Devt Fees is
 * billed in separate instalments and must NOT fill the Fees tile. Then
 * re-reads every linked student's QuickBooks history so the stored invoices
 * and the tiles follow.
 *
 *   npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/fix-local-billing-map.ts
 *
 * Refuses to run unless Supabase is the local stack and QuickBooks is a sandbox.
 */
import { loadCustomerHistory } from '@/lib/billing/history.server';
import {
  refreshItems,
  sweepAfterSettingsSave,
} from '@/lib/billing/settings.server';
import { createServiceClient } from '@/lib/supabase/service';

const service = createServiceClient();

async function main() {
  if (
    !/localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  )
    throw new Error('Refusing: Supabase is not the local stack.');
  const { data: conn } = await service
    .from('qbo_connection')
    .select('environment')
    .eq('id', 1)
    .maybeSingle();
  if (conn?.environment !== 'sandbox')
    throw new Error('Refusing: the SIS is not connected to a sandbox company.');

  console.log('Items:', await refreshItems(service));
  const { data: items, error } = await service
    .from('qbo_items')
    .select('income_account_id, income_account_name')
    .not('income_account_id', 'is', null);
  if (error) throw new Error(error.message);
  const accounts = new Map<string, string>();
  for (const r of items ?? [])
    accounts.set(
      r.income_account_id as string,
      (r.income_account_name as string) ?? ''
    );
  const stageFor = (name: string) =>
    /Admissions & Registration$/.test(name)
      ? 'registration'
      : /Enrolment Fees/.test(name)
        ? 'fees'
        : 'none';
  const rows = [...accounts].map(([id, name]) => ({
    qbo_account_id: id,
    account_name: name,
    stage: stageFor(name),
  }));
  const up = await service
    .from('billing_account_map')
    .upsert(rows, { onConflict: 'qbo_account_id' });
  if (up.error) throw new Error(up.error.message);
  for (const r of rows)
    console.log(`  ${r.stage.padEnd(12)} ${r.account_name}`);

  const del = await service
    .from('billing_item_map')
    .delete()
    .ilike('item_name', '%Student Devt%')
    .select('item_name');
  if (del.error) throw new Error(del.error.message);
  console.log(
    'Item overrides removed:',
    (del.data ?? []).map((r) => r.item_name)
  );

  const sweep = await sweepAfterSettingsSave(service);
  console.log('Sweep:', sweep);

  const { data: linked, error: lErr } = await service
    .from('qbo_customers')
    .select('student_number');
  if (lErr) throw new Error(lErr.message);
  for (const { student_number } of linked ?? []) {
    const r = await loadCustomerHistory(service, student_number as string);
    console.log(
      `  ${student_number}: ${r.invoices} invoices, ${r.payments} payments, ${r.tilesChanged} tiles changed${r.errors.length ? ` — ${r.errors.join('; ')}` : ''}`
    );
  }

  // The check: SDF instalments must sit on no tile; Fees invoices on Fees.
  const { data: inv, error: iErr } = await service
    .from('qbo_invoices')
    .select('doc_number, memo, stage_keys');
  if (iErr) throw new Error(iErr.message);
  const rows2 = (inv ?? []) as Array<{
    doc_number: string | null;
    memo: string | null;
    stage_keys: string[];
  }>;
  const sdfOnTile = rows2.filter(
    (r) =>
      (r.memo ?? '').startsWith('SDF instalment') && r.stage_keys.length > 0
  );
  const fees = rows2.filter((r) => r.stage_keys.includes('fees')).length;
  console.log(
    `Fees invoices: ${fees}. SDF instalments on a tile: ${sdfOnTile.length}.`
  );
  if (sdfOnTile.length)
    throw new Error(
      `SDF still fills a tile: ${sdfOnTile.map((r) => r.doc_number).join(', ')}`
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
