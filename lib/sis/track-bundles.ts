// Secondary curriculum track bundles ("Config-Driven Subject Registry +
// Secondary Tracks" Phase 3). A STATIC config map in code, deliberately
// not a new DB table — cheap to remove or change later if the track
// concept doesn't stick, matching the non-authoritative / reversible
// requirement on `sections.class_type` in its bundle-apply role (see
// lib/schemas/section.ts's header comment on that field).
//
// Keyed by the EXISTING `SectionClassType` ('Global' | 'Standard') —
// there is no separate `track` column/type. A prior draft of this file
// added one; it was removed in favour of reusing `class_type`, which
// already carried this exact vocabulary for the admissions auto-
// enrollment matcher (`lib/sis/class-assignment.ts`, untouched by this
// module).
//
// Pure module — subject CODES only, no DB/Supabase imports, safe to unit
// test and to import from both server routes and (if ever needed) client
// code.
//
// Codes verified directly against the subjects each session's migrations
// actually minted, not assumed:
//   - GP / COMP / ARTD / PESTD  → migration 082 (subject registry hardening)
//   - ENG / MATH / SCI / HUM / PEH / HIST / LIT / CA → supabase/seed.sql
//   - Mother Tongue (FIL / MANDARIN) is deliberately NOT in the Standard
//     bundle — see the note below.

import type { SectionClassType } from '@/lib/schemas/section';

export const TRACK_BUNDLES: Record<SectionClassType, readonly string[]> = {
  Global: ['ENG', 'MATH', 'SCI', 'HUM', 'GP', 'COMP', 'ARTD', 'PEH'],
  // Mother Tongue is intentionally absent here. Attaching "Mother Tongue"
  // to a section isn't a single subject — the registrar has to also pick
  // a language (Filipino or Mandarin, migration 081's real graded
  // subjects that fan into Mother Tongue on the report card via
  // subject_report_map). A bundle-apply action can't resolve that pick on
  // its own. Chosen approach (documented in the Task 3 report): the
  // Standard bundle-apply inserts these 7 subjects immediately; Mother
  // Tongue is left for the registrar to attach afterward via the normal
  // per-section flow (`SectionSubjectsPanel`'s existing Mother-Tongue
  // language sub-choice) — simpler and lower-risk than threading a
  // language pick through the bulk-apply flow, at the cost of one small
  // manual step.
  Standard: ['ENG', 'MATH', 'SCI', 'HIST', 'LIT', 'CA', 'PESTD'],
};

/** Subject codes for a track bundle. Thin named wrapper over the map so
 * call sites read as intent ("give me Global's codes") rather than a raw
 * object index, and so this is the one function to unit-test if the
 * bundle membership rule (e.g. "never include an MT code") ever needs to
 * be asserted in code instead of just in a comment.
 *
 * DELIBERATELY level-agnostic (flat) — kept exactly as-is for its one
 * remaining live caller, `components/sis/subject-catalog-card.tsx`'s
 * Track column / Track view-filter, which tags a catalog SUBJECT (not a
 * specific section) with which track bundle(s) it belongs to in a
 * level-independent way (that table has no per-section level in scope).
 * `resolveTrackBundle` below is the level-AWARE resolver — use that for
 * anything resolving what a SPECIFIC section (which has a specific level)
 * should get. Do not swap this function's body to be level-aware; that
 * would require a level parameter this function's only caller doesn't
 * have. */
export function subjectCodesForTrack(
  classType: SectionClassType
): readonly string[] {
  return TRACK_BUNDLES[classType];
}

// ─────────────────────────────────────────────────────────────────────────
// resolveTrackBundle — level-AWARE bundle resolution ("Unified Subject
// Setup page" plan, Task 3; docs:
// C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md). Fixes a
// correctness bug in the flat TRACK_BUNDLES.Standard list above: real HFSE
// curriculum has History (`HIST`) as the humanities-slot subject for
// S1-S2, and Humanities (`HUM`) for S3-S4 — the flat list always returned
// HIST, so a Standard S3/S4 section's bulk track-apply (and, before this
// fix, its "Recommended" tagging on the Assign-to-sections checklist)
// silently gave it the wrong humanities subject for its level, and never
// HUM at all (HUM was tagged Global-only in TRACK_BUNDLES).
//
// This is the ONE resolver both real call sites must use — do not
// duplicate the HIST/HUM swap logic anywhere else:
//   - `lib/sis/section-track.ts::applyTrackBundle` (backs the bulk
//     "Flag as Global/Standard" route, `POST /api/sections/[id]/track`)
//   - `lib/sis/subjects/queries.ts::recommendedCodesForSection` (drives
//     the Assign-to-sections checklist's per-row "Recommended" tag)
//
// Global's bundle is unaffected by level (no evidence — verified/reviewed
// — that it varies by level the way Standard's humanities slot does), so
// it stays a flat membership check; this deliberately does NOT build a
// level-conditional Global resolver with nothing real to condition on.
// ─────────────────────────────────────────────────────────────────────────

const HUMANITIES_SLOT_S1_S2_CODE = 'HIST';
const HUMANITIES_SLOT_S3_S4_CODE = 'HUM';
const HUMANITIES_SLOT_S3_S4_LEVEL_CODES: ReadonlySet<string> = new Set([
  'S3',
  'S4',
]);

/**
 * Resolves a class_type's bundle for a SPECIFIC section level. Same
 * `TRACK_BUNDLES` base data as `subjectCodesForTrack`, with the Standard
 * bundle's humanities-slot subject swapped HIST→HUM when `levelCode` is
 * S3 or S4. Global is returned unchanged regardless of `levelCode`.
 *
 * `levelCode` is the section's SPECIFIC level (e.g. "S3"), not its level
 * TYPE ("secondary") — callers must pass the real per-section value
 * (`SectionWithSubjectsRow.levelCode` / the level row's `code`), not a
 * level-type string.
 */
export function resolveTrackBundle(
  classType: SectionClassType,
  levelCode: string
): readonly string[] {
  const base = TRACK_BUNDLES[classType];
  if (classType !== 'Standard') return base;
  if (!HUMANITIES_SLOT_S3_S4_LEVEL_CODES.has(levelCode)) return base;
  return base.map((code) =>
    code === HUMANITIES_SLOT_S1_S2_CODE ? HUMANITIES_SLOT_S3_S4_CODE : code
  );
}
