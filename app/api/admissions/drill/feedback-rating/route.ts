import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { getAdmissionsFeedback } from '@/lib/admissions/feedback';
import {
  FEEDBACK_DRILL_CSV_HEADERS,
  feedbackDrillCsvRow,
  filterFeedbackByRating,
} from '@/lib/admissions/feedback-drill';
import { buildCsv } from '@/lib/csv';

// The ★ histogram's drill (KD #229). Its own route because its rows are
// feedback responses, not DrillRow applicants. A static segment, so Next
// serves it ahead of the sibling [target] route.

const ALLOWED_ROLES = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;

export async function GET(req: Request) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const url = new URL(req.url);
  const ayCode = url.searchParams.get('ay');
  if (!ayCode || !/^AY\d{4}$/.test(ayCode)) {
    return NextResponse.json({ error: 'invalid_ay' }, { status: 400 });
  }
  const segment = url.searchParams.get('segment');

  const { rows: all } = await getAdmissionsFeedback(ayCode);
  const rows = filterFeedbackByRating(all, segment);

  if (url.searchParams.get('format') === 'csv') {
    const csv = buildCsv(
      FEEDBACK_DRILL_CSV_HEADERS,
      rows.map(feedbackDrillCsvRow)
    );
    const today = new Date().toISOString().slice(0, 10);
    const suffix = segment ? `-${segment.replace(/[^0-9]/g, '')}-stars` : '';
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="drill-admissions-feedback${suffix}-${ayCode}-${today}.csv"`,
      },
    });
  }

  const res = NextResponse.json({
    rows,
    total: rows.length,
    target: 'feedback-rating',
    segment,
    ayCode,
  });
  res.headers.set(
    'Cache-Control',
    'private, max-age=60, stale-while-revalidate=300'
  );
  return res;
}
