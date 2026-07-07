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

// POST /api/sis/students/auto-sync — Vercel Cron only.
//
// Runs daily at 15:00 UTC (23:00 SGT). Walks the unsynced enrolled-students
// queue and runs syncOneStudent for every row where gapReason='not_synced'
// (both studentNumber and classSection are already set on the admissions side
// — only the public.students mirror is stale or missing). Rows with
// gapReason='no_class_section' or 'no_student_number' are intentionally
// skipped because a human decision is required to unblock them.
//
// Auth: Vercel sets `Authorization: Bearer ${CRON_SECRET}` automatically.
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    request.headers.get('authorization') !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  const admissions = createAdmissionsClient();

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
      if (result.ok) {
        byCounts[result.change] = (byCounts[result.change] ?? 0) + 1;
      } else {
        const errMsg = `${row.enroleeNumber}: ${result.error ?? result.reason ?? 'unknown'}`;
        errors.push(errMsg);
        console.warn('[auto-sync] syncOneStudent failed:', errMsg);
        byCounts['skipped'] = (byCounts['skipped'] ?? 0) + 1;
      }
    }
  }

  const runDate = new Date().toISOString();

  await logAction({
    service,
    actor: { id: null, email: 'system:auto-sync' },
    action: 'sis.student.auto_sync_batch',
    entityType: 'academic_year',
    entityId: ayCode,
    context: {
      run_date: runDate,
      total_candidates: candidates.length,
      by_outcome: byCounts,
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
