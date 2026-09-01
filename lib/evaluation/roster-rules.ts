import { isEmptyRichText } from '@/lib/rich-text';
import type { EnrollmentStatus } from '@/lib/schemas/enrolment';

// Client-safe Evaluation roster/write-up rules module. Single source of
// truth for three predicates that `lib/evaluation/dashboard.ts` (rollup
// KPIs) and `lib/evaluation/drill.ts` (display rows) each need to agree on —
// previously each file independently re-derived all three inline, which is
// exactly the silent-drift vector KD #124's "count == drill" principle warns
// against:
//
//   1. T4 exclusion — no FCA write-up ever exists for Term 4; the final
//      report card has no comment block (KD #49).
//   2. Active-roster gate — only students with `enrollment_status !=
//      'withdrawn'` count (active + late_enrollee both count; only
//      withdrawn is excluded) (KD #120).
//   3. "Submitted" derivation — `submitted = true` AND non-empty content
//      after trim; a submitted-but-emptied write-up must read as NOT
//      submitted everywhere (dashboard KPI, drill status, chase worklist)
//      (KD #120).
//
// Runtime-pure: only `import type` for anything server-side (the
// EnrollmentStatus union from lib/schemas/enrolment.ts, itself a zod-only,
// client-safe module), no 'server-only' import, no Supabase client of any
// kind — safe to import from a 'use client' component. Modeled on
// lib/markbook/drill-filter.ts, the equivalent extraction for Markbook.

// ---------------------------------------------------------------------------
// 1. T4 exclusion (KD #49)

/** Term 4 never carries an FCA write-up — the final report card has no
 *  comment block. Every write-up term query/derivation excludes it. */
export const FCA_EXCLUDED_TERM_NUMBER = 4;

export function isFcaEligibleTermNumber(termNumber: number): boolean {
  return termNumber !== FCA_EXCLUDED_TERM_NUMBER;
}

// ---------------------------------------------------------------------------
// 2. Active-roster gate (KD #120)

/** The one `enrollment_status` value that excludes a student from the
 *  active roster for write-up purposes. `late_enrollee` still counts (still
 *  owes a write-up); only `withdrawn` is excluded. */
export const WITHDRAWN_ENROLLMENT_STATUS: EnrollmentStatus = 'withdrawn';

export function isActiveRosterStatus(
  status: string | EnrollmentStatus
): boolean {
  return status !== WITHDRAWN_ENROLLMENT_STATUS;
}

// ---------------------------------------------------------------------------
// 3. Submitted + non-empty derivation (KD #120)

/**
 * Does this write-up hold prose a person actually wrote?
 *
 * ⚠ MEASURED ON THE PROSE, NOT THE STRING. The comment box is a formatting
 * editor, so an adviser who opens it, types nothing and saves leaves `<p></p>`
 * behind — seven characters, which the `writeup.trim().length > 0` test this
 * replaces read as a written comment. This helper has the highest fan-out of
 * the cluster (the dashboard KPI numerator, the drill row status and the chase
 * worklist all derive from it), and it MUST agree with the report-card publish
 * gate in `lib/markbook/comment-completeness.ts` — a section the dashboard
 * calls complete that the gate then refuses to publish is the drift KD #124
 * exists to prevent. Bare text from before the editor existed still reads
 * correctly through the same helper.
 *
 * ⚠ THE FAST PATH IS NOT AN OPTIMISATION, IT IS LOAD-BEARING — MEASURED.
 * `isEmptyRichText` builds a DOM and a ProseMirror document, which costs about
 * **10ms per call**: 405 write-ups (one AY's roster for a single term) took
 * **4.1 seconds**, and `getWriteupProgressByTerm` runs exactly that loop on the
 * request path, uncached. Calling the parser per row made the evaluation
 * sections list several seconds slower and pushed an existing 405-row test past
 * its timeout, which is how this was caught.
 *
 * So the certain cases answer without parsing, and ONLY the certain ones:
 *   • no writeup at all → empty.
 *   • no entities and no raw `<script>`/`<style>` → the text outside the tags
 *     IS the text content, so "is any of it non-whitespace?" is the same
 *     question the parser would answer. This covers `<p></p>` and ordinary
 *     prose, i.e. very nearly every row.
 *   • anything else (entities such as `&nbsp;`, which trims away to nothing;
 *     raw script/style, whose text the schema drops) → hand it to the parser,
 *     which stays the authority.
 *
 * `__tests__/rich-text/writeup-emptiness-parity.test.ts` asserts the fast path
 * and `isEmptyRichText` return the SAME answer across a corpus built for this,
 * so the shortcut cannot quietly drift away from the publish gate.
 */
export function hasWriteupContent(writeup: string | null | undefined): boolean {
  if (!writeup) return false;
  if (!/[&]|<(?:script|style)\b/i.test(writeup)) {
    return writeup.replace(/<[^>]*>/g, '').trim().length > 0;
  }
  return !isEmptyRichText(writeup);
}

/** KD #120: "submitted" requires the submitted flag AND non-empty content —
 *  a submitted-but-emptied write-up must read as not-submitted everywhere
 *  (dashboard KPI numerator, drill row status, chase worklist). Callers that
 *  only have the raw writeup text on hand should derive `hasContent` via
 *  `hasWriteupContent` first. */
export function isSubmittedWriteup(params: {
  submitted: boolean;
  hasContent: boolean;
}): boolean {
  return params.submitted && params.hasContent;
}
