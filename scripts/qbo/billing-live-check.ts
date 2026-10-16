/**
 * Reads, from the SANDBOX, everything the Billing pages read live — one
 * linked student's customer profile, the A/R aging (theirs and everyone's),
 * and their newest invoice in full — and prints it. A check, writes nothing.
 *
 *   npx tsx --conditions=react-server --env-file=.env.development.local scripts/qbo/billing-live-check.ts [studentNumber]
 */
import {
  readAging,
  readCustomerProfile,
  readInvoiceDetail,
} from '@/lib/billing/live.server';
import { createServiceClient } from '@/lib/supabase/service';

const service = createServiceClient();

async function main() {
  if (
    !/localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  )
    throw new Error('Refusing: Supabase is not the local stack.');
  const wanted = process.argv[2];
  const q = service
    .from('qbo_customers')
    .select('student_number, qbo_customer_id, display_name')
    .limit(1);
  const { data: links, error } = wanted
    ? await q.eq('student_number', wanted)
    : await q;
  if (error) throw new Error(error.message);
  const link = links?.[0];
  if (!link) throw new Error('No linked student.');
  console.log('Student', link.student_number, link.display_name);
  const profile = await readCustomerProfile(service, link.qbo_customer_id);
  console.log('Profile', profile);
  const mine = await readAging(service, { customerId: link.qbo_customer_id });
  const all = await readAging(service);
  console.log('Aging (theirs)', mine);
  console.log(
    `Aging (all): ${all.length} rows, ${all.filter((r) => r.customerId).length} carry a customer id`
  );
  const { data: inv } = await service
    .from('qbo_invoices')
    .select('qbo_invoice_id, doc_number')
    .eq('qbo_customer_id', link.qbo_customer_id)
    .order('txn_date', { ascending: false })
    .limit(1);
  if (inv?.[0])
    console.log(
      'Invoice',
      await readInvoiceDetail(service, inv[0].qbo_invoice_id)
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
