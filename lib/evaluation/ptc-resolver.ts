import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';

// PTC ↔ writeup-term resolver.
//
// HFSE's process: parents meet teachers AFTER a writeup cycle's report cards
// publish — the Apr PTC discusses T1 writeups, the Nov PTC discusses T3 (per
// the AY 2026 calendar). The PTC event lives in the *following* term on the
// calendar (e.g. Apr PTC sits inside T2), but the *deadline pressure* is on
// the prior term's writeups. We derive that relationship at read time from
// pure date math against `calendar_events.category='ptc'` + `terms.end_date`
// — no hardcoded dates, no per-AY config table — so reschedules, additions,
// and cancellations flow through automatically.
//
// One rule: a PTC event "discusses" the most-recently-ended *writeup* term
// (T1 / T2 / T3 — T4 excluded per KD #49) whose end_date is before the PTC
// start_date. If multiple PTCs both resolve to the same writeup term, the
// earliest one is the deadline-driving event.

export type PtcEvent = {
  eventId: string;
  termId: string; // the term the PTC SITS IN (FK)
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  label: string;
  audience: 'all' | 'primary' | 'secondary';
  tentative: boolean;
  discussedTermId: string | null; // the term whose WRITEUPS this PTC reviews; null if no writeup-term has ended yet
};

export type WriteupTermLite = {
  termId: string;
  termNumber: number;
  label: string;
  startDate: string | null;
  endDate: string | null;
};

// Writeup terms = T1, T2, T3. T4 is excluded structurally (no FCA writeup
// per KD #49) so it never becomes a `discussedTermId`.
const WRITEUP_TERM_NUMBERS = new Set([1, 2, 3]);

type Audience = 'all' | 'primary' | 'secondary';

/**
 * Returns every PTC calendar event for the AY with its derived
 * `discussedTermId` attached. Optional audience filter trims the set to the
 * events relevant to a section's level type (e.g. a primary section's
 * advisers shouldn't see secondary-only PTC dates as deadlines).
 */
export async function getPtcEventsForAy(
  ayCode: string,
  options: { audience?: Audience } = {}
): Promise<PtcEvent[]> {
  const service = createServiceClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow as { id: string } | null)?.id ?? null;
  if (!ayId) return [];

  const { data: termRows, error: termsErr } = await service
    .from('terms')
    .select('id, term_number, label, start_date, end_date')
    .eq('academic_year_id', ayId)
    .order('term_number', { ascending: true });
  if (termsErr) {
    console.error('[ptc-resolver] terms fetch failed:', termsErr.message);
    return [];
  }
  type TermRow = {
    id: string;
    term_number: number;
    label: string;
    start_date: string | null;
    end_date: string | null;
  };
  const terms = (termRows ?? []) as TermRow[];
  const termIdsForAy = new Set(terms.map((t) => t.id));
  const writeupTerms = terms.filter(
    (t) => WRITEUP_TERM_NUMBERS.has(t.term_number) && t.end_date != null
  );

  const { data: eventRows, error: eventsErr } = await service
    .from('calendar_events')
    .select('id, term_id, start_date, end_date, label, audience, tentative')
    .eq('category', 'ptc')
    .order('start_date', { ascending: true });
  if (eventsErr) {
    console.error('[ptc-resolver] events fetch failed:', eventsErr.message);
    return [];
  }
  type EventRow = {
    id: string;
    term_id: string;
    start_date: string;
    end_date: string;
    label: string;
    audience: Audience;
    tentative: boolean;
  };
  const allEvents = ((eventRows ?? []) as EventRow[]).filter((e) =>
    termIdsForAy.has(e.term_id)
  );

  const audienceFilter = options.audience;
  const events = audienceFilter
    ? allEvents.filter(
        (e) =>
          e.audience === 'all' ||
          e.audience === audienceFilter ||
          // Treat a same-named audience as the inverse passthrough: a
          // primary-only event is irrelevant to secondary callers and vice
          // versa. 'all' always passes.
          audienceFilter === e.audience
      )
    : allEvents;

  return events.map((e) => ({
    eventId: e.id,
    termId: e.term_id,
    startDate: e.start_date,
    endDate: e.end_date,
    label: e.label,
    audience: e.audience,
    tentative: e.tentative,
    discussedTermId: resolveDiscussedTermId(e.start_date, writeupTerms),
  }));
}

/**
 * Inverse lookup: for a given writeup term, which PTC event is its
 * deadline driver? Returns the earliest PTC event whose `discussedTermId`
 * matches. `null` when no PTC is scheduled for this term yet, or the term
 * is T4 (no writeup → no parent meeting per KD #49).
 */
export function findPtcForWriteupTerm(
  writeupTermId: string,
  ptcEvents: PtcEvent[]
): PtcEvent | null {
  const candidates = ptcEvents
    .filter((e) => e.discussedTermId === writeupTermId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return candidates[0] ?? null;
}

/**
 * Build the (writeupTerm → ptcEvent | null) map for the AY. Handy for
 * dashboards that render a row per writeup-term and want O(1) lookup.
 */
export function buildPtcDeadlineMap(
  writeupTerms: WriteupTermLite[],
  ptcEvents: PtcEvent[]
): Map<string, PtcEvent | null> {
  const map = new Map<string, PtcEvent | null>();
  for (const t of writeupTerms) {
    map.set(t.termId, findPtcForWriteupTerm(t.termId, ptcEvents));
  }
  return map;
}

/**
 * Days from today (Singapore local) to the PTC start date. Negative when
 * past. Used to drive amber-vs-destructive warning tone on the UI.
 */
export function daysUntilPtc(
  ptcStartDate: string,
  today: string = sgToday()
): number {
  const a = Date.parse(`${today}T00:00:00+08:00`);
  const b = Date.parse(`${ptcStartDate}T00:00:00+08:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / 86_400_000);
}

// Canonical SGT-today helper now lives in lib/dates.ts; re-exported here for
// back-compat with existing `import { sgToday } from '.../ptc-resolver'` sites.
export { sgToday };

export function resolveDiscussedTermId(
  ptcStartDate: string,
  writeupTerms: Array<{ id: string; end_date: string | null }>
): string | null {
  const candidates = writeupTerms
    .filter((t): t is { id: string; end_date: string } => t.end_date != null)
    .filter((t) => t.end_date < ptcStartDate)
    .sort((a, b) => b.end_date.localeCompare(a.end_date));
  return candidates[0]?.id ?? null;
}

/**
 * Tone helper — adviser/registrar UIs use the same threshold ladder.
 * `done` means the deadline obligation is met (writeup submitted) and so
 * the row shouldn't warn even if PTC is imminent.
 */
export type PtcWarningTone =
  | 'past'
  | 'far'
  | 'near'
  | 'urgent'
  | 'overdue'
  | 'good';

export function ptcWarningTone(
  daysUntil: number,
  isObligationMet: boolean
): PtcWarningTone {
  if (isObligationMet) return 'good';
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 3) return 'urgent';
  if (daysUntil <= 30) return 'near';
  if (Number.isFinite(daysUntil)) return 'far';
  return 'past';
}
