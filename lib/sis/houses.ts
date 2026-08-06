import { cache } from 'react';

import { createServiceClient } from '@/lib/supabase/service';

// The house system (migration 110) — the Commonwealth grouping that cuts
// across year groups, so a house holds students from P1 to S4.
//
// NO `import 'server-only'` here, deliberately, and the same reasoning as
// lib/sis/levels.ts: the chip component is a client component and imports the
// pure token helper below. Only `listHouses` touches the service client, and
// only server components call it.

export type HouseRow = {
  id: string;
  code: string;
  /**
   * The COLOUR name — "Orange House". The only thing rendered anywhere today.
   *
   * Note this is not what Chandana's picture calls a house's "name" (that is
   * `title`, below). Migration 111's header explains why the column keeps the
   * broader word rather than churning every consumer for a vocabulary clash.
   */
  name: string;
  /**
   * The symbol name — "The Flame" (migration 111). **Rendered nowhere.** The
   * school asked for the colour name alone for now; this is what will sit
   * beside Mr Lloyd's house logo when that arrives, and it is carried here so
   * the data is reachable rather than needing a second trip to the database.
   */
  title: string | null;
  /** The four values a house stands for. Rendered nowhere — see `title`. */
  coreValues: string[];
  /** Design-token NAME, resolved against app/globals.css. Never a hex value. */
  colourToken: string;
  sortOrder: number;
};

/**
 * Tailwind classes for a house swatch.
 *
 * These are house IDENTITY, not semantic state — a house simply IS its colour,
 * and it carries no good/warning/critical meaning. Never reuse them to signal
 * status, and never render the colour alone: every caller shows the house name
 * beside it, so the information survives for anyone who cannot distinguish the
 * hues (§9.3, and Hard Rule #7 is why these are tokens rather than hex).
 *
 * Unknown tokens fall back to a neutral rather than throwing — a house added
 * by an admin without a matching token should still render.
 */
export function houseSwatchClass(colourToken: string): string {
  switch (colourToken) {
    case 'house-1':
      return 'bg-house-1';
    case 'house-2':
      return 'bg-house-2';
    case 'house-3':
      return 'bg-house-3';
    case 'house-4':
      return 'bg-house-4';
    default:
      return 'bg-muted-foreground';
  }
}

/**
 * Tailwind classes for the permanent record's house icon tile.
 *
 * The three tiles beside it count things and share the SIS-wide indigo→navy
 * icon-tile gradient (§7.4). This one is the student's identity rather than a
 * quantity, so it wears the house's own colour — which means that once a house
 * is set, the tile answers "which house" before anyone reads the word. The
 * name is still always printed beside it (§9.3).
 *
 * Literal per-token strings, not a template: Tailwind emits no class it cannot
 * read in the source, so an interpolated `from-${token}` compiles to nothing
 * and does so silently.
 */
export function houseTileClass(colourToken: string): string {
  switch (colourToken) {
    case 'house-1':
      return 'bg-gradient-to-br from-house-1 to-house-1-deep';
    case 'house-2':
      return 'bg-gradient-to-br from-house-2 to-house-2-deep';
    case 'house-3':
      return 'bg-gradient-to-br from-house-3 to-house-3-deep';
    case 'house-4':
      return 'bg-gradient-to-br from-house-4 to-house-4-deep';
    default:
      return 'bg-muted-foreground';
  }
}

/**
 * Every house, in display order. Request-scoped cache — the four rows are
 * read by the students list, the permanent record and the roster chips within
 * one render.
 *
 * Returns an ARRAY, never a Set: this shape gets passed to cached server
 * functions elsewhere and `unstable_cache` JSON-serialises, which turns a Set
 * into `{}` (KD #153).
 */
export const listHouses = cache(async (): Promise<HouseRow[]> => {
  const service = createServiceClient();
  const { data, error } = await service
    .from('houses')
    .select('id, code, name, title, core_values, colour_token, sort_order')
    .order('sort_order');
  if (error) {
    // Best-effort: a house chip is never worth failing a page for.
    console.error('[houses] read failed:', error.message);
    return [];
  }
  return (
    (data ?? []) as Array<{
      id: string;
      code: string;
      name: string;
      title: string | null;
      core_values: string[] | null;
      colour_token: string;
      sort_order: number;
    }>
  ).map((h) => ({
    id: h.id,
    code: h.code,
    name: h.name,
    title: h.title,
    coreValues: h.core_values ?? [],
    colourToken: h.colour_token,
    sortOrder: h.sort_order,
  }));
});
