import { NextRequest, NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { presentOnlyCount } from '@/lib/attendance/queries';
import {
  currentTermMonthsFromRaw,
  type MonthlySummary,
} from '@/lib/attendance/sheet-summary';
import { sgToday } from '@/lib/dates';
import type { AttendanceStatus } from '@/lib/schemas/attendance';
import { resolveCurrentTermId } from '@/lib/sis/current-term';
import { createServiceClient } from '@/lib/supabase/service';

export type TermStat = {
  termId: string;
  termNumber: number;
  label: string;
  isCurrent: boolean;
  P: number;
  L: number;
  A: number;
  EX: number;
  rate: number | null;
};

export type StudentSummaryResponse = {
  termStats: TermStat[];
  recentAbsences: string[]; // ISO date strings (YYYY-MM-DD)
  currentTermMonths: MonthlySummary[];
};

// Per-student attendance summary for the lookup dialog. Reads the canonical
// rollup (`attendance_records`, kept in sync by recompute_attendance_rollup),
// so the figures match the section roster, dashboards, and the full per-student
// page: late-enrollee proration (dates before enrollment_date are excluded) and
// rate = (present incl. excused) / recorded school days. The current term is
// resolved BY DATE (terms.is_current is deprecated).
export async function GET(req: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const sectionStudentId = searchParams.get('sectionStudentId');
  const requestedTermId = searchParams.get('termId');
  if (!sectionStudentId) {
    return NextResponse.json(
      { error: 'sectionStudentId is required' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Resolve section → AY (and the student's enrollment_date for proration).
  const { data: ss } = await service
    .from('section_students')
    .select('section_id, enrollment_date')
    .eq('id', sectionStudentId)
    .maybeSingle();
  if (!ss) {
    return NextResponse.json(
      { error: 'Section student not found' },
      { status: 404 }
    );
  }

  // Teacher scope gate — teachers may only view students in sections they
  // form-advise. Registrar / school_admin / superadmin skip this check.
  if (auth.role === 'teacher') {
    // A substitute covering the adviser passes: reading a student's attendance
    // is part of taking the register, which is the work they are there to do.
    const sectionId = (ss as { section_id: string }).section_id;
    const assignments = await loadEffectiveAssignmentsForUser(
      service,
      auth.user.id
    );
    const advises = assignments.some(
      (a) => a.role === 'form_adviser' && a.section_id === sectionId
    );
    if (!advises) {
      return NextResponse.json(
        { error: 'not form adviser for this section' },
        { status: 403 }
      );
    }
  }

  const enrollmentDate = (ss as { enrollment_date: string | null })
    .enrollment_date;

  const { data: sectionRow } = await service
    .from('sections')
    .select('academic_year_id')
    .eq('id', (ss as { section_id: string }).section_id)
    .maybeSingle();
  const ayId = (sectionRow as { academic_year_id: string } | null)
    ?.academic_year_id;
  if (!ayId) {
    return NextResponse.json({
      termStats: [],
      recentAbsences: [],
      currentTermMonths: [],
    } satisfies StudentSummaryResponse);
  }

  // Terms, the canonical rollup, and the raw ledger (for recent absences) in one go.
  const [termsResult, rollupResult, dailyResult] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number, label, start_date, end_date')
      .eq('academic_year_id', ayId)
      .order('term_number'),
    service
      .from('attendance_records')
      .select(
        'term_id, days_present, days_late, days_excused, days_absent, attendance_pct'
      )
      .eq('section_student_id', sectionStudentId),
    service
      .from('attendance_daily')
      .select('date, status, term_id, period_id, recorded_at')
      .eq('section_student_id', sectionStudentId)
      .order('recorded_at', { ascending: false }),
  ]);

  type TermRow = {
    id: string;
    term_number: number;
    label: string;
    start_date: string | null;
    end_date: string | null;
  };
  const terms = (termsResult.data ?? []) as TermRow[];
  const currentTermId =
    requestedTermId && terms.some((t) => t.id === requestedTermId)
      ? requestedTermId
      : resolveCurrentTermId(terms, sgToday());
  const currentTermMonths: MonthlySummary[] = currentTermId
    ? currentTermMonthsFromRaw(
        ((dailyResult.data ?? []) as RawRow[])
          .filter(
            (row) =>
              row.term_id === currentTermId &&
              (!enrollmentDate || row.date >= enrollmentDate)
          )
          .map((row) => ({
            date: row.date,
            status: row.status as AttendanceStatus,
            periodId: row.period_id,
            recordedAt: row.recorded_at,
          }))
      )
    : [];

  type RollupRow = {
    term_id: string;
    days_present: number | null; // present INCLUDES late + excused (see RPC)
    days_late: number | null;
    days_excused: number | null;
    days_absent: number | null;
    attendance_pct: number | null;
  };
  const rollupByTerm = new Map<string, RollupRow>();
  for (const r of (rollupResult.data ?? []) as RollupRow[]) {
    rollupByTerm.set(r.term_id, r);
  }

  const termStats: TermStat[] = terms.map((term) => {
    const isCurrent = term.id === currentTermId;
    const r = rollupByTerm.get(term.id);
    if (!r) {
      return {
        termId: term.id,
        termNumber: term.term_number,
        label: term.label,
        isCurrent,
        P: 0,
        L: 0,
        A: 0,
        EX: 0,
        rate: null,
      };
    }
    const L = r.days_late ?? 0;
    const EX = r.days_excused ?? 0;
    const A = r.days_absent ?? 0;
    const P = presentOnlyCount({
      daysPresent: r.days_present ?? 0,
      daysLate: L,
      daysExcused: EX,
    });
    return {
      termId: term.id,
      termNumber: term.term_number,
      label: term.label,
      isCurrent,
      P,
      L,
      A,
      EX,
      rate: r.attendance_pct ?? null,
    };
  });

  // Recent absences — dedupe to the latest entry per (date, period) across ALL
  // statuses (so a corrected-away absence drops out), then keep 'A' on/after
  // the enrollment_date, 5 most recent.
  type RawRow = {
    date: string;
    status: string;
    term_id: string;
    period_id: string | null;
    recorded_at: string;
  };
  const seen = new Set<string>();
  const recentAbsences = ((dailyResult.data ?? []) as RawRow[])
    .filter((row) => {
      const key = `${row.date}|${row.period_id ?? 'null'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter(
      (row) =>
        row.status === 'A' && (!enrollmentDate || row.date >= enrollmentDate)
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map((r) => r.date);

  return NextResponse.json({
    termStats,
    recentAbsences,
    currentTermMonths,
  } satisfies StudentSummaryResponse);
}
