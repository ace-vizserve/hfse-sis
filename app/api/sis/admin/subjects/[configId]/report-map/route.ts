import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { SubjectReportMapUpdateSchema } from '@/lib/schemas/subject-config';
import { createServiceClient } from '@/lib/supabase/service';

// PUT /api/sis/admin/subjects/[configId]/report-map
//
// Sets which subject's report-card column this subject's grades roll up
// into (`subject_report_map`, migration 080 — global, no AY/level
// dimension; every subject is seeded self-mapped, so "reports as itself"
// is the common/default case). Editable from the per-subject weights
// dialog on /sis/admin/subjects.
//
// The URL segment is named `[configId]` (not `[subjectId]`) purely to
// share the same dynamic-route slug name as this folder's sibling
// route.ts (`app/api/sis/admin/subjects/[configId]/route.ts`, keyed by
// subject_configs.id) — Next.js's App Router hard-requires every dynamic
// segment at the same path depth to use one identical param name, or dev
// mode fails to rebuild its route table (observed: "You cannot use
// different slug names for the same dynamic path" — the whole route
// manifest reload broke, with symptoms surfacing on unrelated routes).
// The VALUE this route actually receives and operates on is still a
// `subjects.id`, never a `subject_configs.id` — aliased back to
// `subjectId` immediately below so the rest of this file reads correctly.
//
// The table's unique key is the (subject_id, report_subject_id) pair, but
// a subject has effectively one active mapping at a time — so this route
// clears any existing row(s) for `subjectId` and inserts the new pairing,
// rather than an upsert (which wouldn't remove a stale mapping pointing at
// a DIFFERENT report_subject_id).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { configId: subjectId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SubjectReportMapUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { report_subject_id } = parsed.data;

  const service = createServiceClient();

  const { data: subjectRow, error: subjErr } = await service
    .from('subjects')
    .select('id, code, name')
    .eq('id', subjectId)
    .maybeSingle();
  if (subjErr)
    return NextResponse.json({ error: subjErr.message }, { status: 500 });
  if (!subjectRow)
    return NextResponse.json({ error: 'subject not found' }, { status: 404 });
  const subject = subjectRow as { id: string; code: string; name: string };

  const { data: reportSubjectRow, error: reportErr } = await service
    .from('subjects')
    .select('id, code, name')
    .eq('id', report_subject_id)
    .maybeSingle();
  if (reportErr)
    return NextResponse.json({ error: reportErr.message }, { status: 500 });
  if (!reportSubjectRow)
    return NextResponse.json(
      { error: 'report subject not found' },
      { status: 404 }
    );
  const reportSubject = reportSubjectRow as {
    id: string;
    code: string;
    name: string;
  };

  const { error: deleteErr } = await service
    .from('subject_report_map')
    .delete()
    .eq('subject_id', subjectId);
  if (deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  const { error: insertErr } = await service
    .from('subject_report_map')
    .insert({ subject_id: subjectId, report_subject_id });
  if (insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'subject_report_map.update',
    entityType: 'subject_report_map',
    entityId: subjectId,
    context: {
      subject_id: subjectId,
      subject_code: subject.code,
      report_subject_id,
      report_subject_code: reportSubject.code,
    },
  });

  return NextResponse.json({
    ok: true,
    subject_id: subjectId,
    report_subject_id,
  });
}
