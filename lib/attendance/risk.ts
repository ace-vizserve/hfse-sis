// The one attendance cut-off used anywhere in the SIS.
//
// Lifted out of lib/classroom/health.ts so surfaces that cannot import that
// file can still share the number. `health.ts` carries `server-only`, a
// Supabase service client and `unstable_cache`; the school-wide Academic
// Overview aggregator (lib/markbook/academic-overview-compute.ts) is
// deliberately runtime-pure and must not pull any of that into its graph.
// Two copies of a threshold is exactly the silent drift the comment below
// warns against, so the constant moved here and `health.ts` re-exports it.

/**
 * At-risk attendance threshold — a DISPLAY HEURISTIC, not an HFSE-defined
 * policy. There is no school-policy number for "how low is too low"
 * documented anywhere in this codebase — the only real attendance quota
 * rules (KD #94) govern EXCUSED-day counts (vacation: 1/term,
 * compassionate: 5/year), not overall attendance percentage. 90% mirrors a
 * commonly-cited "chronic absenteeism" line (e.g. the U.S. Department of
 * Education's missing-≥10%-of-days benchmark) — chosen only so this strip
 * has SOME defensible, named cut-off instead of an unreasoned round number.
 * If HFSE ever defines an actual policy threshold, replace this constant;
 * do not let it silently drift, and do not present it as an official rule.
 *
 * ⚠ It is NOT the 80% in the school's own attendance warning letter. That
 * rule lives in the Student Handbook, the school revises it on its own
 * schedule, and a hardcoded copy would go stale silently — so nothing in the
 * SIS encodes it.
 */
export const AT_RISK_ATTENDANCE_THRESHOLD_PCT = 90;

/**
 * Pure. `null` means no rollup has been recorded yet for this student this
 * term — that is "no data," never "at risk." Never treat a missing
 * measurement as a bad one (the same discipline Hard Rule #3 applies to
 * grade cells).
 */
export function isAttendanceAtRisk(attendancePct: number | null): boolean {
  if (attendancePct == null) return false;
  return attendancePct < AT_RISK_ATTENDANCE_THRESHOLD_PCT;
}
