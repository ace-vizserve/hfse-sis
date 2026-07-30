import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { createServiceClient } from '@/lib/supabase/service';
import { ensureTermSeeded } from '@/lib/attendance/calendar';

// POST /api/sis/ay-setup/seed-calendar
//
// Body: { ay_code: string }
// Idempotently backfills school_day rows for every weekday in each dated
// term of the given AY. Existing rows (public holidays, HBL overrides, etc.)
// are preserved — the upsert uses ignoreDuplicates on (term_id, audience, date).
//
// Returns { ok: true, inserted: number, terms: number }.
// `inserted` is the total new rows written across all terms; `terms` is
// the count of dated terms processed.
export async function POST(request: NextRequest) {
  // academic_year.edit, NOT school_calendar.edit: this is the AY-setup step that
  // lays down a year's school days, and it admits school_admin + superadmin
  // only, whereas editing the calendar day-to-day also admits the academic
  // coordinator. Mapping it to school_calendar.edit would have widened it.
  const auth = await requireCapability('academic_year.edit');
  if ('error' in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const ayCode =
    body !== null && typeof body === 'object' && 'ay_code' in body
      ? (body as Record<string, unknown>).ay_code
      : undefined;

  if (typeof ayCode !== 'string' || !/^AY[0-9]{4}$/.test(ayCode)) {
    return NextResponse.json(
      { error: 'ay_code must be a string matching /^AY[0-9]{4}$/' },
      { status: 400 }
    );
  }

  try {
    const service = createServiceClient();

    // 1. Resolve the AY row.
    const { data: ayRow, error: ayErr } = await service
      .from('academic_years')
      .select('id')
      .eq('ay_code', ayCode)
      .maybeSingle();
    if (ayErr) {
      return NextResponse.json({ error: ayErr.message }, { status: 500 });
    }
    if (!ayRow) {
      return NextResponse.json(
        { error: `Academic year ${ayCode} not found` },
        { status: 404 }
      );
    }
    const { id: ayId } = ayRow as { id: string };

    // 2. Fetch all terms in this AY that have both start and end dates set.
    const { data: terms, error: termsErr } = await service
      .from('terms')
      .select('id, start_date, end_date')
      .eq('academic_year_id', ayId)
      .not('start_date', 'is', null)
      .not('end_date', 'is', null);
    if (termsErr) {
      return NextResponse.json({ error: termsErr.message }, { status: 500 });
    }

    const datedTerms = (terms ?? []) as Array<{
      id: string;
      start_date: string;
      end_date: string;
    }>;

    if (datedTerms.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, terms: 0 });
    }

    // 3. Seed each term sequentially (idempotent upsert — safe to parallelise,
    //    but sequential avoids hammering the DB under concurrent wizard clicks).
    let totalInserted = 0;
    for (const term of datedTerms) {
      const inserted = await ensureTermSeeded(
        term.id,
        term.start_date,
        term.end_date,
        auth.user.id
      );
      totalInserted += inserted;
    }

    // 4. Audit + bust the AY cache so the readiness pill + calendar page
    //    reflect the new rows immediately. Same action + shape as the
    //    calendar page's own auto-seed-on-visit (app/(sis)/sis/calendar/page.tsx)
    //    — only logged when rows were actually written.
    if (totalInserted > 0) {
      await logAction({
        service,
        actor: { id: auth.user.id, email: auth.user.email ?? null },
        action: 'attendance.calendar.autoseed',
        entityType: 'school_calendar',
        entityId: ayId,
        context: { ayCode, inserted: totalInserted, terms: datedTerms.length },
      });
    }
    revalidateTag(`sis:${ayCode}`, 'max');

    return NextResponse.json({
      ok: true,
      inserted: totalInserted,
      terms: datedTerms.length,
    });
  } catch (e) {
    console.error('[seed-calendar] unexpected error:', e);
    return NextResponse.json(
      { error: 'Failed to seed calendar' },
      { status: 500 }
    );
  }
}
