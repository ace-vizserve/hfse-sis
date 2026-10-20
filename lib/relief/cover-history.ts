import 'server-only';

import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import type { CoverClass } from '@/lib/relief/cover-board';
import {
  buildCoverHistory,
  RELIEF_END,
  RELIEF_START,
  type AyDateRange,
  type CoverOutcome,
  type LivePastCover,
  type ReliefAuditEntry,
} from '@/lib/relief/cover-history-core';
import type { AssignmentRole } from '@/lib/schemas/teacher-assignment';
import { subjectDisplayNamesForAy } from '@/lib/sis/subjects/display-names-for-ay';
import { createServiceClient } from '@/lib/supabase/service';

// The Cover page's History tab: every absence in one academic year whose
// window is behind us — ran its course, stopped early, or cancelled.
//
// READ ONLY, and not the gate. Service client, like `getCoverBoard`, so the
// CALLER must have proved `staff.manage_relief` first.
//
// The timeline itself is `buildCoverHistory` (pure, tested). This file fetches
// its three inputs — the relief audit entries, the rows still holding a past
// window, and each year's dates from its terms — then names the teachers and
// classes the way the rest of the page does.

export type CoverHistoryRow = {
  key: string;
  coveredTeacherId: string;
  coveredTeacherName: string;
  reliefTeacherId: string;
  reliefTeacherName: string;
  startedOn: string | null;
  endedOn: string | null;
  reason: string | null;
  outcome: CoverOutcome;
  classes: CoverClass[];
};

type AssignmentRaw = {
  id: string;
  role: AssignmentRole;
  section: { id: string; name: string; level: { code: string | null } | null };
  subject: { id: string; name: string } | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Every relief audit entry. PostgREST silently caps a read at 1000 rows, so
 * page through it — ordered by (created_at, id) so pages never overlap.
 */
const AUDIT_PAGE = 1000;
async function readAllAudit(
  service: ReturnType<typeof createServiceClient>
): Promise<{
  data: Array<{
    action: string;
    created_at: string;
    context: Record<string, unknown> | null;
  }> | null;
  error: { message: string } | null;
}> {
  const all: Array<{
    action: string;
    created_at: string;
    context: Record<string, unknown> | null;
  }> = [];
  for (let from = 0; ; from += AUDIT_PAGE) {
    const { data, error } = await service
      .from('audit_log')
      .select('action, created_at, context')
      .in('action', [RELIEF_START, RELIEF_END])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + AUDIT_PAGE - 1);
    if (error) return { data: null, error };
    const page = (data ?? []) as typeof all;
    all.push(...page);
    if (page.length < AUDIT_PAGE) break;
  }
  return { data: all, error: null };
}

