// Tiny CSV helpers shared by all export endpoints.
// - toCsvValue: escape a single field per RFC 4180 (wrap in quotes if it
//   contains a comma, quote, or newline; double up internal quotes).
// - buildCsv: header row + body rows joined with \n, prefixed with a UTF-8 BOM
//   so Excel-on-Windows detects encoding correctly.
// - buildSectionedCsv: several tables in one CSV file with scope lines and sections.

import type {
  ExportScopeLine,
  ExportSection,
} from '@/lib/export/dashboard-export';

const UTF8_BOM = '\uFEFF';

export function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build an RFC 4180-compliant CSV string from headers + rows.
 *
 * Prepends a UTF-8 BOM so Excel-on-Windows detects encoding correctly
 * (without it, names with é / ü / Chinese / Tamil render as mojibake).
 */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const head = headers.map(toCsvValue).join(',');
  const body = rows.map((r) => r.map(toCsvValue).join(','));
  return UTF8_BOM + [head, ...body].join('\n');
}

/**
 * Several tables in one CSV file: scope lines first, then each section as
 * title row, header row and data rows, with a blank line before each section.
 * CRLF line endings and a UTF-8 BOM so Excel on Windows opens it cleanly.
 */
export function buildSectionedCsv(
  scope: ExportScopeLine[],
  sections: ExportSection[]
): string {
  const lines: string[] = scope.map((pair) => pair.map(toCsvValue).join(','));
  sections.forEach((section, i) => {
    if (lines.length > 0 || i > 0) lines.push('');
    lines.push(toCsvValue(section.title));
    lines.push(section.headers.map(toCsvValue).join(','));
    for (const row of section.rows) lines.push(row.map(toCsvValue).join(','));
  });
  return UTF8_BOM + lines.join('\r\n');
}
