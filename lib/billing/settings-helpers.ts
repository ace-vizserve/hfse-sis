// Pure helpers for the billing settings routes.

/** The first value that appears twice, or null. */
export function firstDuplicate(keys: string[]): string | null {
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) return k;
    seen.add(k);
  }
  return null;
}

/** True when `s` is a real calendar date written YYYY-MM-DD. */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type InvoiceChange = {
  id: string;
  ayCode: string | null;
  stageKeys: string[];
};

/** Group changed invoices by identical (ay_code, stage_keys), ids in chunks. */
export function groupChanges(
  changes: InvoiceChange[],
  chunk = 200
): Array<{ ayCode: string | null; stageKeys: string[]; ids: string[] }> {
  const groups = new Map<
    string,
    { ayCode: string | null; stageKeys: string[]; ids: string[] }
  >();
  for (const c of changes) {
    const k = `${c.ayCode ?? ''}|${c.stageKeys.join(',')}`;
    const g = groups.get(k) ?? {
      ayCode: c.ayCode,
      stageKeys: c.stageKeys,
      ids: [],
    };
    g.ids.push(c.id);
    groups.set(k, g);
  }
  const out: Array<{
    ayCode: string | null;
    stageKeys: string[];
    ids: string[];
  }> = [];
  for (const g of groups.values())
    for (let i = 0; i < g.ids.length; i += chunk)
      out.push({ ...g, ids: g.ids.slice(i, i + chunk) });
  return out;
}
