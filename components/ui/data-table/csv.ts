import { reportBrowserExport } from '@/lib/audit/report-browser-export';

type CsvColumn<TRow> = {
  header: string;
  accessor: (row: TRow) => string | number | null;
};

export function exportCsv<TRow>(
  rows: TRow[],
  columns: Array<CsvColumn<TRow>>,
  filename: string
) {
  const escape = (cell: string | number | null) => {
    if (cell === null || cell === undefined) return '';
    const s = String(cell);
    if (s.includes('"') || s.includes(',') || s.includes('\n'))
      return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map((c) => escape(c.header)).join(',');
  const body = rows
    .map((r) => columns.map((c) => escape(c.accessor(r))).join(','))
    .join('\n');
  const csv = '﻿' + header + '\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  reportBrowserExport(filename, rows.length);
}
