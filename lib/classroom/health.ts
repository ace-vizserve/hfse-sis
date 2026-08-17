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

import { isAttendanceAtRisk } from '@/lib/attendance/risk';
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

// The threshold and its predicate now live in lib/attendance/risk.ts — a pure
// module, so the school-wide Academic Overview can share the same number
// without importing this file's service client. Re-exported here because this
// is where every existing caller looks for it.
export {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  isAttendanceAtRisk,
} from '@/lib/attendance/risk';

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
