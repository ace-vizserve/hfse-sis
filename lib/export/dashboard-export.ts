// The serialisable shape a dashboard or Insights page hands to
// <ExportCsvButton>. Built on the server by a pure per-page builder from the
// data the page already loaded, so the file always matches the screen.

export type ExportCell = string | number | null;

/** One `label, value` line at the top of the file. */
export type ExportScopeLine = [string, string];

export type ExportSection = {
  title: string;
  headers: string[];
  rows: ExportCell[][];
};

export type DashboardExport = {
  filename: string;
  scope: ExportScopeLine[];
  sections: ExportSection[];
};

export type KpiRow = {
  label: string;
  current: ExportCell;
  previous?: ExportCell;
  change?: ExportCell;
};

export function kpiSection(rows: KpiRow[]): ExportSection {
  return {
    title: 'Key figures',
    headers: ['Figure', 'This period', 'Previous period', 'Change'],
    rows: rows.map((r) => [
      r.label,
      r.current,
      r.previous ?? null,
      r.change ?? null,
    ]),
  };
}

export function roundTo(
  value: number | null | undefined,
  decimals: number
): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function dashboardFilename(input: {
  module: string;
  ayCode: string;
  from?: string | null;
  to?: string | null;
}): string {
  const range = input.from && input.to ? `-${input.from}_to_${input.to}` : '';
  return `${input.module}-dashboard-${input.ayCode}${range}.csv`;
}

export function insightsFilename(input: {
  module: string;
  ayCode: string;
  compareAy?: string | null;
}): string {
  const vs = input.compareAy ? `-vs-${input.compareAy}` : '';
  return `${input.module}-insights-${input.ayCode}${vs}.csv`;
}
