// Classroom Health — Phase 5 "what needs doing" strip on the Overview tab.
//
// The heavy lifting is entirely `computePublishReadiness`
// (lib/markbook/publish-readiness.ts) — the exact evaluator the report-card
// publish dialog uses, so a Health number can never disagree with what the
// publish checklist would say for the same (section, term). This file adds
// only what that evaluator does not already provide:
//   (1) a short-TTL cache wrapper — this composite read (roster + sheets +
//       entries + write-ups) previously ran only when a registrar opened the
//       publish dialog; it now runs on every Overview page load;
//   (2) the students-at-risk derivation — computePublishReadiness tracks
//       COMPLETENESS (has a rollup been recorded?), not attendance
//       PERCENTAGE, so it has nothing to say about who is at risk.

import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  computePublishReadiness,
  type PublishReadiness,
} from '@/lib/markbook/publish-readiness';
import { createServiceClient } from '@/lib/supabase/service';

const HEALTH_CACHE_TTL_SECONDS = 60;

async function loadClassroomHealthUncached(
  sectionId: string,
  termId: string
): Promise<PublishReadiness | null> {
  const service = createServiceClient();
  const result = await computePublishReadiness(service, sectionId, termId);
  return 'error' in result ? null : result;
}

/**
 * Cached per (section, term). Tagged under all three modules whose
 * mutations feed this composite — grading sheets/entries, evaluation
 * write-ups, attendance rollups — matching the KD #80 per-AY drill-tag
 * convention, so a save in any of them busts the Health cache well ahead of
 * the 60s TTL (`invalidateDrillTags('markbook'|'evaluation'|'attendance', ay)`
 * is already called by every mutation route that touches these tables — see
 * lib/cache/invalidate-drill-tags.ts). A save in Records/Admissions/P-Files
 * does not affect any field this reads, so those tags are deliberately not
 * included.
 */
export async function getClassroomHealth(
  sectionId: string,
  termId: string,
  ayCode: string
): Promise<PublishReadiness | null> {
  return unstable_cache(
    loadClassroomHealthUncached,
    ['classroom', 'health', sectionId, termId],
    {
      tags: [
        `markbook-drill:${ayCode}`,
        `evaluation-drill:${ayCode}`,
        `attendance-drill:${ayCode}`,
      ],
      revalidate: HEALTH_CACHE_TTL_SECONDS,
    }
  )(sectionId, termId);
}

// ─────────────────────────────────────────────────────────────────────────
// Students at risk (attendance)
// ─────────────────────────────────────────────────────────────────────────

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

export type AtRiskStudent = {
  sectionStudentId: string;
  indexNumber: number | null;
  studentNumber: string | null;
  name: string;
  attendancePct: number;
};

export type RollupLite = {
  sectionStudentId: string;
  attendancePct: number | null;
};

export type RosterNameLite = {
  sectionStudentId: string;
  indexNumber: number | null;
  studentNumber: string | null;
  name: string;
};

/**
 * Pure join + filter + sort (worst attendance first). Takes already-fetched
 * rollup rows and roster names — no I/O — so it is independently
 * unit-testable without a database. A rollup row with no matching roster
 * entry is silently dropped, which is how a withdrawn student's rollup
 * (roster excludes withdrawn students) is excluded without a second filter.
 */
export function selectAtRiskStudents(
  rollups: RollupLite[],
  roster: RosterNameLite[]
): AtRiskStudent[] {
  const rosterBySSId = new Map(roster.map((r) => [r.sectionStudentId, r]));
  const out: AtRiskStudent[] = [];
  for (const r of rollups) {
    if (!isAttendanceAtRisk(r.attendancePct)) continue;
    const meta = rosterBySSId.get(r.sectionStudentId);
    if (!meta) continue;
    out.push({
      sectionStudentId: r.sectionStudentId,
      indexNumber: meta.indexNumber,
      studentNumber: meta.studentNumber,
      name: meta.name,
      attendancePct: r.attendancePct as number,
    });
  }
  return out.sort((a, b) => a.attendancePct - b.attendancePct);
}
