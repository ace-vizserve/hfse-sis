// Tiny CSV helpers shared by all export endpoints.
// - toCsvValue: escape a single field per RFC 4180 (wrap in quotes if it
//   contains a comma, quote, or newline; double up internal quotes).
// - buildCsv: header row + body rows joined with \n, prefixed with a UTF-8 BOM
//   so Excel-on-Windows detects encoding correctly.

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
