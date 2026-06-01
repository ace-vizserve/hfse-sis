import 'server-only';

import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createServiceClient } from '@/lib/supabase/service';
import {
  resolveEnrolmentPosition,
  type EnrolmentPosition,
} from '@/lib/sis/enrolment-position';

// Resolved term info for a given date in an AY.
export type TermInfo = { termNumber: number; termLabel: string };

type TermWindow = { termNumber: number; startDate: string; endDate: string };

// Per-AY term list, cached for 5 minutes (tagged so AY mutations invalidate).
// Uses the service client — cookie-scoped clients are forbidden inside
// unstable_cache per Next 16 (KD #54).
function _loadTermsForAYUncached(ayCode: string): Promise<TermWindow[]> {
  return unstable_cache(
    async () => {
      const service = createServiceClient();
      const { data: ayRow } = await service
        .from('academic_years')
        .select('id')
        .eq('ay_code', ayCode)
        .maybeSingle();
      if (!ayRow) return [];

      const { data: termRows } = await service
        .from('terms')
        .select('term_number, start_date, end_date')
        .eq('academic_year_id', (ayRow as { id: string }).id);
      if (!termRows) return [];

      return (
        termRows as Array<{
          term_number: number;
          start_date: string | null;
          end_date: string | null;
        }>
      )
        .filter((t) => t.start_date && t.end_date)
        .map((t) => ({
          termNumber: t.term_number,
          startDate: t.start_date as string,
          endDate: t.end_date as string,
        }));
    },
    [`sis-terms-${ayCode}`],
    { revalidate: 300, tags: ['sis', `sis:${ayCode}`] }
  )();
}

// Public helper — returns all term windows for an AY (cached, service-role).
export function loadTermsForAY(ayCode: string): Promise<TermWindow[]> {
  return _loadTermsForAYUncached(ayCode);
}

// Single-date term lookup. Returns the term whose [start_date, end_date]
// window contains the given date, or null when the date falls outside any
// defined term window (e.g. between T2 and T3 break, or before T1 starts).
export async function getTermForDate(
  date: string,
  ayCode: string,
  _service?: SupabaseClient
): Promise<TermInfo | null> {
  const terms = await loadTermsForAY(ayCode);
  const match = terms.find((t) => t.startDate <= date && t.endDate >= date);
  if (!match) return null;
  return { termNumber: match.termNumber, termLabel: `T${match.termNumber}` };
}

// Bulk variant — preloads every term in every named AY so callers can do
// many date lookups in memory. Useful for the cross-AY records placement
// table where each placement is a different AY. Delegates to the cached
// per-AY loader in parallel so cache slots are shared across callers.
export async function preloadTermsForAYs(
  ayCodes: string[],
  _service?: SupabaseClient
): Promise<Map<string, TermWindow[]>> {
  if (ayCodes.length === 0) return new Map();
  const results = await Promise.all(ayCodes.map((ay) => loadTermsForAY(ay)));
  return new Map(ayCodes.map((ay, i) => [ay, results[i]]));
}

// Loads the AY's term windows and resolves the enrolment position for today
// (UTC date — matches the enrollment_date stamp in the section-students PATCH).
export async function getEnrolmentPosition(
  ayCode: string
): Promise<EnrolmentPosition> {
  const terms = await loadTermsForAY(ayCode);
  const today = new Date().toISOString().slice(0, 10);
  return resolveEnrolmentPosition(
    terms.map((t) => ({
      termNumber: t.termNumber,
      startDate: t.startDate,
      endDate: t.endDate,
    })),
    today
  );
}

// Synchronous lookup against a preloaded map.
export function termForDateInPreloaded(
  date: string,
  ayCode: string,
  preloaded: Map<string, TermWindow[]>
): TermInfo | null {
  const terms = preloaded.get(ayCode);
  if (!terms) return null;
  const match = terms.find((t) => t.startDate <= date && t.endDate >= date);
  if (!match) return null;
  return { termNumber: match.termNumber, termLabel: `T${match.termNumber}` };
}

export type ResolvedLateEnrolleeTerm = {
  termNumber: number;
  termLabel: string;
  source: 'override' | 'derived';
} | null;

/**
 * Determines a late-enrollee's joining term.
 * If `late_enrollee_term_number` is set, that is the registrar's explicit
 * correction (source='override'). Otherwise derives from `enrollment_date`
 * via `getTermForDate` (source='derived'). Returns null when neither is
 * available or the date falls outside all term windows.
 */
export async function resolveLateEnrolleeTerm(
  row: {
    enrollment_date: string | null;
    late_enrollee_term_number: number | null;
  },
  ayCode: string
): Promise<ResolvedLateEnrolleeTerm> {
  if (row.late_enrollee_term_number !== null) {
    const n = row.late_enrollee_term_number;
    return { termNumber: n, termLabel: `T${n}`, source: 'override' };
  }
  if (!row.enrollment_date) return null;
  const term = await getTermForDate(row.enrollment_date, ayCode);
  if (!term) return null;
  return {
    termNumber: term.termNumber,
    termLabel: term.termLabel,
    source: 'derived',
  };
}
