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

/** One stored invoice whose year or tiles would change. */
export type Move = {
  studentNumber: string;
  fromAy: string | null;
  fromStages: string[];
  toAy: string | null;
  toStages: string[];
};

export type MovePreview = {
  invoices: number;
  students: number;
  byYear: Array<{
    ayCode: string;
    registration: { gain: number; lose: number };
    fees: { gain: number; lose: number };
  }>;
};

/** "What would change" before a settings save: per year, per tile. Pure. */
export function summarizeMoves(moves: Move[]): MovePreview {
  const years = new Map<string, MovePreview['byYear'][number]>();
  const at = (ay: string) => {
    let y = years.get(ay);
    if (!y) {
      y = {
        ayCode: ay,
        registration: { gain: 0, lose: 0 },
        fees: { gain: 0, lose: 0 },
      };
      years.set(ay, y);
    }
    return y;
  };
  for (const m of moves) {
    for (const s of ['registration', 'fees'] as const) {
      const was = !!m.fromAy && m.fromStages.includes(s);
      const now = !!m.toAy && m.toStages.includes(s);
      if (was && (!now || m.toAy !== m.fromAy)) at(m.fromAy!)[s].lose += 1;
      if (now && (!was || m.toAy !== m.fromAy)) at(m.toAy!)[s].gain += 1;
    }
  }
  return {
    invoices: moves.length,
    students: new Set(moves.map((m) => m.studentNumber)).size,
    byYear: [...years.values()].sort((a, b) =>
      a.ayCode.localeCompare(b.ayCode)
    ),
  };
}
