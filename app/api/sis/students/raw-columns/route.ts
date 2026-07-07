import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { getClientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

// POST /api/sis/students/raw-columns
//
// Backs the DataTable export sheet's "load all database columns" capability
// (components/ui/data-table/export-sheet.tsx) — an on-demand, unfiltered
// `select('*')` against one admissions table, scoped to only the rows
// currently in an export's scope (never a whole AY). This is intentionally
// NOT cached (unstable_cache): it's a deliberate, occasional per-export
// action where freshness matters more than a cache-hit, and caching an
// arbitrary caller-chosen key set per user isn't worth the complexity.
//
// Role gate is the UNION of every page that renders <StudentDataTable> with
// rawColumns wired (currently /admissions/applications and /records/students)
// — records' gate (registrar/school_admin/superadmin) is a subset of
// admissions' (adds 'admissions'), so this single gate covers both without
// over-exposing to either page's disallowed roles.
//
// `source` picks the table; one route (not two) shares auth/validation/
// prefix-derivation since the only real difference is the table name.
const BodySchema = z.object({
  ay: z.string().regex(/^AY\d{4}$/i, 'Invalid ay code'),
  source: z.enum(['applications', 'status']),
  keys: z
    .array(z.string().min(1))
    .min(1, 'keys must be non-empty')
    .max(2000, 'Too many rows requested at once'),
});

// PostgREST's `.in()` has practical URL/row-count limits even server-side
// (the same 1000-row cap `fetchAllPages` works around elsewhere) — chunk
// so a large export never silently truncates.
const CHUNK_SIZE = 300;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(request: Request) {
  const auth = await requireRole([
    'admissions',
    'registrar',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const limited = rateLimit({
    ip: getClientIp(request),
    userId: auth.user.id,
    scope: 'sis-raw-columns',
    ipMax: 30,
    userMax: 15,
    windowSecs: 60,
  });
  if (limited.limited) return tooManyRequests(limited.retryAfter);

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { ay, source, keys } = parsed.data;

  const prefix = `ay${ay.replace(/^AY/i, '').toLowerCase()}`;
  const table =
    source === 'applications'
      ? `${prefix}_enrolment_applications`
      : `${prefix}_enrolment_status`;
  const supabase = createAdmissionsClient();

  const batches = chunk(keys, CHUNK_SIZE);
  const results = await Promise.all(
    batches.map((batch) =>
      supabase.from(table).select('*').in('enroleeNumber', batch)
    )
  );

  const rows: Record<string, Record<string, unknown>> = {};
  for (const res of results) {
    if (res.error) {
      console.error('[sis raw-columns] fetch failed:', res.error.message);
      return NextResponse.json({ error: res.error.message }, { status: 500 });
    }
    for (const row of (res.data ?? []) as Record<string, unknown>[]) {
      const key = row.enroleeNumber;
      // A duplicate enroleeNumber (no unique constraint on the status
      // table, per lib/sis/queries.ts's getStudentDetail comments) keeps
      // the last row seen — acceptable for an export, not a source of
      // application-level truth.
      if (typeof key === 'string') rows[key] = row;
    }
  }

  return NextResponse.json(
    { rows },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