export async function getCoverHistory(
  ayCode: string,
  today: string
): Promise<{ rows: CoverHistoryRow[]; failed: boolean }> {
  const service = createServiceClient();

  const [auditRes, liveRes, termsRes, names] = await Promise.all([
    readAllAudit(service),
    service
      .from('teacher_assignments')
      .select(
        'id, teacher_user_id, relief_teacher_user_id, relief_started_on, relief_ended_on, relief_reason'
      )
      .not('relief_teacher_user_id', 'is', null)
      .lt('relief_ended_on', today),
    service
      .from('terms')
      .select(
        'start_date, end_date, academic_year:academic_years!inner(id, ay_code)'
      ),
    getStaffDisplayNameById()
      .then((e) => new Map(e))
      .catch(() => new Map<string, string>()),
  ]);

  if (auditRes.error || liveRes.error || termsRes.error) {
    console.error(
      '[cover-history] read failed:',
      auditRes.error?.message ??
        liveRes.error?.message ??
        termsRes.error?.message
    );
    return { rows: [], failed: true };
  }

  // A year runs from its first term's first day to its last term's last day.
  const byAy = new Map<string, AyDateRange & { id: string }>();
  for (const t of (termsRes.data ?? []) as unknown as Array<{
    start_date: string | null;
    end_date: string | null;
    academic_year: { id: string; ay_code: string } | null;
  }>) {
    const ay = one(t.academic_year);
    if (!ay || !t.start_date || !t.end_date) continue;
    const r = byAy.get(ay.ay_code);
    if (!r) {
      byAy.set(ay.ay_code, {
        id: ay.id,
        ayCode: ay.ay_code,
        startDate: t.start_date,
        endDate: t.end_date,
      });
    } else {
      if (t.start_date < r.startDate) r.startDate = t.start_date;
      if (t.end_date > r.endDate) r.endDate = t.end_date;
    }
  }

  const entries: ReliefAuditEntry[] = (
    (auditRes.data ?? []) as Array<{
      action: string;
      created_at: string;
      context: Record<string, unknown> | null;
    }>
  ).map((e) => ({
    action: e.action,
    createdAt: e.created_at,
    context: e.context ?? {},
  }));

  const livePast: LivePastCover[] = (
    (liveRes.data ?? []) as Array<{
      id: string;
      teacher_user_id: string;
      relief_teacher_user_id: string;
      relief_started_on: string | null;
      relief_ended_on: string | null;
      relief_reason: string | null;
    }>
  ).map((r) => ({
    assignmentId: r.id,
    coveredTeacherId: r.teacher_user_id,
    reliefTeacherId: r.relief_teacher_user_id,
    startedOn: r.relief_started_on,
    endedOn: r.relief_ended_on,
    reason: r.relief_reason,
  }));

  const absences = buildCoverHistory({
    entries,
    livePast,
    today,
    ayRanges: [...byAy.values()],
  }).filter((a) => a.ayCode === ayCode);
  if (absences.length === 0) return { rows: [], failed: false };

  // Name each class as it is named today, when the class still exists — the
  // bulk log stores subject CODES, so its own labels are only the fallback.
  const ids = [...new Set(absences.flatMap((a) => a.assignmentIds))];
  const { data: assignmentData } = await service
    .from('teacher_assignments')
    .select(
      'id, role, section:sections(id, name, level:levels(code)), subject:subjects(id, name)'
    )
    .in('id', ids);
  const assignments = (assignmentData ?? []) as unknown as AssignmentRaw[];
  const ayId = byAy.get(ayCode)?.id;
  const subjectNames = ayId
    ? await subjectDisplayNamesForAy(
        service,
        ayId,
        assignments
          .map((a) => one(a.subject))
          .filter((s): s is { id: string; name: string } => !!s)
      )
    : new Map<string, string>();

  const classById = new Map<string, CoverClass>();
  for (const a of assignments) {
    const section = one(a.section);
    if (!section) continue;
    const level = one(section.level);
    const where = level?.code ? `${level.code} ${section.name}` : section.name;
    const subject = one(a.subject);
    const label =
      a.role === 'form_adviser'
        ? `${where} · Form class`
        : `${where} · ${
            subject ? (subjectNames.get(subject.id) ?? subject.name) : 'Subject'
          }`;
    classById.set(a.id, { assignmentId: a.id, sectionId: section.id, label });
  }

  const rows = absences.map((a) => ({
    key: a.key,
    coveredTeacherId: a.coveredTeacherId,
    coveredTeacherName:
      names.get(a.coveredTeacherId) ?? a.coveredTeacherName ?? 'Former staff',
    reliefTeacherId: a.reliefTeacherId,
    reliefTeacherName:
      names.get(a.reliefTeacherId) ?? a.reliefTeacherName ?? 'Former staff',
    startedOn: a.startedOn,
    endedOn: a.endedOn,
    reason: a.reason,
    outcome: a.outcome,
    classes: a.assignmentIds
      .map(
        (id) =>
          classById.get(id) ?? {
            assignmentId: id,
            sectionId: '',
            label: a.auditLabels[id] ?? 'A class since removed',
          }
      )
      .sort((x, y) => x.label.localeCompare(y.label)),
  }));
  return { rows, failed: false };
}
