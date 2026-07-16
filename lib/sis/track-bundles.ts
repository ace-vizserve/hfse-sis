// Secondary curriculum track bundles (migration 084, "Config-Driven
// Subject Registry + Secondary Tracks" Phase 3). A STATIC config map in
// code, deliberately not a new DB table — cheap to remove or change later
// if the track concept doesn't stick, matching the non-authoritative /
// reversible requirement on `sections.track` itself (see the migration's
// header comment).
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

import type { Track } from '@/lib/schemas/section';

export const TRACK_BUNDLES: Record<Track, readonly string[]> = {
  global: ['ENG', 'MATH', 'SCI', 'HUM', 'GP', 'COMP', 'ARTD', 'PEH'],
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
  standard: ['ENG', 'MATH', 'SCI', 'HIST', 'LIT', 'CA', 'PESTD'],
};

/** Subject codes for a track bundle. Thin named wrapper over the map so
 * call sites read as intent ("give me Global's codes") rather than a raw
 * object index, and so this is the one function to unit-test if the
 * bundle membership rule (e.g. "never include an MT code") ever needs to
 * be asserted in code instead of just in a comment. */
export function subjectCodesForTrack(track: Track): readonly string[] {
  return TRACK_BUNDLES[track];
}
