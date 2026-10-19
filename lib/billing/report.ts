// A QuickBooks Reports API answer (`/reports/<Name>`) as the rows QuickBooks
// prints: its columns, its groups (Section rows, nestable) with their
// "Total for …" lines, the transaction rows inside them, and the report's own
// TOTAL line. Pure — the Billing → Reports pages render whatever comes back.

export type ReportCell = { value: string; id: string | null };

export type ReportColumn = {
  /** QuickBooks' column title as the report page shows it (may be blank,
   *  as over the customer names of a summary report). */
  title: string;
  /** Never blank: the title, else a name for the column (CSV header). */
  label: string;
  /** QuickBooks' ColKey, e.g. `tx_date`, `doc_num`, `subt_open_bal`. */
  key: string;
  kind: 'money' | 'date' | 'text';
};

export type ReportSection = {
  kind: 'section';
  /** Stable within one report: the path of section positions ("0.3"). */
  key: string;
  label: string;
  id: string | null;
  /** The header line's own cells (QuickBooks puts the group's totals there
   *  for a summary report; shown when the group is collapsed). */
  header: ReportCell[];
  children: ReportNode[];
  summary: ReportCell[] | null;
  /** Transaction rows anywhere inside the group — QuickBooks' "(n)". */
  count: number;
};

export type ReportData = { kind: 'data'; cells: ReportCell[] };
export type ReportNode = ReportSection | ReportData;

export type ParsedReport = {
  reportName: string;
  startPeriod: string | null;
  endPeriod: string | null;
  /** The `report_date` option QuickBooks echoes for an "as of" report. */
  reportDate: string | null;
  basis: string | null;
  columns: ReportColumn[];
  rows: ReportNode[];
  /** The report's TOTAL line, when it has one. */
  total: ReportCell[] | null;
  noData: boolean;
};

type RawCol = { value?: string; id?: string };
type RawRow = {
  type?: string;
  group?: string;
  ColData?: RawCol[];
  Header?: { ColData?: RawCol[] };
  Rows?: { Row?: RawRow[] };
  Summary?: { ColData?: RawCol[] };
};
type RawColumn = {
  ColTitle?: string;
  ColType?: string;
  MetaData?: Array<{ Name?: string; Value?: string }>;
};

const MONEY_KEY =
  /(^subt_|^rbal_|amount|_bal$|^total$|^current$|^\d+$|income|expense)/;

/** QuickBooks' page titles are sentence case ("Due date", "Open balance");
 *  the API sends "Due Date", "Open Balance", and "Terms" for the page's
 *  "Term". Bucket titles ("1 - 30") pass through. */
export function columnTitle(raw: string): string {
  const t = raw.trim();
  if (t === 'Terms') return 'Term';
  if (!t) return '';
  return t
    .split(/(\s+|\/)/)
    .map((w, i) => (i === 0 ? w : w.toLowerCase()))
    .join('');
}

function readColumn(c: RawColumn): ReportColumn {
  const key = c.MetaData?.find((m) => m.Name === 'ColKey')?.Value?.trim() ?? '';
  const type = (c.ColType ?? '').trim();
  const title = columnTitle(c.ColTitle ?? '');
  const kind: ReportColumn['kind'] =
    type === 'Money' || (!type && MONEY_KEY.test(key))
      ? 'money'
      : type === 'Date' || /date$/.test(key)
        ? 'date'
        : 'text';
  return {
    title,
    label: title || type || (key ? columnTitle(key.replace(/_/g, ' ')) : ''),
    key,
    kind,
  };
}

const cells = (cols: RawCol[] | undefined, width: number): ReportCell[] =>
  Array.from({ length: width }, (_, i) => {
    const c = cols?.[i];
    const id = (c?.id ?? '').trim();
    return { value: (c?.value ?? '').trim(), id: id || null };
  });

/** "Total Freeman Sporting Goods" (summary reports) reads as QuickBooks'
 *  page prints it: "Total for Freeman Sporting Goods". */
function summaryLabel(s: string): string {
  if (/^total$/i.test(s) || /^total for /i.test(s)) return s;
  return s.replace(/^Total /, 'Total for ');
}

export function parseReport(json: unknown): ParsedReport {
  const j = (json ?? {}) as {
    Header?: {
      ReportName?: string;
      StartPeriod?: string;
      EndPeriod?: string;
      ReportBasis?: string;
      Option?: Array<{ Name?: string; Value?: string }>;
    };
    Columns?: { Column?: RawColumn[] };
    Rows?: { Row?: RawRow[] };
  };
  const columns = (j.Columns?.Column ?? []).map(readColumn);
  const width = columns.length;
  const opt = (n: string) =>
    j.Header?.Option?.find((o) => o.Name === n)?.Value ?? null;
  let total: ReportCell[] | null = null;

  const walk = (list: RawRow[], path: string): ReportNode[] => {
    const out: ReportNode[] = [];
    list.forEach((r, i) => {
      const hasHeader = !!r.Header?.ColData?.length;
      const hasRows = !!r.Rows?.Row?.length;
      const summary = r.Summary?.ColData?.length
        ? cells(r.Summary.ColData, width)
        : null;
      if (!hasHeader && !hasRows && summary) {
        // The report's own TOTAL line (top level, nothing above it).
        if (
          path === '' &&
          (r.group === 'GrandTotal' || /^total$/i.test(summary[0]?.value ?? ''))
        ) {
          total = summary;
          return;
        }
      }
      if (hasHeader || hasRows || summary) {
        const key = path ? `${path}.${i}` : String(i);
        const header = cells(r.Header?.ColData, width);
        const children = walk(r.Rows?.Row ?? [], key);
        const count = children.reduce(
          (n, c) => n + (c.kind === 'data' ? 1 : c.count),
          0
        );
        if (summary && summary[0])
          summary[0] = { ...summary[0], value: summaryLabel(summary[0].value) };
        out.push({
          kind: 'section',
          key,
          label: header[0]?.value ?? '',
          id: header[0]?.id ?? null,
          header,
          children,
          summary,
          count,
        });
        return;
      }
      if (r.ColData?.length) {
        const row = cells(r.ColData, width);
        if (path === '' && /^total$/i.test(row[0]?.value ?? '')) {
          total = row;
          return;
        }
        out.push({ kind: 'data', cells: row });
      }
    });
    return out;
  };

  const rows = walk(j.Rows?.Row ?? [], '');
  return {
    reportName: j.Header?.ReportName ?? '',
    startPeriod: j.Header?.StartPeriod ?? null,
    endPeriod: j.Header?.EndPeriod ?? null,
    reportDate: opt('report_date'),
    basis: j.Header?.ReportBasis ?? null,
    columns,
    rows,
    total,
    noData: opt('NoReportData') === 'true' || (rows.length === 0 && !total),
  };
}

