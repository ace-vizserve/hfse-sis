// Pure helpers for the billing settings routes.

import type { BillingMaps } from '@/lib/billing/classify';

export const TILES_SKIPPED_MESSAGE =
  'Set at least one year range and one Registration or Fees mapping before tiles are filled.';

/**
 * Why saving the settings must not recompute the tiles yet, or null. With no
 * year range, or nothing mapped to Registration or Fees, every invoice would
 * fall off its tile.
 */
export function tilesSweepBlocker(maps: BillingMaps): string | null {
  const mapsAStage = [...maps.accounts.values(), ...maps.items.values()].some(
    (s) => s === 'registration' || s === 'fees'
  );
  return maps.ranges.length === 0 || !mapsAStage ? TILES_SKIPPED_MESSAGE : null;
}

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

/**
 * The year a stored invoice keeps after re-classifying. A row the KD #231 tile
 * routes made (enrolee_number set) keeps its stored year; Phase 5 removes
 * those routes and this rule with them.
 */
export function yearAfterReclassify(
  enroleeNumber: string | null | undefined,
  storedAyCode: string | null,
  classifiedAyCode: string | null
): string | null {
  return enroleeNumber ? storedAyCode : classifiedAyCode;
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
