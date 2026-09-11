'use client';

import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { buildSectionedCsv } from '@/lib/csv';
import type { DashboardExport } from '@/lib/export/dashboard-export';

// "YYYY-MM-DD HH:mm" in Singapore time, stamped when the file is made rather
// than when the page rendered (a cached page can be minutes old).
function exportedAt(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * Downloads everything a dashboard or Insights page shows as one CSV file.
 * `data` is built on the server by the page's own export builder.
 */
export function ExportCsvButton({ data }: { data: DashboardExport }) {
  function handleExport() {
    const csv = buildSectionedCsv(
      [...data.scope, ['Exported', exportedAt()]],
      data.sections
    );
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Download className="size-3.5" />
      Export CSV
    </Button>
  );
}

/** Shown while a page's streamed data is still loading. */
export function ExportCsvButtonPending() {
  return (
    <Button variant="outline" size="sm" disabled>
      <Download className="size-3.5" />
      Export CSV
    </Button>
  );
}
