// QuickBooks' own A/R Aging Summary report (`/reports/AgedReceivables`),
// read for the Customers list and the customer page so "Overdue" is the
// figure QuickBooks shows, not one the SIS adds up. Pure parser.

export type AgingRow = {
  customerId: string | null;
  name: string;
  current: number;
  overdue: number;
  total: number;
};

type Col = { value?: string; id?: string };
type Row = { ColData?: Col[]; Rows?: { Row?: Row[] } };

const num = (v: string | undefined) => {
  const n = Number((v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export function parseAgedReceivables(json: unknown): AgingRow[] {
  const j = (json ?? {}) as {
    Columns?: { Column?: Array<{ ColTitle?: string }> };
    Rows?: { Row?: Row[] };
  };
  const titles = (j.Columns?.Column ?? []).map((c) =>
    (c.ColTitle ?? '').trim()
  );
  const iCurrent = titles.indexOf('Current');
  const iTotal = titles.indexOf('Total');
  if (iCurrent < 0 || iTotal < 0) return [];
  const out: AgingRow[] = [];
  const walk = (rows: Row[]) => {
    for (const r of rows) {
      if (r.ColData?.length) {
        const name = (r.ColData[0]?.value ?? '').trim();
        if (!name || name.toUpperCase() === 'TOTAL') continue;
        let overdue = 0;
        for (let i = iCurrent + 1; i < iTotal; i++)
          overdue += num(r.ColData[i]?.value);
        out.push({
          customerId: r.ColData[0]?.id ?? null,
          name,
          current: r2(num(r.ColData[iCurrent]?.value)),
          overdue: r2(overdue),
          total: r2(num(r.ColData[iTotal]?.value)),
        });
      }
      if (r.Rows?.Row) walk(r.Rows.Row);
    }
  };
  walk(j.Rows?.Row ?? []);
  return out;
}

/** The same report with every bucket QuickBooks prints, for the A/R aging
 *  page: the bucket titles between the name and Total ("Current", "1 - 30",
 *  …, "91 and over"), each customer's amount per bucket, and the report's
 *  own Total row. */
export type AgingReport = {
  buckets: string[];
  rows: Array<{
    customerId: string | null;
    name: string;
    amounts: number[];
    total: number;
  }>;
  totals: { amounts: number[]; total: number } | null;
};

export function parseAgingReport(json: unknown): AgingReport {
  const j = (json ?? {}) as {
    Columns?: { Column?: Array<{ ColTitle?: string }> };
    Rows?: { Row?: Row[] };
  };
  const titles = (j.Columns?.Column ?? []).map((c) =>
    (c.ColTitle ?? '').trim()
  );
  const iTotal = titles.indexOf('Total');
  if (iTotal < 1) return { buckets: [], rows: [], totals: null };
  const buckets = titles.slice(1, iTotal);
  const rows: AgingReport['rows'] = [];
  let totals: AgingReport['totals'] = null;
  const read = (cols: Col[]) => ({
    amounts: buckets.map((_, k) => r2(num(cols[k + 1]?.value))),
    total: r2(num(cols[iTotal]?.value)),
  });
  const walk = (list: Row[]) => {
    for (const r of list) {
      if (r.ColData?.length) {
        const name = (r.ColData[0]?.value ?? '').trim();
        if (name.toUpperCase() === 'TOTAL') totals = read(r.ColData);
        else if (name)
          rows.push({
            customerId: r.ColData[0]?.id ?? null,
            name,
            ...read(r.ColData),
          });
      }
      if (r.Rows?.Row) walk(r.Rows.Row);
      const s = (r as { Summary?: { ColData?: Col[] } }).Summary?.ColData;
      if (s?.length && (s[0]?.value ?? '').trim().toUpperCase() === 'TOTAL')
        totals = read(s);
    }
  };
  walk(j.Rows?.Row ?? []);
  return { buckets, rows, totals };
}
