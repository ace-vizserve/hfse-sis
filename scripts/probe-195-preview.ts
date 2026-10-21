// scripts/probe-195-preview.ts
//
// What migration 195 (Registration / Fees statuses) WOULD change, per AY and
// stage: how many rows each rule touches, with the distinct values it
// touches. The rules here mirror supabase/migrations/195_registration_fees_statuses.sql
// one for one, in the same order:
//   1. "no fee" invoice text → status Not required, invoice cleared (a
//      Cancelled stage keeps its status; only the invoice is cleared)
//   2. status Finished / Paid → Paid; Unpaid / Invoiced / Re-invoiced →
//      Unpaid; Pending → Ready for invoicing (Cancelled, blank unchanged)
//   3. invoice with ONE HFSE number plus other text → just the number
//   4. invoice with no digits, a date, or TEST… → cleared (status kept)
// Values with two or more HFSE numbers are left as they are (listed).
//
// STRICTLY READ-ONLY — SELECTs only. Safe to point at production.
//
// Run:
//   npx tsx --env-file=.env.development.local scripts/probe-195-preview.ts
import { fetchAllPages } from '../lib/supabase/paginate';
import { createServiceClient } from '../lib/supabase/service';

type Row = Record<string, string | null>;

const STAGES = {
  registration: {
    status: 'registrationStatus',
    invoice: 'registrationInvoice',
  },
  fees: { status: 'feeStatus', invoice: 'feeInvoice' },
} as const;

export const NO_FEE = [
  'current student',
  'none',
  'nil',
  'n/a',
  'no enrolment fee',
  'no enrollment fee',
  'no registration fee',
  'not required',
];

const STATUS_MAP: Record<string, string> = {
  finished: 'Paid',
  paid: 'Paid',
  unpaid: 'Unpaid',
  invoiced: 'Unpaid',
  're-invoiced': 'Unpaid',
  pending: 'Ready for invoicing',
};

const HFSE_ONE = /HFSE\d+/i;
const HFSE_ALL = /HFSE\d+/gi;
const DATE_LIKE = /^\d{1,2}-[A-Za-z]{3}-\d{2}(\d{2})?$/;
const TEST = /^TEST\d*$/i;

type Rule = 'noFee' | 'noFeeCancelled' | 'status' | 'trimmed' | 'cleared';

function apply(status: string | null, invoice: string | null) {
  let s = status;
  let i = invoice;
  const hits: Array<{ rule: Rule; from: string }> = [];
  const lowS = (s ?? '').trim().toLowerCase();
  // 1
  if (i !== null && NO_FEE.includes(i.trim().toLowerCase())) {
    hits.push({
      rule: lowS === 'cancelled' ? 'noFeeCancelled' : 'noFee',
      from: i,
    });
    if (lowS !== 'cancelled') s = 'Not required';
    i = null;
  }
  // 2
  const mapped = STATUS_MAP[(s ?? '').trim().toLowerCase()];
  if (mapped && mapped !== s) {
    hits.push({ rule: 'status', from: `${s} → ${mapped}` });
    s = mapped;
  }
  // 3
  if (i !== null) {
    const all = i.match(HFSE_ALL) ?? [];
    if (all.length === 1 && !/^HFSE\d+$/i.test(i.trim())) {
      hits.push({ rule: 'trimmed', from: i });
      i = i.match(HFSE_ONE)![0];
    }
  }
  // 4
  if (i !== null && i.trim() !== '') {
    const t = i.trim();
    if (!/\d/.test(t) || TEST.test(t) || DATE_LIKE.test(t)) {
      hits.push({ rule: 'cleared', from: i });
      i = null;
    }
  }
  const several =
    invoice !== null && (invoice.match(HFSE_ALL) ?? []).length > 1;
  return { s, i, hits, several };
}

async function main() {
  const service = createServiceClient();
  console.log(`Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code');
  if (error) throw new Error(error.message);
  let total = 0;
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const table = `ay${ay_code.slice(2).toLowerCase()}_enrolment_status`;
    let rows: Row[];
    try {
      rows = await fetchAllPages<Row>(
        (from, to) =>
          service
            .from(table)
            .select(
              'id,"registrationStatus","registrationInvoice","feeStatus","feeInvoice"'
            )
            .order('id')
            .range(from, to) as unknown as PromiseLike<{
            data: Row[] | null;
            error: { message: string } | null;
          }>
      );
    } catch (e) {
      if (/PGRST205|Could not find the table/i.test(String(e))) continue;
      throw e;
    }
    console.log(`\n══ ${ay_code} — ${rows.length} rows`);
    for (const [stage, c] of Object.entries(STAGES)) {
      const count: Record<Rule, number> = {
        noFee: 0,
        noFeeCancelled: 0,
        status: 0,
        trimmed: 0,
        cleared: 0,
      };
      const values: Record<Rule, Map<string, number>> = {
        noFee: new Map(),
        noFeeCancelled: new Map(),
        status: new Map(),
        trimmed: new Map(),
        cleared: new Map(),
      };
      const several: string[] = [];
      let changedRows = 0;
      for (const r of rows) {
        const out = apply(r[c.status], r[c.invoice]);
        if (out.hits.length) changedRows++;
        for (const h of out.hits) {
          count[h.rule]++;
          values[h.rule].set(h.from, (values[h.rule].get(h.from) ?? 0) + 1);
        }
        if (out.several) several.push(JSON.stringify(r[c.invoice]));
      }
      total += changedRows;
      console.log(`  ── ${stage}: ${changedRows} rows would change`);
      const show = (m: Map<string, number>, n = 12) =>
        [...m]
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([k, v]) => `${v}× ${JSON.stringify(k)}`)
          .join('  ');
      console.log(
        `    status renamed:        ${count.status}  ${show(values.status)}`
      );
      console.log(
        `    no fee → Not required: ${count.noFee}  ${show(values.noFee)}`
      );
      console.log(
        `    no fee, Cancelled kept: ${count.noFeeCancelled}  ${show(values.noFeeCancelled)}`
      );
      console.log(
        `    trimmed to the number: ${count.trimmed}  ${show(values.trimmed)}`
      );
      console.log(
        `    junk cleared:          ${count.cleared}  ${show(values.cleared)}`
      );
      if (several.length)
        console.log(
          `    left as is (several HFSE numbers): ${several.length}  ${several.slice(0, 8).join('  ')}`
        );
    }
  }
  console.log(`\nTotal stage rows that would change: ${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
