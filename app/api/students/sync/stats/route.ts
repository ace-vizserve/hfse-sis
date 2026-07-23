import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAdmissionsRoster } from '@/lib/supabase/admissions';
import { loadGradingSnapshot } from '@/lib/sync/snapshot';
import { buildSyncPlan } from '@/lib/sync/students';
import { requireCurrentAyCode } from '@/lib/academic-year';

// Preview endpoint — returns what WOULD happen on sync without writing anything.
// Accepts optional ?ay=AY2026 query param; falls back to current AY.
export async function GET(request: Request) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  try {
    const service = createServiceClient();
    const { searchParams } = new URL(request.url);
    const ayParam = searchParams.get('ay');
    const ayCode = ayParam ?? (await requireCurrentAyCode(service));
    const [snapshot, rows] = await Promise.all([
      loadGradingSnapshot(service, ayCode),
      fetchAdmissionsRoster(ayCode),
    ]);
    const plan = buildSyncPlan(rows, snapshot);
    return NextResponse.json({
      ay_code: ayCode,
      stats: plan.stats,
      errors: plan.errors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
