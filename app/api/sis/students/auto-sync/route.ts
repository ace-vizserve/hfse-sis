import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { loadUnsyncedEnrolledStudents } from '@/lib/sis/unsynced-students';
import {
  syncOneStudent,
  type PreloadedSyncSnapshot,
} from '@/lib/sync/students';

// GET /api/sis/students/auto-sync — Vercel Cron.
// POST is kept for a manual/scripted run with the same secret.
//
// 🔴 THIS NEVER RAN UNTIL 2026-09-17. Vercel Cron calls a cron path with GET
// (vercel.json → "/api/sis/students/auto-sync"), and this file exported only
// POST, so every nightly call got a 405 and not one `sis.student.auto_sync_batch`
// audit row was ever written. Both verbs now run the same function.
//
// Runs daily at 15:00 UTC (23:00 SGT). Walks the unsynced enrolled-students
// queue and runs syncOneStudent for every row where gapReason='not_synced'
// (both studentNumber and classSection are already set on the admissions side
// — only the public.students mirror is stale or missing). Rows with
// gapReason='no_class_section' or 'no_student_number' are intentionally
// skipped because a human decision is required to unblock them.
//
// Auth: Vercel sets `Authorization: Bearer ${CRON_SECRET}` automatically.
export async function GET(request: NextRequest) {
  return runAutoSync(request);
}

export async function POST(request: NextRequest) {
  return runAutoSync(request);
}

type Outcome = {
  enroleeNumber: string;
  studentNumber: string | null;
  name: string | null;
  classLevel: string | null;
  classSection: string | null;
};

async function runAutoSync(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    request.headers.get('authorization') !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  const admissions = createAdmissionsClient();
  const systemActor = { id: null, email: 'system:auto-sync', role: null };

  let ayCode: string;
  try {
    ayCode = await requireCurrentAyCode();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[auto-sync] requireCurrentAyCode failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const allRows = await loadUnsyncedEnrolledStudents(ayCode);
  const candidates = allRows.filter((r) => r.gapReason === 'not_synced');

  const byCounts: Record<string, number> = {};
  const errors: string[] = [];
  // WHO landed in each outcome, not just how many. A count of "3 enrolled"
  // cannot be traced to a child; these lists can.
  const studentsByOutcome: Record<string, Outcome[]> = {};
  const failures: Array<Outcome & { error: string }> = [];

  // Fetch the two AY-invariant lookup tables ONCE for the whole run. Every
  // syncOneStudent call used to re-fetch the full `levels` table and the full
  // per-AY `sections` list — identical data each iteration, O(N) redundant
  // reads on a fresh-AY backfill (the exact scenario this queue exists for,
  // KD #90). Same selects / ay_code filter / result mapping as the ones
  // syncOneStudent runs when no snapshot is passed.
  type SectionJoin = {
    id: string;
    level_id: string;
    name: string;
    academic_year: { ay_code: string } | { ay_code: string }[] | null;
  };
  const [levelsRes, sectionsRes] = await Promise.all([
    service.from('levels').select('id, label'),
    service
      .from('sections')
      .select('id, level_id, name, academic_year:academic_years!inner(ay_code)')
      .eq('academic_year.ay_code', ayCode),
  ]);
  const preloaded: PreloadedSyncSnapshot = {
    levels: (levelsRes.data ?? []) as Array<{ id: string; label: string }>,
    sections: ((sectionsRes.data ?? []) as SectionJoin[]).map((s) => ({
      id: s.id,
      level_id: s.level_id,
      name: s.name,
    })),
  };

  // Bounded concurrency: chunks of 5 instead of a fully sequential loop.
  // Conservative on purpose — each syncOneStudent still does several serial
  // DB round-trips internally, and Supabase connection limits apply.
  // Results are collected per chunk and tallied in candidate order, so
  // byCounts / errors bookkeeping is unchanged from the sequential loop.
  const CONCURRENCY = 5;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (row) => ({
        row,
        result: await syncOneStudent(
          service,
          admissions,
          row.enroleeNumber,
          ayCode,
          preloaded
        ),
      }))
    );
    for (const { row, result } of chunkResults) {
      const who: Outcome = {
        enroleeNumber: row.enroleeNumber,
        studentNumber: row.studentNumber,
        name:
          row.enroleeFullName?.trim() ||
          [row.firstName, row.middleName, row.lastName]
            .map((p) => (p ?? '').trim())
            .filter(Boolean)
            .join(' ') ||
          null,
        classLevel: row.classLevel,
        classSection: row.classSection,
      };
      const outcome = result.ok ? result.change : 'skipped';
      byCounts[outcome] = (byCounts[outcome] ?? 0) + 1;
      (studentsByOutcome[outcome] ??= []).push(who);
      if (!result.ok) {
        const reason = result.error ?? result.reason ?? 'unknown';
        const errMsg = `${row.enroleeNumber}: ${reason}`;
        errors.push(errMsg);
        failures.push({ ...who, error: reason });
        console.warn('[auto-sync] syncOneStudent failed:', errMsg);
      }
    }
  }

  const runDate = new Date().toISOString();

  await logAction({
    service,
    // No person, so no role — this batch already writes `actor_id: null`.
    actor: systemActor,
    action: 'sis.student.auto_sync_batch',
    entityType: 'academic_year',
    entityId: ayCode,
    context: {
      ay_code: ayCode,
      run_date: runDate,
      trigger: request.method === 'GET' ? 'cron' : 'manual',
      total_candidates: candidates.length,
      by_outcome: byCounts,
      students_by_outcome: studentsByOutcome,
      failures,
      errors,
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateAllOperationalDrills(ayCode);

  console.info(
    `[auto-sync] processed ${candidates.length} candidate(s) for ${ayCode} on ${runDate}`
  );

  return NextResponse.json({
    run_date: runDate,
    total_candidates: candidates.length,
    by_outcome: byCounts,
    error_count: errors.length,
  });
}