/** One printed line of the report, in order. */
export type ReportLine =
  | {
      kind: 'header';
      depth: number;
      section: ReportSection;
      collapsed: boolean;
    }
  | {
      kind: 'data';
      depth: number;
      cells: ReportCell[];
      section: ReportSection | null;
    }
  | {
      kind: 'summary';
      depth: number;
      cells: ReportCell[];
      section: ReportSection;
    }
  | { kind: 'total'; depth: 0; cells: ReportCell[] };

/** The lines as QuickBooks prints them: a group's header, its rows, its
 *  "Total for …" line; a collapsed group is its header alone. */
export function reportLines(
  report: Pick<ParsedReport, 'rows' | 'total'>,
  collapsed: ReadonlySet<string> = new Set()
): ReportLine[] {
  const out: ReportLine[] = [];
  const walk = (
    nodes: ReportNode[],
    depth: number,
    parent: ReportSection | null
  ) => {
    for (const n of nodes) {
      if (n.kind === 'data') {
        out.push({ kind: 'data', depth, cells: n.cells, section: parent });
        continue;
      }
      const shut = collapsed.has(n.key);
      out.push({ kind: 'header', depth, section: n, collapsed: shut });
      if (shut) continue;
      walk(n.children, depth + 1, n);
      if (n.summary)
        out.push({
          kind: 'summary',
          depth: depth + 1,
          cells: n.summary,
          section: n,
        });
    }
  };
  walk(report.rows, 0, null);
  if (report.total) out.push({ kind: 'total', depth: 0, cells: report.total });
  return out;
}

/** Every group's key — for "collapse all". */
export function sectionKeys(nodes: ReportNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes)
    if (n.kind === 'section') out.push(n.key, ...sectionKeys(n.children));
  return out;
}

/** A money cell as QuickBooks prints it: "1,020.00", "-60.00", blank stays
 *  blank. Anything that is not a number passes through. */
export function formatReportMoney(v: string): string {
  if (!v) return '';
  const n = Number(v.replace(/,/g, ''));
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** The report as CSV: QuickBooks' column titles, then every line (groups
 *  expanded), group labels and "Total for …" lines included. Money stays a
 *  plain number so a spreadsheet can add it up. */
export function reportCsv(
  report: Pick<ParsedReport, 'columns' | 'rows' | 'total'>
): string {
  const esc = (s: string) =>
    /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const rows: string[][] = [report.columns.map((c) => c.label)];
  for (const l of reportLines(report)) {
    const indent = '  '.repeat(l.depth);
    if (l.kind === 'header') {
      const s = l.section;
      rows.push(
        report.columns.map((_, i) =>
          i === 0 ? `${indent}${s.label}${s.count ? ` (${s.count})` : ''}` : ''
        )
      );
      continue;
    }
    rows.push(
      l.cells.map((c, i) => {
        const col = report.columns[i];
        const v =
          col?.kind === 'money' && c.value
            ? (() => {
                const n = Number(c.value.replace(/,/g, ''));
                return Number.isFinite(n) ? n.toFixed(2) : c.value;
              })()
            : c.value;
        return i === 0 ? `${indent}${v}` : v;
      })
    );
  }
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/** Where a report row names its QuickBooks customer: the first column
 *  (summary reports), the group it sits in (reports grouped by customer),
 *  a Customer column (`cust_name`), or nowhere. */
export type CustomerSource = 'firstColumn' | 'section' | 'column' | 'none';

/** The QuickBooks customer a line belongs to, when the report says. */
export function lineCustomerId(
  line: ReportLine,
  columns: ReportColumn[],
  source: CustomerSource
): string | null {
  if (source === 'none' || line.kind === 'total' || line.kind === 'summary')
    return null;
  if (line.kind === 'header')
    return source === 'firstColumn' || source === 'section'
      ? line.section.id
      : null;
  if (source === 'firstColumn') return line.cells[0]?.id ?? null;
  if (source === 'section') return line.section?.id ?? null;
  const i = columns.findIndex((c) => c.key === 'cust_name');
  return i >= 0 ? (line.cells[i]?.id ?? null) : null;
}

/** The QuickBooks invoice a data line is, when it is one: the id QuickBooks
 *  puts on the Transaction type cell. */
export function lineInvoiceId(
  line: ReportLine,
  columns: ReportColumn[]
): string | null {
  if (line.kind !== 'data') return null;
  const i = columns.findIndex((c) => c.key === 'txn_type');
  const c = i >= 0 ? line.cells[i] : null;
  return c && c.value === 'Invoice' && c.id ? c.id : null;
}
