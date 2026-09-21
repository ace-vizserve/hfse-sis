import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { createClient as createServerClient } from '@/lib/supabase/server';

// The AY Setup Wizard (`/sis/ay-setup`) is the source of truth for which
// AYs exist — it INSERTs into `academic_years` when admin creates a new
// year. The switcher + URL-param validation read that table at render
// time via `listAyCodes()` below, so adding an AY is a pure runtime
// operation (no code deploy).

export async function listAyCodes(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (error) {
    console.error('[academic-year] listAyCodes failed:', error.message);
    return [];
  }
  return (data ?? []).map((r) => (r as { ay_code: string }).ay_code);
}

// Single source of truth for "which academic year are we currently in?"
// Reads from `public.academic_years` where `is_current = true`.
//
// Why this exists: multiple call sites (parent lookup, student sync,
// admissions queries) used to hardcode `'AY2026'`. That breaks the moment
// Joann flips the `is_current` flag to AY2027. Everything that needs to
// know the current year reads it through this helper instead.
//
// All admissions tables (`ay{YY}_enrolment_applications`, `_status`,
// `_documents`) share the same column definitions from AY2026 onward
// (see `docs/context/10-parent-portal.md`), so the only thing that changes
// year-to-year is the table name prefix, derived from `ay_code`.

export type CurrentAcademicYear = {
  id: string;
  ay_code: string; // e.g. "AY2026"
  label: string; // e.g. "Academic Year 2026" — single calendar year, Jan–Nov per HFSE rhythm
};

// Request-scoped cache wrapper. `academic_years` is a public reference table
// (readable by any authenticated role), so we ignore the passed client and
// use a single request-scoped server client via `createServerClient()`. This
// lets `React.cache()` dedupe — the module layout's TestModeBanner + the
// page below it both call `getCurrentAcademicYear()` on the same render and
// now share one DB round-trip instead of two.
const currentAcademicYearCached = cache(
  async (): Promise<CurrentAcademicYear | null> => {
    const client = await createServerClient();
    const { data, error } = await client
      .from('academic_years')
      .select('id, ay_code, label')
      .eq('is_current', true)
      .maybeSingle();
    if (error) {
      console.error('[academic-year] current lookup failed:', error.message);
      return null;
    }
    return (data as CurrentAcademicYear | null) ?? null;
  }
);

export async function getCurrentAcademicYear(
  _client?: SupabaseClient
): Promise<CurrentAcademicYear | null> {
  // The `_client` parameter is kept for source-compat with existing callers
  // but intentionally ignored — the cached helper creates its own request-
  // scoped client so React.cache dedupes across the layout + page tree.
  return currentAcademicYearCached();
}

// Convenience wrapper when the caller only needs the code and wants to
// fail loudly if there is no current year. Throws with a descriptive
// message suitable for a 500 response body.
export async function requireCurrentAyCode(
  _client?: SupabaseClient
): Promise<string> {
  const ay = await getCurrentAcademicYear();
  if (!ay) {
    throw new Error(
      'No current academic year set. Ask the registrar to set is_current=true on one academic_years row.'
    );
  }
  return ay.ay_code;
}

/**
 * The academic year a REQUEST is about, which is not always the current one.
 *
 * ⚠ THIS EXISTS BECAUSE `requireCurrentAyCode` WAS THE WRONG DEFAULT IN FIVE
 * ROUTES. The P-Files student page is multi-year: it reads `?ay`, and when the
 * param is stale it redirects to whichever AY the student actually exists in.
 * Its write routes did not — every one of them resolved the CURRENT year and
 * built its table prefix from that. Opening an AY2027 student and uploading
 * wrote to `ay2026_enrolment_documents`, matched no row, and reported "this
 * student has no document record for this academic year" about a record that
 * plainly existed on screen.
 *
 * ⚠ **The read routes were the worse half.** `revisions` returned the wrong
 * year's history with a 200, which looks like data rather than an error.
 *
 * Validation is against `listAyCodes`, NOT a regex: `AY9999` matches
 * /^AY\d{4}$/ and names a year that does not exist, and the table prefix is
 * interpolated into a query. An unknown code must be refused, not queried.
 *
 * Returns the current AY when `?ay` is absent, so every existing caller and
 * every link without the param behaves exactly as before.
 */
export async function resolveRequestAyCode(
  client: SupabaseClient,
  request: { url: string }
): Promise<{ ayCode: string } | { error: string }> {
  const requested = new URL(request.url).searchParams.get('ay');
  if (!requested) return { ayCode: await requireCurrentAyCode(client) };

  const known = await listAyCodes(client);
  if (!known.includes(requested)) return { error: 'invalid_ay' };
  return { ayCode: requested };
}

// Upcoming-AY lookup (KD #77). Returns the AY where
// `accepting_applications=true AND is_current=false`. There should be at
// most one such row in normal operation; if multiple exist the
// lexicographically-largest ay_code wins (next-most-recent year), which
// matches what the registrar would intuitively call "the upcoming AY."
//
// Returns null when there's no upcoming AY (the typical state — early-bird
// happens for a few months a year). The Admissions sidebar's "Upcoming AY
// applications" entry hides when this returns null.
export type UpcomingAcademicYear = {
  id: string;
  ay_code: string;
  label: string;
};

const upcomingAcademicYearCached = cache(
  async (): Promise<UpcomingAcademicYear | null> => {
    const client = await createServerClient();
    const { data, error } = await client
      .from('academic_years')
      .select('id, ay_code, label')
      .eq('accepting_applications', true)
      .eq('is_current', false)
      .order('ay_code', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[academic-year] upcoming lookup failed:', error.message);
      return null;
    }
    return (data as UpcomingAcademicYear | null) ?? null;
  }
);

export async function getUpcomingAcademicYear(
  _client?: SupabaseClient
): Promise<UpcomingAcademicYear | null> {
  return upcomingAcademicYearCached();
}
