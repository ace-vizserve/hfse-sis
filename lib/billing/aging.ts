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
